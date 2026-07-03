import type { WebhookIngestionHealth } from "@mo-devflow/shared";
import type { RowDataPacket } from "mysql2";
import { fromSqlDate, getPool, nowSql } from "./client";

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
  status: "received" | "duplicate";
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
    await getPool().execute(
      `UPDATE github_webhook_deliveries
       SET duplicate_count = duplicate_count + 1,
           last_duplicate_at = ?
       WHERE delivery_id = ?`,
      [now, input.deliveryId]
    );
    return {
      duplicate: true,
      deliveryId: input.deliveryId,
      status: "duplicate"
    };
  }
}

export async function getWebhookIngestionHealth(repoId: number): Promise<WebhookIngestionHealth> {
  const [statusRows] = await getPool().execute<RowData[]>(
    `SELECT
       SUM(CASE WHEN status = 'received' THEN 1 ELSE 0 END) AS pending_deliveries,
       SUM(CASE WHEN status = 'processed' THEN 1 ELSE 0 END) AS processed_deliveries,
       SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed_deliveries,
       SUM(duplicate_count) AS duplicate_deliveries,
       MAX(received_at) AS last_received_at
     FROM github_webhook_deliveries
     WHERE repo_id = ?`,
    [repoId]
  );
  const [failureRows] = await getPool().execute<RowData[]>(
    `SELECT delivery_id, error_message
     FROM github_webhook_deliveries
     WHERE repo_id = ? AND status = 'failed'
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
    duplicateDeliveries: asNumber(row.duplicate_deliveries),
    lastReceivedAt: fromSqlDate(row.last_received_at),
    latestFailure: failure ? `${asString(failure.delivery_id)}: ${asString(failure.error_message)}` : null
  };
}
