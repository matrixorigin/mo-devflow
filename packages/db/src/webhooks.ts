import type {
  GitHubWebhookEventHealth,
  GitHubWebhookDeliveryStatus,
  GitHubWebhookDeliveryView,
  WebhookIngestionHealth
} from "@mo-devflow/shared";
import { parseJsonRecord } from "@mo-devflow/shared";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { fromSqlDate, getPool, nowSql, sqlDate } from "./client";

interface RowData extends RowDataPacket {
  [key: string]: unknown;
}

export interface GitHubWebhookDeliveryRecord {
  repoId: number;
  deliveryId: string;
  eventName: string;
  action: string | null;
  signature256: string | null;
  headers: Record<string, unknown>;
  payload: unknown;
  rawPayload: string;
}

export interface GitHubWebhookRecordResult {
  duplicate: boolean;
  deliveryId: string;
  status: "received" | "ignored" | "duplicate";
}

export interface LeasedGitHubWebhookDelivery {
  id: number;
  repoId: number;
  deliveryId: string;
  eventName: string;
  action: string | null;
  attempts: number;
  payload: Record<string, unknown>;
  processingOwner: string;
}

const leasedWebhookDeliveryColumns = [
  "id",
  "repo_id",
  "delivery_id",
  "event_name",
  "action",
  "attempts",
  "payload_json",
  "processing_owner"
].join(", ");
const webhookEventFailureSampleLimit = 100;
const webhookClaimCandidateLimit = 8;

function stringify(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asNumber(value: unknown): number {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "bigint") {
    return Number(value);
  }
  if (typeof value === "string") {
    return Number(value);
  }
  return 0;
}

function isDuplicateError(error: unknown): boolean {
  const err = error as { code?: string; errno?: number; message?: string };
  return err.code === "ER_DUP_ENTRY" || err.errno === 1062 || (err.message ?? "").includes("Duplicate entry");
}

async function incrementDuplicateDelivery(deliveryId: string, now: string): Promise<GitHubWebhookRecordResult> {
  await getPool().execute(
    `UPDATE github_webhook_deliveries
     SET duplicate_count = duplicate_count + 1,
         last_duplicate_at = ?
     WHERE delivery_id = ?`,
    [now, deliveryId]
  );
  return {
    duplicate: true,
    deliveryId,
    status: "duplicate"
  };
}

export async function recordGitHubWebhookDelivery(
  input: GitHubWebhookDeliveryRecord
): Promise<GitHubWebhookRecordResult> {
  const now = nowSql();
  try {
    await getPool().execute(
      `INSERT INTO github_webhook_deliveries(
        repo_id, delivery_id, event_name, action, status, signature256,
        headers_json, payload_json, raw_payload, received_at, processed_at, error_message
      ) VALUES (?, ?, ?, ?, 'received', ?, ?, ?, ?, ?, NULL, NULL)`,
      [
        input.repoId,
        input.deliveryId,
        input.eventName,
        input.action,
        input.signature256,
        stringify(input.headers),
        stringify(input.payload),
        input.rawPayload,
        now
      ]
    );
    return {
      duplicate: false,
      deliveryId: input.deliveryId,
      status: "received"
    };
  } catch (error) {
    if (!isDuplicateError(error)) {
      throw error;
    }
    return incrementDuplicateDelivery(input.deliveryId, now);
  }
}

