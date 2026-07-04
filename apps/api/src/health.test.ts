import { describe, expect, test } from "vitest";
import type { JobQueueHealth, OperationalHealthSummary, WorkerHealth } from "@mo-devflow/shared";
import { apiHealthHttpStatus, apiHealthStatus } from "./health";

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

const operational: OperationalHealthSummary = {
  status: "healthy",
  recommendedAction: null,
  sync: {
    health: [],
    unhealthyLayers: [],
    rateLimitedLayers: []
  },
  cache: {
    status: "healthy",
    staleObjects: 0,
    staleThresholdHours: 6,
    oldestCacheAgeHours: null,
    partialObjects: 0
  },
  notifications: {
    failedDeliveries: 0
  },
  webhooks: {
    pendingDeliveries: 0,
    processedDeliveries: 0,
    failedDeliveries: 0,
    normalizationFailedDeliveries: 0,
    ignoredDeliveries: 0,
    duplicateDeliveries: 0,
    connectivityProbeDeliveries: 0,
    lastReceivedAt: null,
    lastConnectivityProbeAt: null,
    latestFailure: null,
    eventSummaries: [],
    recentDeliveries: []
  }
};

describe("API health status", () => {
  test("is healthy only when worker and job queue are healthy", () => {
    expect(apiHealthStatus({ worker, jobQueue, operational })).toBe("healthy");
  });

  test("degrades for worker, job queue, or operational attention states", () => {
    expect(apiHealthStatus({ worker: { ...worker, status: "stale" }, jobQueue, operational })).toBe("degraded");
    expect(apiHealthStatus({ worker, jobQueue: { ...jobQueue, status: "attention" }, operational })).toBe("degraded");
    expect(apiHealthStatus({ worker, jobQueue, operational: { ...operational, status: "degraded" } })).toBe("degraded");
    expect(apiHealthStatus({ worker, jobQueue, operational, operationalError: "Operational probe failed." })).toBe(
      "degraded"
    );
  });

  test("keeps degraded service readable but reports unhealthy service as unavailable", () => {
    expect(apiHealthHttpStatus("healthy")).toBe(200);
    expect(apiHealthHttpStatus("degraded")).toBe(200);
    expect(apiHealthHttpStatus("unhealthy")).toBe(503);
  });
});
