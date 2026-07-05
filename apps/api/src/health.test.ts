import { describe, expect, test } from "vitest";
import type { JobQueueHealth, OperationalHealthSummary, WorkerHealth } from "@mo-devflow/shared";
import { apiHealthFindings, apiHealthHttpStatus, apiHealthStatus } from "./health";

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
  recommendedAction: null,
  byType: []
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

  test("reports machine-readable degraded findings", () => {
    const findings = apiHealthFindings({
      worker: { ...worker, status: "stale", recommendedAction: "Restart the worker." },
      jobQueue: {
        ...jobQueue,
        status: "attention",
        staleLeases: 1,
        recommendedAction: "A running lease is stale."
      },
      operational: { ...operational, status: "degraded", recommendedAction: "Cache objects are stale." },
      operationalError: "Operational probe failed."
    });

    expect(findings).toEqual([
      { key: "worker", severity: "warning", message: "Restart the worker." },
      { key: "job_queue", severity: "critical", message: "A running lease is stale." },
      { key: "operational_summary", severity: "warning", message: "Operational probe failed." },
      { key: "operational", severity: "warning", message: "Cache objects are stale." }
    ]);
  });
});
