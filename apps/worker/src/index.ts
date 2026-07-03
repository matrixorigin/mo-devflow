import { hostname } from "node:os";
import { loadEnv } from "@mo-devflow/config";
import { migrate, recordWorkerHeartbeat, workerHeartbeatStaleSecondsFromEnv } from "@mo-devflow/db";
import type { WorkerHeartbeatPhase } from "@mo-devflow/shared";
import { intervalSecondsFromEnv, runDueJobsOnce, workerIdFromEnv } from "./jobs";

loadEnv();

const intervalSeconds = intervalSecondsFromEnv("MO_DEVFLOW_WORKER_TICK_SECONDS", 30, 10);
const workerId = workerIdFromEnv();
const processStartedAt = new Date().toISOString();
const heartbeatIntervalMs = Math.max(10_000, Math.floor((workerHeartbeatStaleSecondsFromEnv() * 1000) / 3));
let heartbeatState: {
  phase: WorkerHeartbeatPhase;
  lastTickStartedAt?: string | null;
  lastTickFinishedAt?: string | null;
  lastError?: string | null;
  details?: Record<string, unknown> | null;
} = {
  phase: "starting"
};
let tickRunning = false;
let shuttingDown = false;

function setHeartbeatState(input: {
  phase?: WorkerHeartbeatPhase;
  lastTickStartedAt?: string | null;
  lastTickFinishedAt?: string | null;
  lastError?: string | null;
  details?: Record<string, unknown> | null;
}): void {
  heartbeatState = {
    ...heartbeatState,
    ...input
  };
}

async function flushHeartbeat(): Promise<void> {
  const state = heartbeatState;
  const effectiveDetails =
    state.phase === "running"
      ? {
          ...(state.details ?? {}),
          heartbeatIntervalMs
        }
      : state.details ?? null;

  await heartbeat({
    ...state,
    details: effectiveDetails
  });
}

async function heartbeat(input: {
  phase: WorkerHeartbeatPhase;
  lastTickStartedAt?: string | null;
  lastTickFinishedAt?: string | null;
  lastError?: string | null;
  details?: Record<string, unknown> | null;
}): Promise<void> {
  try {
    await recordWorkerHeartbeat({
      workerId,
      processId: process.pid,
      host: hostname(),
      processStartedAt,
      ...input
    });
  } catch (error) {
    console.error("[worker] heartbeat update failed", error);
  }
}

async function tick(): Promise<void> {
  const lastTickStartedAt = new Date().toISOString();
  setHeartbeatState({
    phase: "running",
    lastTickStartedAt,
    lastTickFinishedAt: null,
    lastError: null,
    details: null
  });
  await flushHeartbeat();
  try {
    const result = await runDueJobsOnce();
    if (result.claimedJobs > 0) {
      for (const run of result.runs) {
        console.log(`[worker] ${run.status} ${run.jobKey}: ${run.message}`);
      }
    } else {
      console.log("[worker] no due jobs");
    }
    setHeartbeatState({
      phase: "idle",
      lastTickStartedAt,
      lastTickFinishedAt: new Date().toISOString(),
      lastError: null,
      details: {
        seededJobs: result.seededJobs,
        claimedJobs: result.claimedJobs,
        completedJobs: result.completedJobs,
        failedJobs: result.failedJobs
      }
    });
    await flushHeartbeat();
  } catch (error) {
    console.error("[worker] job tick failed", error);
    setHeartbeatState({
      phase: "failed",
      lastTickStartedAt,
      lastTickFinishedAt: new Date().toISOString(),
      lastError: error instanceof Error ? error.message : String(error),
      details: null
    });
    await flushHeartbeat();
  }
}

async function tickIfIdle(): Promise<void> {
  if (tickRunning) {
    console.log("[worker] previous tick is still running");
    return;
  }
  tickRunning = true;
  try {
    await tick();
  } finally {
    tickRunning = false;
  }
}

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  setHeartbeatState({
    phase: "stopped",
    lastError: `received ${signal}`
  });
  await flushHeartbeat();
  process.exit(0);
}

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});
process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

await migrate();
await flushHeartbeat();
setInterval(() => {
  void flushHeartbeat();
}, heartbeatIntervalMs);
await tickIfIdle();
setInterval(() => {
  void tickIfIdle();
}, intervalSeconds * 1000);
