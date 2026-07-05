import {
  parseJsonRecord,
  syncHealthLayers,
  type JobQueueHealth,
  type JobQueueTypeHealth,
  type ManualRefreshLayer,
  type ManualRefreshRequestView,
  type ManualRefreshResult
} from "@mo-devflow/shared";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { fromSqlDate, getPool, nowSql, sqlDate } from "./client";

interface RowData extends RowDataPacket {
  [key: string]: unknown;
}

export interface RecurringJobSeed {
  jobKey: string;
  jobType: string;
  payload?: unknown;
  nextRunAt?: string;
}

export interface LeasedJob {
  id: number;
  jobKey: string;
  jobType: string;
  attempts: number;
  payload: Record<string, unknown>;
  leaseOwner: string;
  leaseExpiresAt: string;
}

export interface QueuedJobNow {
  jobKey: string;
  jobType: ManualRefreshLayer;
  status: string;
  nextRunAt: string | null;
}

function isManualRefreshLayer(value: string): value is ManualRefreshLayer {
  return (syncHealthLayers as readonly string[]).includes(value);
}

function stringify(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asNullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
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

function toLeasedJob(row: RowData): LeasedJob {
  return {
    id: asNumber(row.id),
    jobKey: asString(row.job_key),
    jobType: asString(row.job_type),
    attempts: asNumber(row.attempts),
    payload: parseJsonRecord(asString(row.payload_json), {}),
    leaseOwner: asString(row.lease_owner),
    leaseExpiresAt: fromSqlDate(row.lease_expires_at) ?? new Date(0).toISOString()
  };
}

export async function ensureRecurringJobs(jobs: RecurringJobSeed[]): Promise<void> {
  const pool = getPool();
  const now = nowSql();
  for (const job of jobs) {
    try {
      await pool.execute(
        `INSERT INTO jobs(
          job_key, job_type, status, attempts, next_run_at, lease_owner,
          lease_expires_at, last_error, payload_json, created_at, updated_at
        ) VALUES (?, ?, 'pending', 0, ?, NULL, NULL, NULL, ?, ?, ?)`,
        [
          job.jobKey,
          job.jobType,
          sqlDate(job.nextRunAt ?? new Date().toISOString()),
          stringify(job.payload ?? {}),
          now,
          now
        ]
      );
    } catch (error) {
      if (!isDuplicateError(error)) {
        throw error;
      }
      await pool.execute(
        `UPDATE jobs
         SET job_type = ?,
             payload_json = ?,
             updated_at = ?
         WHERE job_key = ?`,
        [job.jobType, stringify(job.payload ?? {}), now, job.jobKey]
      );
    }
  }
}

export async function enqueueJobsNow(
  jobs: Array<RecurringJobSeed & { jobType: ManualRefreshLayer }>
): Promise<QueuedJobNow[]> {
  const now = nowSql();
  await ensureRecurringJobs(jobs);
  const queued: QueuedJobNow[] = [];

  for (const job of jobs) {
    await getPool().execute(
      `UPDATE jobs
       SET next_run_at = ?,
           status = CASE WHEN status = 'running' THEN status ELSE 'pending' END,
           updated_at = ?
       WHERE job_key = ?`,
      [now, now, job.jobKey]
    );
    const [rows] = await getPool().execute<RowData[]>(
      "SELECT job_key, job_type, status, next_run_at FROM jobs WHERE job_key = ? LIMIT 1",
      [job.jobKey]
    );
    const row = rows[0];
    if (row) {
      queued.push({
        jobKey: asString(row.job_key),
        jobType: asString(row.job_type) as ManualRefreshLayer,
        status: asString(row.status),
        nextRunAt: fromSqlDate(row.next_run_at)
      });
    }
  }

  return queued;
}

export async function recordManualRefreshRequest(input: {
  repoId: number;
  userId: number;
  githubLogin: string;
  requestedLayers: ManualRefreshLayer[];
  queuedJobs: QueuedJobNow[];
}): Promise<ManualRefreshResult> {
  const createdAt = new Date().toISOString();
  const [result] = await getPool().execute<ResultSetHeader>(
    `INSERT INTO manual_refresh_requests(
      repo_id, user_id, github_login, requested_layers_json, queued_jobs_json, status, created_at
    ) VALUES (?, ?, ?, ?, ?, 'queued', ?)`,
    [
      input.repoId,
      input.userId,
      input.githubLogin,
      stringify(input.requestedLayers),
      stringify(input.queuedJobs),
      sqlDate(createdAt)
    ]
  );
  return {
    requestId: Number(result.insertId),
    requestedLayers: input.requestedLayers,
    queuedJobs: input.queuedJobs,
    requestedAt: createdAt
  };
}

function parseManualRefreshLayers(value: unknown): ManualRefreshLayer[] {
  const parsed = parseJsonRecord<unknown>(asString(value), []);
  if (!Array.isArray(parsed)) {
    return [];
  }
  return parsed.filter((item): item is ManualRefreshLayer => typeof item === "string" && isManualRefreshLayer(item));
}

function parseQueuedJobs(value: unknown): ManualRefreshResult["queuedJobs"] {
  const parsed = parseJsonRecord<unknown>(asString(value), []);
  if (!Array.isArray(parsed)) {
    return [];
  }
  return parsed.flatMap((item) => {
    if (!item || typeof item !== "object") {
      return [];
    }
    const candidate = item as Record<string, unknown>;
    const jobKey = asString(candidate.jobKey);
    const jobType = asString(candidate.jobType);
    const status = asString(candidate.status);
    if (!jobKey || !isManualRefreshLayer(jobType) || !status) {
      return [];
    }
    return [
      {
        jobKey,
        jobType,
        status,
        nextRunAt: asNullableString(candidate.nextRunAt)
      }
    ];
  });
}

export function manualRefreshRequestViewFromRow(row: RowData): ManualRefreshRequestView {
  return {
    requestId: asNumber(row.id),
    githubLogin: asString(row.github_login),
    requestedLayers: parseManualRefreshLayers(row.requested_layers_json),
    queuedJobs: parseQueuedJobs(row.queued_jobs_json),
    status: asString(row.status),
    requestedAt: fromSqlDate(row.created_at) ?? new Date(0).toISOString()
  };
}

export async function listManualRefreshRequestsForDashboard(
  repoId: number,
  limit = 8
): Promise<ManualRefreshRequestView[]> {
  const safeLimit = Math.max(1, Math.min(20, Math.floor(limit)));
  const [rows] = await getPool().execute<RowData[]>(
    `SELECT id, github_login, requested_layers_json, queued_jobs_json, status, created_at
     FROM manual_refresh_requests
     WHERE repo_id = ?
     ORDER BY created_at DESC, id DESC
     LIMIT ${safeLimit}`,
    [repoId]
  );
  return rows.map(manualRefreshRequestViewFromRow);
}

export async function claimNextDueJob(input: { leaseOwner: string; leaseSeconds: number }): Promise<LeasedJob | null> {
  const pool = getPool();
  const now = nowSql();
  const leaseExpiresAt = sqlDate(new Date(Date.now() + input.leaseSeconds * 1000)) ?? now;
  const [candidates] = await pool.execute<RowData[]>(
    `SELECT *
     FROM jobs
     WHERE next_run_at <= ?
       AND (
         status IN ('pending', 'failed', 'complete')
         OR (status = 'running' AND lease_expires_at < ?)
       )
     ORDER BY next_run_at ASC, id ASC
     LIMIT 1`,
    [now, now]
  );
  const candidate = candidates[0];
  if (!candidate) {
    return null;
  }

  const [result] = await pool.execute<ResultSetHeader>(
    `UPDATE jobs
     SET status = 'running',
         lease_owner = ?,
         lease_expires_at = ?,
         attempts = attempts + 1,
         updated_at = ?
     WHERE id = ?
       AND next_run_at <= ?
       AND (
         status IN ('pending', 'failed', 'complete')
         OR (status = 'running' AND lease_expires_at < ?)
       )`,
    [input.leaseOwner, leaseExpiresAt, now, asNumber(candidate.id), now, now]
  );
  if (Number(result.affectedRows ?? 0) === 0) {
    return null;
  }

  const [rows] = await pool.execute<RowData[]>("SELECT * FROM jobs WHERE id = ? AND lease_owner = ? LIMIT 1", [
    asNumber(candidate.id),
    input.leaseOwner
  ]);
  return rows[0] ? toLeasedJob(rows[0]) : null;
}

export async function completeLeasedJob(input: {
  jobId: number;
  leaseOwner: string;
  nextRunAt: string;
  payload?: unknown;
}): Promise<void> {
  const [result] = await getPool().execute<ResultSetHeader>(
    `UPDATE jobs
     SET status = 'complete',
         lease_owner = NULL,
         lease_expires_at = NULL,
         last_error = NULL,
         payload_json = ?,
         next_run_at = ?,
         updated_at = ?
     WHERE id = ? AND lease_owner = ?`,
    [stringify(input.payload ?? {}), sqlDate(input.nextRunAt), nowSql(), input.jobId, input.leaseOwner]
  );
  if (Number(result.affectedRows ?? 0) === 0) {
    throw new Error(`Cannot complete job ${input.jobId}; lease is no longer owned by this worker.`);
  }
}

export async function failLeasedJob(input: {
  jobId: number;
  leaseOwner: string;
  nextRunAt: string;
  errorMessage: string;
}): Promise<void> {
  const [result] = await getPool().execute<ResultSetHeader>(
    `UPDATE jobs
     SET status = 'failed',
         lease_owner = NULL,
         lease_expires_at = NULL,
         last_error = ?,
         next_run_at = ?,
         updated_at = ?
     WHERE id = ? AND lease_owner = ?`,
    [input.errorMessage, sqlDate(input.nextRunAt), nowSql(), input.jobId, input.leaseOwner]
  );
  if (Number(result.affectedRows ?? 0) === 0) {
    throw new Error(`Cannot fail job ${input.jobId}; lease is no longer owned by this worker.`);
  }
}

export async function blockLeasedJob(input: {
  jobId: number;
  leaseOwner: string;
  nextRunAt: string;
  errorMessage: string;
}): Promise<void> {
  const [result] = await getPool().execute<ResultSetHeader>(
    `UPDATE jobs
     SET status = 'blocked',
         lease_owner = NULL,
         lease_expires_at = NULL,
         last_error = ?,
         next_run_at = ?,
         updated_at = ?
     WHERE id = ? AND lease_owner = ?`,
    [input.errorMessage, sqlDate(input.nextRunAt), nowSql(), input.jobId, input.leaseOwner]
  );
  if (Number(result.affectedRows ?? 0) === 0) {
    throw new Error(`Cannot block job ${input.jobId}; lease is no longer owned by this worker.`);
  }
}

export function jobQueueOldestPendingWarnHoursFromEnv(env: Record<string, string | undefined> = process.env): number {
  const configured = Number(env.MO_DEVFLOW_JOB_QUEUE_PENDING_WARN_HOURS);
  if (Number.isFinite(configured) && configured > 0) {
    return Math.max(0.05, configured);
  }
  return 0.25;
}

export function jobQueueRecommendedAction(
  health: Pick<
    JobQueueHealth,
    "blockedJobs" | "failedJobs" | "staleLeases" | "oldestPendingAgeHours" | "latestFailure"
  >,
  oldestPendingWarnHours = jobQueueOldestPendingWarnHoursFromEnv()
): string | null {
  const latestFailure = health.latestFailure ? ` Latest failure: ${health.latestFailure}` : "";
  if (health.blockedJobs > 0) {
    return `${health.blockedJobs} blocked jobs need credentials, permissions, or configuration changes before retry.${latestFailure}`;
  }
  if (health.staleLeases > 0) {
    return `${health.staleLeases} running job leases are stale; check worker.log and restart the worker if it is stuck.${latestFailure}`;
  }
  if (health.failedJobs > 0) {
    return `${health.failedJobs} failed jobs are waiting for retry; inspect the latest failure before queueing more work.${latestFailure}`;
  }
  if (health.oldestPendingAgeHours !== null && health.oldestPendingAgeHours >= oldestPendingWarnHours) {
    return `The oldest due job has waited ${health.oldestPendingAgeHours}h; check worker heartbeat and job lease progress.`;
  }
  return null;
}

export function jobQueueHealthStatus(
  health: Pick<
    JobQueueHealth,
    "blockedJobs" | "failedJobs" | "staleLeases" | "oldestPendingAgeHours" | "latestFailure"
  >,
  oldestPendingWarnHours = jobQueueOldestPendingWarnHoursFromEnv()
): JobQueueHealth["status"] {
  return jobQueueRecommendedAction(health, oldestPendingWarnHours) ? "attention" : "healthy";
}

export async function getJobQueueHealth(): Promise<JobQueueHealth> {
  const pool = getPool();
  const dueCondition = `next_run_at <= UTC_TIMESTAMP()
       AND (
         status IN ('pending', 'failed', 'complete')
         OR (status = 'running' AND lease_expires_at < UTC_TIMESTAMP())
       )`;
  const [queueRows] = await pool.execute<RowData[]>(
    `SELECT COUNT(*) AS queue_depth, MIN(next_run_at) AS oldest_pending_at
     FROM jobs
     WHERE ${dueCondition}`
  );
  const [runningRows] = await pool.execute<RowData[]>(
    `SELECT COUNT(*) AS running_jobs
     FROM jobs
     WHERE status = 'running' AND lease_expires_at >= UTC_TIMESTAMP()`
  );
  const [failedRows] = await pool.execute<RowData[]>(
    "SELECT COUNT(*) AS failed_jobs FROM jobs WHERE status = 'failed'"
  );
  const [blockedRows] = await pool.execute<RowData[]>(
    "SELECT COUNT(*) AS blocked_jobs FROM jobs WHERE status = 'blocked'"
  );
  const [staleRows] = await pool.execute<RowData[]>(
    `SELECT COUNT(*) AS stale_leases
     FROM jobs
     WHERE status = 'running' AND lease_expires_at < UTC_TIMESTAMP()`
  );
  const [nextRows] = await pool.execute<RowData[]>(
    "SELECT MIN(next_run_at) AS next_run_at FROM jobs WHERE next_run_at > UTC_TIMESTAMP()"
  );
  const [failureRows] = await pool.execute<RowData[]>(
    `SELECT job_key, last_error
     FROM jobs
     WHERE last_error IS NOT NULL
     ORDER BY updated_at DESC
     LIMIT 1`
  );
  const [breakdownRows] = await pool.execute<RowData[]>(
    `SELECT job_type,
            SUM(CASE WHEN ${dueCondition} THEN 1 ELSE 0 END) AS queue_depth,
            SUM(CASE WHEN status = 'running' AND lease_expires_at >= UTC_TIMESTAMP() THEN 1 ELSE 0 END) AS running_jobs,
            SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed_jobs,
            SUM(CASE WHEN status = 'blocked' THEN 1 ELSE 0 END) AS blocked_jobs,
            SUM(CASE WHEN status = 'running' AND lease_expires_at < UTC_TIMESTAMP() THEN 1 ELSE 0 END) AS stale_leases,
            MIN(CASE WHEN ${dueCondition} THEN next_run_at ELSE NULL END) AS oldest_pending_at,
            MIN(CASE WHEN next_run_at > UTC_TIMESTAMP() THEN next_run_at ELSE NULL END) AS next_run_at
     FROM jobs
     GROUP BY job_type
     ORDER BY queue_depth DESC, failed_jobs DESC, blocked_jobs DESC, stale_leases DESC, job_type ASC`
  );
  const [failureBreakdownRows] = await pool.execute<RowData[]>(
    `SELECT job_type, job_key, last_error
     FROM jobs
     WHERE last_error IS NOT NULL
     ORDER BY updated_at DESC`
  );
  const queueRow = queueRows[0] ?? {};
  const oldestPendingAt = fromSqlDate(queueRow.oldest_pending_at);
  const oldestPendingAgeHours = oldestPendingAt
    ? Math.max(0, Math.round(((Date.now() - new Date(oldestPendingAt).getTime()) / 3_600_000) * 10) / 10)
    : null;
  const failure = failureRows[0];
  const failureByType = new Map<string, string>();
  for (const row of failureBreakdownRows) {
    const jobType = asString(row.job_type);
    if (!failureByType.has(jobType)) {
      failureByType.set(jobType, `${asString(row.job_key)}: ${asString(row.last_error)}`);
    }
  }
  const oldestPendingWarnHours = jobQueueOldestPendingWarnHoursFromEnv();
  const byType = jobQueueTypeHealthFromRows(breakdownRows, failureByType, oldestPendingWarnHours);
  const baseHealth = {
    queueDepth: asNumber(queueRow.queue_depth),
    runningJobs: asNumber(runningRows[0]?.running_jobs),
    failedJobs: asNumber(failedRows[0]?.failed_jobs),
    blockedJobs: asNumber(blockedRows[0]?.blocked_jobs),
    staleLeases: asNumber(staleRows[0]?.stale_leases),
    oldestPendingAgeHours,
    nextRunAt: fromSqlDate(nextRows[0]?.next_run_at),
    latestFailure: failure ? `${asString(failure.job_key)}: ${asString(failure.last_error)}` : null
  };

  return {
    status: jobQueueHealthStatus(baseHealth, oldestPendingWarnHours),
    ...baseHealth,
    recommendedAction: jobQueueRecommendedAction(baseHealth, oldestPendingWarnHours),
    byType
  };
}

export function jobQueueTypeHealthFromRows(
  rows: RowData[],
  failureByType: Map<string, string>,
  oldestPendingWarnHours = jobQueueOldestPendingWarnHoursFromEnv()
): JobQueueTypeHealth[] {
  return rows.map((row) => {
    const oldestPendingAt = fromSqlDate(row.oldest_pending_at);
    const latestFailure = failureByType.get(asString(row.job_type)) ?? null;
    const baseHealth = {
      queueDepth: asNumber(row.queue_depth),
      runningJobs: asNumber(row.running_jobs),
      failedJobs: asNumber(row.failed_jobs),
      blockedJobs: asNumber(row.blocked_jobs),
      staleLeases: asNumber(row.stale_leases),
      oldestPendingAgeHours: oldestPendingAt
        ? Math.max(0, Math.round(((Date.now() - new Date(oldestPendingAt).getTime()) / 3_600_000) * 10) / 10)
        : null,
      nextRunAt: asNullableString(fromSqlDate(row.next_run_at)),
      latestFailure
    };

    return {
      jobType: asString(row.job_type),
      status: jobQueueHealthStatus(baseHealth, oldestPendingWarnHours),
      ...baseHealth,
      recommendedAction: jobQueueRecommendedAction(baseHealth, oldestPendingWarnHours)
    };
  });
}
