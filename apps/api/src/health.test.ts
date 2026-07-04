import { describe, expect, test } from "vitest";
import type { JobQueueHealth, WorkerHealth } from "@mo-devflow/shared";
import { apiHealthStatus } from "./health";

const worker: WorkerHealth = {
  status: "active",
  phase: "idle",
  workerId: "worker",
  processId: 1,
  host: "localhost",
  heartbeatAt: "2026-07-04T00:00:00.000Z",
  lastTickStartedAt: "2026-07-04T00:00:00.000Z",
  lastTickFinishedAt: "2026-07-04T00:00:00.000Z",
  secondsSinceHeartbeat: 1,
  staleAfterSeconds: 120,
  lastError: null,
  recommendedAction: null,
  details: {}
};

const jobQueue: JobQueueHealth = {
  status: "healthy",
  queueDepth: 0,
  runningJobs: 0,
  failedJobs: 0,
  blockedJobs: 0,
  staleLeases: 0,
  oldestPendingAgeHours: null,
  nextRunAt: null,
  latestFailure: null,
  recommendedAction: null
};

describe("API health status", () => {
  test("is healthy only when worker and job queue are healthy", () => {
    expect(apiHealthStatus({ worker, jobQueue })).toBe("healthy");
  });

  test("degrades for worker or job queue attention states", () => {
    expect(apiHealthStatus({ worker: { ...worker, status: "stale" }, jobQueue })).toBe("degraded");
    expect(apiHealthStatus({ worker, jobQueue: { ...jobQueue, status: "attention" } })).toBe("degraded");
  });
});
