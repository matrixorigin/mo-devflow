import type { WebhookIngestionHealth } from "@mo-devflow/shared";
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
    `SELECT *
     FROM github_webhook_deliveries
     WHERE repo_id = ?
       AND (
         status = 'received'
         OR (status = 'processing' AND processing_expires_at < ?)
       )
     ORDER BY received_at ASC, id ASC
     LIMIT 1`,
    [input.repoId, now]
  );
  const candidate = candidates[0];
  if (!candidate) {
    return null;
  }

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
    [input.processingOwner, now, leaseExpiresAt, asNumber(candidate.id), input.repoId, now]
  );
  if (Number(result.affectedRows ?? 0) === 0) {
    return null;
  }

  const [rows] = await getPool().execute<RowData[]>(
    "SELECT * FROM github_webhook_deliveries WHERE id = ? AND processing_owner = ? LIMIT 1",
    [asNumber(candidate.id), input.processingOwner]
  );
  return rows[0] ? toLeasedDelivery(rows[0]) : null;
}

export async function completeGitHubWebhookDelivery(input: {
  deliveryId: number;
  processingOwner: string;
  result: unknown;
}): Promise<void> {
  const [result] = await getPool().execute<ResultSetHeader>(
    `UPDATE github_webhook_deliveries
     SET status = 'processed',
         processed_at = ?,
         processing_owner = NULL,
         processing_expires_at = NULL,
         processing_result_json = ?,
         error_message = NULL
     WHERE id = ? AND processing_owner = ?`,
    [nowSql(), stringify(input.result), input.deliveryId, input.processingOwner]
  );
  if (Number(result.affectedRows ?? 0) === 0) {
    throw new Error(`Cannot complete webhook delivery ${input.deliveryId}; lease is no longer owned by this worker.`);
  }
}

export async function failGitHubWebhookDelivery(input: {
  deliveryId: number;
  processingOwner: string;
  errorMessage: string;
  status?: "failed" | "failed_normalization";
}): Promise<void> {
  const [result] = await getPool().execute<ResultSetHeader>(
    `UPDATE github_webhook_deliveries
     SET status = ?,
         processed_at = ?,
         processing_owner = NULL,
         processing_expires_at = NULL,
         error_message = ?
     WHERE id = ? AND processing_owner = ?`,
    [input.status ?? "failed", nowSql(), input.errorMessage, input.deliveryId, input.processingOwner]
  );
  if (Number(result.affectedRows ?? 0) === 0) {
    throw new Error(`Cannot fail webhook delivery ${input.deliveryId}; lease is no longer owned by this worker.`);
  }
}

export async function getWebhookIngestionHealth(repoId: number): Promise<WebhookIngestionHealth> {
  const [statusRows] = await getPool().execute<RowData[]>(
    `SELECT
       SUM(CASE WHEN status IN ('received', 'processing') THEN 1 ELSE 0 END) AS pending_deliveries,
       SUM(CASE WHEN status = 'processed' THEN 1 ELSE 0 END) AS processed_deliveries,
       SUM(CASE WHEN status IN ('failed', 'failed_normalization') THEN 1 ELSE 0 END) AS failed_deliveries,
       SUM(CASE WHEN status = 'failed_normalization' THEN 1 ELSE 0 END) AS normalization_failed_deliveries,
       SUM(CASE WHEN status = 'ignored' THEN 1 ELSE 0 END) AS ignored_deliveries,
       SUM(duplicate_count) AS duplicate_deliveries,
       MAX(received_at) AS last_received_at
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
  const row = statusRows[0] ?? {};
  const failure = failureRows[0];

  return {
    pendingDeliveries: asNumber(row.pending_deliveries),
    processedDeliveries: asNumber(row.processed_deliveries),
    failedDeliveries: asNumber(row.failed_deliveries),
    normalizationFailedDeliveries: asNumber(row.normalization_failed_deliveries),
    ignoredDeliveries: asNumber(row.ignored_deliveries),
    duplicateDeliveries: asNumber(row.duplicate_deliveries),
    lastReceivedAt: fromSqlDate(row.last_received_at),
    latestFailure: failure ? `${asString(failure.delivery_id)}: ${asString(failure.error_message)}` : null
  };
}