export async function recordIgnoredGitHubWebhookDelivery(
  input: GitHubWebhookDeliveryRecord & { ignoredReason: string }
): Promise<GitHubWebhookRecordResult> {
  const now = nowSql();
  try {
    await getPool().execute(
      `INSERT INTO github_webhook_deliveries(
        repo_id, delivery_id, event_name, action, status, signature256,
        headers_json, payload_json, raw_payload, received_at, processed_at, error_message
      ) VALUES (?, ?, ?, ?, 'ignored', ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.repoId,
        input.deliveryId,
        input.eventName,
        input.action,
        input.signature256,
        stringify(input.headers),
        stringify(input.payload),
        input.rawPayload,
        now,
        now,
        input.ignoredReason
      ]
    );
    return {
      duplicate: false,
      deliveryId: input.deliveryId,
      status: "ignored"
    };
  } catch (error) {
    if (!isDuplicateError(error)) {
      throw error;
    }
    return incrementDuplicateDelivery(input.deliveryId, now);
  }
}

function toLeasedDelivery(row: RowData): LeasedGitHubWebhookDelivery {
  return {
    id: asNumber(row.id),
    repoId: asNumber(row.repo_id),
    deliveryId: asString(row.delivery_id),
    eventName: asString(row.event_name),
    action: row.action ? asString(row.action) : null,
    attempts: asNumber(row.attempts),
    payload: parseJsonRecord(asString(row.payload_json), {}),
    processingOwner: asString(row.processing_owner)
  };
}

export async function claimNextGitHubWebhookDelivery(input: {
  repoId: number;
  processingOwner: string;
  leaseSeconds: number;
}): Promise<LeasedGitHubWebhookDelivery | null> {
  const now = nowSql();
  const leaseExpiresAt = sqlDate(new Date(Date.now() + input.leaseSeconds * 1000)) ?? now;
  const [candidates] = await getPool().execute<RowData[]>(
    `SELECT id
     FROM github_webhook_deliveries
     WHERE repo_id = ?
       AND (
         status = 'received'
         OR (status = 'processing' AND processing_expires_at < ?)
       )
     ORDER BY received_at ASC, id ASC
     LIMIT ${webhookClaimCandidateLimit}`,
    [input.repoId, now]
  );

  for (const candidate of candidates) {
    const candidateId = asNumber(candidate.id);
    const [result] = await getPool().execute<ResultSetHeader>(
      `UPDATE github_webhook_deliveries
       SET status = 'processing',
           attempts = attempts + 1,
           processing_owner = ?,
           processing_started_at = ?,
           processing_expires_at = ?,
           error_message = NULL
       WHERE id = ?
         AND repo_id = ?
         AND (
           status = 'received'
           OR (status = 'processing' AND processing_expires_at < ?)
         )`,
      [input.processingOwner, now, leaseExpiresAt, candidateId, input.repoId, now]
    );
    if (Number(result.affectedRows ?? 0) === 0) {
      continue;
    }

    const [rows] = await getPool().execute<RowData[]>(
      `SELECT ${leasedWebhookDeliveryColumns}
       FROM github_webhook_deliveries
       WHERE id = ?
         AND status = 'processing'
         AND processing_owner = ?
         AND processing_expires_at >= ?
       LIMIT 1`,
      [candidateId, input.processingOwner, now]
    );
    if (rows[0]) {
      return toLeasedDelivery(rows[0]);
    }
  }

  return null;
}

export async function completeGitHubWebhookDelivery(input: {
  deliveryId: number;
  processingOwner: string;
  result: unknown;
}): Promise<void> {
  const now = nowSql();
  const [result] = await getPool().execute<ResultSetHeader>(
    `UPDATE github_webhook_deliveries
     SET status = 'processed',
         processed_at = ?,
         processing_owner = NULL,
         processing_expires_at = NULL,
         processing_result_json = ?,
         error_message = NULL
     WHERE id = ?
       AND status = 'processing'
       AND processing_owner = ?
       AND processing_expires_at >= ?`,
    [now, stringify(input.result), input.deliveryId, input.processingOwner, now]
  );
  if (Number(result.affectedRows ?? 0) === 0) {
    throw new Error(`Cannot complete webhook delivery ${input.deliveryId}; lease is no longer valid for this worker.`);
  }
}

export async function failGitHubWebhookDelivery(input: {
  deliveryId: number;
  processingOwner: string;
  errorMessage: string;
  status?: "failed" | "failed_normalization";
}): Promise<void> {
  const now = nowSql();
  const [result] = await getPool().execute<ResultSetHeader>(
    `UPDATE github_webhook_deliveries
     SET status = ?,
         processed_at = ?,
         processing_owner = NULL,
         processing_expires_at = NULL,
         error_message = ?
     WHERE id = ?
       AND status = 'processing'
       AND processing_owner = ?
       AND processing_expires_at >= ?`,
    [input.status ?? "failed", now, input.errorMessage, input.deliveryId, input.processingOwner, now]
  );
  if (Number(result.affectedRows ?? 0) === 0) {
    throw new Error(`Cannot fail webhook delivery ${input.deliveryId}; lease is no longer valid for this worker.`);
  }
}

export async function retryFailedGitHubWebhookDeliveries(input: {
  repoId: number;
}): Promise<{ retriedDeliveries: number }> {
  const [result] = await getPool().execute<ResultSetHeader>(
    `UPDATE github_webhook_deliveries
     SET status = 'received',
         processing_owner = NULL,
         processing_started_at = NULL,
         processing_expires_at = NULL,
         processing_result_json = NULL,
         processed_at = NULL,
         error_message = NULL
     WHERE repo_id = ?
       AND status IN ('failed', 'failed_normalization')`,
    [input.repoId]
  );

  return {
    retriedDeliveries: Number(result.affectedRows ?? 0)
  };
}

export async function getWebhookIngestionHealth(repoId: number): Promise<WebhookIngestionHealth> {
  const [statusRows] = await getPool().execute<RowData[]>(
    `SELECT
       SUM(CASE WHEN status IN ('received', 'processing') THEN 1 ELSE 0 END) AS pending_deliveries,
       SUM(CASE WHEN status = 'processing' AND processing_expires_at < UTC_TIMESTAMP() THEN 1 ELSE 0 END) AS stale_processing_deliveries,
       SUM(CASE WHEN status = 'processed' THEN 1 ELSE 0 END) AS processed_deliveries,
       SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed_deliveries,
       SUM(CASE WHEN status = 'failed_normalization' THEN 1 ELSE 0 END) AS normalization_failed_deliveries,
       SUM(CASE WHEN status = 'ignored' THEN 1 ELSE 0 END) AS ignored_deliveries,
       SUM(duplicate_count) AS duplicate_deliveries,
       SUM(CASE WHEN event_name = 'ping' THEN 1 ELSE 0 END) AS connectivity_probe_deliveries,
       MAX(received_at) AS last_received_at,
       MIN(CASE WHEN status IN ('received', 'processing') THEN received_at ELSE NULL END) AS oldest_pending_received_at,
       MAX(CASE WHEN event_name = 'ping' THEN received_at ELSE NULL END) AS last_connectivity_probe_at
     FROM github_webhook_deliveries
     WHERE repo_id = ?`,
    [repoId]
  );
  const [failureRows] = await getPool().execute<RowData[]>(
    `SELECT delivery_id, error_message
     FROM github_webhook_deliveries
     WHERE repo_id = ? AND status IN ('failed', 'failed_normalization')
     ORDER BY received_at DESC
     LIMIT 1`,
    [repoId]
  );
  const [eventRows] = await getPool().execute<RowData[]>(
    `SELECT
       event_name,
       SUM(CASE WHEN status IN ('received', 'processing') THEN 1 ELSE 0 END) AS pending_deliveries,
       SUM(CASE WHEN status = 'processed' THEN 1 ELSE 0 END) AS processed_deliveries,
       SUM(CASE WHEN status IN ('failed', 'failed_normalization') THEN 1 ELSE 0 END) AS failed_deliveries,
       SUM(CASE WHEN status = 'ignored' THEN 1 ELSE 0 END) AS ignored_deliveries,
       SUM(duplicate_count) AS duplicate_deliveries,
       MAX(received_at) AS last_received_at,
       MAX(processed_at) AS last_processed_at
     FROM github_webhook_deliveries
     WHERE repo_id = ?
     GROUP BY event_name
     ORDER BY MAX(received_at) DESC, event_name ASC`,
    [repoId]
  );
  const [eventFailureRows] = await getPool().execute<RowData[]>(
    `SELECT event_name, error_message
     FROM github_webhook_deliveries
     WHERE repo_id = ? AND status IN ('failed', 'failed_normalization')
     ORDER BY event_name ASC, received_at DESC, id DESC
     LIMIT ?`,
    [repoId, webhookEventFailureSampleLimit]
  );
  const [recentRows] = await getPool().execute<RowData[]>(
    `SELECT delivery_id, event_name, action, status, attempts, duplicate_count,
            CASE WHEN status = 'processing' AND processing_expires_at < UTC_TIMESTAMP() THEN 1 ELSE 0 END AS stale_processing,
            received_at, processed_at, error_message
     FROM github_webhook_deliveries
     WHERE repo_id = ?
     ORDER BY received_at DESC
     LIMIT 12`,
    [repoId]
  );
  const [recentFailureRows] = await getPool().execute<RowData[]>(
    `SELECT delivery_id, event_name, action, status, attempts, duplicate_count,
            CASE WHEN status = 'processing' AND processing_expires_at < UTC_TIMESTAMP() THEN 1 ELSE 0 END AS stale_processing,
            received_at, processed_at, error_message
     FROM github_webhook_deliveries
     WHERE repo_id = ? AND status IN ('failed', 'failed_normalization')
     ORDER BY received_at DESC
     LIMIT 8`,
    [repoId]
  );
  const row = statusRows[0] ?? {};
  const failure = failureRows[0];
  const diagnosticDeliveries = new Map<string, GitHubWebhookDeliveryView>();
  const latestFailureByEvent = latestWebhookFailureByEvent(eventFailureRows);
  for (const delivery of [...recentRows, ...recentFailureRows].map(toGitHubWebhookDeliveryView)) {
    diagnosticDeliveries.set(delivery.deliveryId, delivery);
  }

  return {
    pendingDeliveries: asNumber(row.pending_deliveries),
    staleProcessingDeliveries: asNumber(row.stale_processing_deliveries),
    processedDeliveries: asNumber(row.processed_deliveries),
    failedDeliveries: asNumber(row.failed_deliveries),
    normalizationFailedDeliveries: asNumber(row.normalization_failed_deliveries),
    ignoredDeliveries: asNumber(row.ignored_deliveries),
    duplicateDeliveries: asNumber(row.duplicate_deliveries),
    connectivityProbeDeliveries: asNumber(row.connectivity_probe_deliveries),
    lastReceivedAt: fromSqlDate(row.last_received_at),
    oldestPendingReceivedAt: fromSqlDate(row.oldest_pending_received_at),
    lastConnectivityProbeAt: fromSqlDate(row.last_connectivity_probe_at),
    latestFailure: failure ? `${asString(failure.delivery_id)}: ${asString(failure.error_message)}` : null,
    eventSummaries: eventRows.map((eventRow) =>
      toGitHubWebhookEventHealth(eventRow, latestFailureByEvent.get(asString(eventRow.event_name)) ?? null)
    ),
    recentDeliveries: [...diagnosticDeliveries.values()].sort(
      (left, right) => new Date(right.receivedAt).getTime() - new Date(left.receivedAt).getTime()
    )
  };
}

function latestWebhookFailureByEvent(rows: RowData[]): Map<string, string | null> {
  const failures = new Map<string, string | null>();
  for (const row of rows) {
    const eventName = asString(row.event_name);
    if (!failures.has(eventName)) {
      failures.set(
        eventName,
        row.error_message === null || row.error_message === undefined ? null : asString(row.error_message)
      );
    }
  }
  return failures;
}

function toGitHubWebhookEventHealth(row: RowData, latestFailure: string | null): GitHubWebhookEventHealth {
  return {
    eventName: asString(row.event_name),
    pendingDeliveries: asNumber(row.pending_deliveries),
    processedDeliveries: asNumber(row.processed_deliveries),
    failedDeliveries: asNumber(row.failed_deliveries),
    ignoredDeliveries: asNumber(row.ignored_deliveries),
    duplicateDeliveries: asNumber(row.duplicate_deliveries),
    lastReceivedAt: fromSqlDate(row.last_received_at),
    lastProcessedAt: fromSqlDate(row.last_processed_at),
    latestFailure: latestFailure && latestFailure.length > 0 ? latestFailure : null
  };
}

function toGitHubWebhookDeliveryView(row: RowData): GitHubWebhookDeliveryView {
  return {
    deliveryId: asString(row.delivery_id),
    eventName: asString(row.event_name),
    action: row.action === null || row.action === undefined ? null : asString(row.action),
    status: asString(row.status) as GitHubWebhookDeliveryStatus,
    attempts: asNumber(row.attempts),
    duplicateCount: asNumber(row.duplicate_count),
    staleProcessing: asNumber(row.stale_processing) > 0,
    receivedAt: fromSqlDate(row.received_at) ?? "",
    processedAt: fromSqlDate(row.processed_at),
    errorMessage: row.error_message === null || row.error_message === undefined ? null : asString(row.error_message)
  };
}
