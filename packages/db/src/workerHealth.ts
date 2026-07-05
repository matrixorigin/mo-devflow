import type { RowDataPacket } from "mysql2";
import type { WorkerHeartbeatPhase, WorkerHealth } from "@mo-devflow/shared";
import { parseJsonRecord } from "@mo-devflow/shared";
import { fromSqlDate, getPool, nowSql, sqlDate } from "./client";

interface RowData extends RowDataPacket {
  [key: string]: unknown;
}

export interface WorkerHeartbeatInput {
  workerId: string;
  processId: number;
  host: string;
  phase: WorkerHeartbeatPhase;
  processStartedAt: string;
  lastTickStartedAt?: string | null;
  lastTickFinishedAt?: string | null;
  lastError?: string | null;
  details?: Record<string, unknown> | null;
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

export function workerHeartbeatStaleSecondsFromEnv(env: Record<string, string | undefined> = process.env): number {
  const configured = Number(env.MO_DEVFLOW_WORKER_HEARTBEAT_STALE_SECONDS);
  if (Number.isFinite(configured) && configured > 0) {
    return Math.max(30, Math.floor(configured));
  }
  const tickSeconds = Number(env.MO_DEVFLOW_WORKER_TICK_SECONDS ?? "30");
  const effectiveTickSeconds = Number.isFinite(tickSeconds) && tickSeconds > 0 ? tickSeconds : 30;
  return Math.max(120, Math.floor(effectiveTickSeconds * 3));
}

export function workerHealthRecommendedAction(status: WorkerHealth["status"]): string | null {
  if (status === "active") {
    return null;
  }
  if (status === "offline") {
    return "Start the worker process; in local development run `make dev-worker-start`.";
  }
  if (status === "stale") {
    return "Check worker.log for a stalled process, then restart the worker process.";
  }
  return "Inspect worker.log for the last failure, fix the cause, then restart the worker process.";
}

export async function recordWorkerHeartbeat(input: WorkerHeartbeatInput): Promise<void> {
  const now = nowSql();
  const values = [
    input.workerId,
    input.processId,
    input.host,
    input.phase,
    now,
    sqlDate(input.lastTickStartedAt),
    sqlDate(input.lastTickFinishedAt),
    input.lastError ?? null,
    stringify(input.details ?? null),
    sqlDate(input.processStartedAt),
    now
  ];

  try {
    await getPool().execute(
      `INSERT INTO worker_heartbeats(
        worker_id, process_id, host, phase, heartbeat_at,
        last_tick_started_at, last_tick_finished_at, last_error,
        details_json, started_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      values
    );
  } catch (error) {
    if (!isDuplicateError(error)) {
      throw error;
    }
    await getPool().execute(
      `UPDATE worker_heartbeats
       SET process_id = ?,
           host = ?,
           phase = ?,
           heartbeat_at = ?,
           last_tick_started_at = ?,
           last_tick_finished_at = ?,
           last_error = ?,
           details_json = ?,
           started_at = ?,
           updated_at = ?
       WHERE worker_id = ?`,
      [
        input.processId,
        input.host,
        input.phase,
        now,
        sqlDate(input.lastTickStartedAt),
        sqlDate(input.lastTickFinishedAt),
        input.lastError ?? null,
        stringify(input.details ?? null),
        sqlDate(input.processStartedAt),
        now,
        input.workerId
      ]
    );
  }
}

export async function getWorkerHealth(staleAfterSeconds = workerHeartbeatStaleSecondsFromEnv()): Promise<WorkerHealth> {
  const [rows] = await getPool().execute<RowData[]>(
    `SELECT worker_id, process_id, host, phase, heartbeat_at,
            last_tick_started_at, last_tick_finished_at, last_error, details_json
     FROM worker_heartbeats
     ORDER BY heartbeat_at DESC, id DESC
     LIMIT 1`
  );
  const row = rows[0];
  if (!row) {
    return {
      status: "offline",
      phase: null,
      workerId: null,
      processId: null,
      host: null,
      heartbeatAt: null,
      lastTickStartedAt: null,
      lastTickFinishedAt: null,
      secondsSinceHeartbeat: null,
      staleAfterSeconds,
      lastError: null,
      recommendedAction: workerHealthRecommendedAction("offline"),
      details: null
    };
  }

  const heartbeatAt = fromSqlDate(row.heartbeat_at);
  const secondsSinceHeartbeat = heartbeatAt
    ? Math.max(0, Math.round((Date.now() - new Date(heartbeatAt).getTime()) / 1000))
    : null;
  const phase = asString(row.phase) as WorkerHeartbeatPhase;
  const status =
    secondsSinceHeartbeat === null || secondsSinceHeartbeat > staleAfterSeconds
      ? "stale"
      : phase === "stopped"
        ? "offline"
        : phase === "failed"
          ? "failed"
          : "active";

  return {
    status,
    phase,
    workerId: asString(row.worker_id),
    processId: asNumber(row.process_id),
    host: asString(row.host),
    heartbeatAt,
    lastTickStartedAt: fromSqlDate(row.last_tick_started_at),
    lastTickFinishedAt: fromSqlDate(row.last_tick_finished_at),
    secondsSinceHeartbeat,
    staleAfterSeconds,
    lastError: row.last_error ? asString(row.last_error) : null,
    recommendedAction: workerHealthRecommendedAction(status),
    details: parseJsonRecord<Record<string, unknown> | null>(asString(row.details_json), null)
  };
}
