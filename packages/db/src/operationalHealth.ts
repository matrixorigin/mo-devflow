import type {
  CacheHealthStatus,
  OperationalHealthStatus,
  OperationalHealthSummary,
  SyncHealth,
  SyncHealthLayer
} from "@mo-devflow/shared";
import { syncHealthLayers } from "@mo-devflow/shared";
import type { RowDataPacket } from "mysql2";
import { fromSqlDate, getPool, sqlDate } from "./client";
import { activeNotificationDeliverySourceWhereSql } from "./notifications";
import { buildSyncHealthSummary, cacheStaleHoursFromEnv } from "./repositories";
import { getWebhookIngestionHealth } from "./webhooks";

interface RowData extends RowDataPacket {
  [key: string]: unknown;
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

function sqlStringLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export function cacheHealthStatus(input: { staleObjects: number; partialObjects: number }): CacheHealthStatus {
  if (input.staleObjects > 0) {
    return "stale";
  }
  if (input.partialObjects > 0) {
    return "partial";
  }
  return "healthy";
}

export function operationalHealthStatus(input: {
  syncHealth: SyncHealth[];
  staleObjects: number;
  notificationFailures: number;
  webhookFailures: number;
}): OperationalHealthStatus {
  const unhealthySync = input.syncHealth.some((item) => item.status === "failed" || item.status === "blocked");
  if (unhealthySync || input.staleObjects > 0 || input.notificationFailures > 0 || input.webhookFailures > 0) {
    return "degraded";
  }
  return "healthy";
}

export function operationalHealthRecommendedAction(input: {
  syncHealth: SyncHealth[];
  staleObjects: number;
  notificationFailures: number;
  webhookFailures: number;
  latestWebhookFailure: string | null;
}): string | null {
  const failedSync = input.syncHealth.find((item) => item.status === "failed" || item.status === "blocked");
  if (failedSync) {
    return `Sync layer ${failedSync.layer} is ${failedSync.status}: ${failedSync.errorMessage ?? "inspect sync runs"}.`;
  }
  if (input.staleObjects > 0) {
    return `${input.staleObjects} cached GitHub objects are stale; queue a targeted refresh or inspect sync jobs.`;
  }
  if (input.notificationFailures > 0) {
    return `${input.notificationFailures} active notification deliveries failed; inspect notification readiness and retry failed deliveries.`;
  }
  if (input.webhookFailures > 0) {
    return `${input.webhookFailures} webhook deliveries failed.${input.latestWebhookFailure ? ` Latest failure: ${input.latestWebhookFailure}` : ""}`;
  }
  return null;
}

export async function getOperationalHealth(repoId: number): Promise<OperationalHealthSummary> {
  const pool = getPool();
  const staleThresholdHours = cacheStaleHoursFromEnv();
  const staleCutoff = sqlDate(new Date(Date.now() - staleThresholdHours * 3_600_000)) ?? "1970-01-01 00:00:00";
  const [syncRows] = await pool.execute<RowData[]>(
    `SELECT latest.sync_layer,
            latest.status,
            latest.started_at,
            latest.error_message,
            latest.rate_limit_remaining,
            summary.last_successful_at
     FROM sync_runs latest
     JOIN (
       SELECT sync_layer,
              MAX(id) AS latest_id,
              MAX(CASE WHEN status = 'success' THEN finished_at ELSE NULL END) AS last_successful_at
       FROM sync_runs
       WHERE repo_id = ?
       GROUP BY sync_layer
     ) summary ON summary.latest_id = latest.id
     WHERE latest.repo_id = ?
     ORDER BY latest.id DESC
     LIMIT 20`,
    [repoId, repoId]
  );
  const syncHealth = buildSyncHealthSummary({ rows: syncRows, expectedLayers: syncHealthLayers });
  const [cacheRows] = await pool.execute<RowData[]>(
    `SELECT
       SUM(CASE WHEN last_synced_at < ${sqlStringLiteral(staleCutoff)} THEN 1 ELSE 0 END) AS stale_count,
       SUM(CASE WHEN is_complete = 0 THEN 1 ELSE 0 END) AS partial_count,
       MIN(last_synced_at) AS oldest_synced_at
     FROM (
       SELECT i.last_synced_at, i.is_complete FROM issues i WHERE i.repo_id = ?
       UNION ALL
       SELECT p.last_synced_at, p.is_complete FROM pull_requests p WHERE p.repo_id = ?
     ) t`,
    [repoId, repoId]
  );
  const activeSourceWhere = activeNotificationDeliverySourceWhereSql("d");
  const [notificationRows] = await pool.execute<RowData[]>(
    `SELECT COUNT(*) AS failed_count
     FROM notification_deliveries d
     JOIN (
       SELECT dedupe_key, MAX(id) AS latest_id
       FROM notification_deliveries
       WHERE repo_id = ?
       GROUP BY dedupe_key
     ) latest_delivery ON latest_delivery.latest_id = d.id
     WHERE d.repo_id = ? AND d.status IN ('failed_transient', 'failed_permanent')
       AND ${activeSourceWhere}`,
    [repoId, repoId]
  );
  const webhooks = await getWebhookIngestionHealth(repoId);
  const cacheRow = cacheRows[0] ?? {};
  const staleObjects = asNumber(cacheRow.stale_count);
  const partialObjects = asNumber(cacheRow.partial_count);
  const failedDeliveries = asNumber(notificationRows[0]?.failed_count);
  const oldestSyncedAt = fromSqlDate(cacheRow.oldest_synced_at);
  const unhealthyLayers = syncHealth
    .filter((item) => item.status === "failed" || item.status === "blocked")
    .map((item) => item.layer);
  const rateLimitedLayers = syncHealth
    .filter((item) => item.rateLimitRemaining !== null && item.rateLimitRemaining <= 0)
    .map((item) => item.layer);
  const status = operationalHealthStatus({
    syncHealth,
    staleObjects,
    notificationFailures: failedDeliveries,
    webhookFailures: webhooks.failedDeliveries
  });

  return {
    status,
    recommendedAction: operationalHealthRecommendedAction({
      syncHealth,
      staleObjects,
      notificationFailures: failedDeliveries,
      webhookFailures: webhooks.failedDeliveries,
      latestWebhookFailure: webhooks.latestFailure
    }),
    sync: {
      health: syncHealth,
      unhealthyLayers,
      rateLimitedLayers: rateLimitedLayers as SyncHealthLayer[]
    },
    cache: {
      status: cacheHealthStatus({ staleObjects, partialObjects }),
      staleObjects,
      staleThresholdHours,
      oldestCacheAgeHours: oldestSyncedAt
        ? Math.max(0, Math.round(((Date.now() - new Date(oldestSyncedAt).getTime()) / 3_600_000) * 10) / 10)
        : null,
      partialObjects
    },
    notifications: {
      failedDeliveries
    },
    webhooks
  };
}
