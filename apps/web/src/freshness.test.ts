import { describe, expect, test } from "vitest";
import type { DashboardSummary, SyncHealth } from "@mo-devflow/shared";
import { summarizeFreshness } from "./freshness";

function layer(input: Partial<SyncHealth> & Pick<SyncHealth, "layer">): SyncHealth {
  return {
    layer: input.layer,
    status: input.status ?? "success",
    lastSuccessfulAt: input.lastSuccessfulAt ?? "2026-07-04T01:00:00.000Z",
    lastAttemptedAt: input.lastAttemptedAt ?? "2026-07-04T01:00:00.000Z",
    errorMessage: input.errorMessage ?? null,
    rateLimitRemaining: input.rateLimitRemaining ?? null
  };
}

function sync(input: Partial<DashboardSummary["sync"]>): DashboardSummary["sync"] {
  return {
    generatedAt: "2026-07-04T02:00:00.000Z",
    health: [
      layer({ layer: "github_sync", lastSuccessfulAt: "2026-07-04T00:30:00.000Z" }),
      layer({ layer: "rules", lastSuccessfulAt: "2026-07-04T01:00:00.000Z" })
    ],
    staleObjects: 0,
    staleThresholdHours: 6,
    oldestCacheAgeHours: 1,
    partialObjects: 0,
    jobQueue: {
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
    },
    worker: {
      status: "active",
      phase: "idle",
      workerId: "worker",
      processId: 1,
      host: "localhost",
      heartbeatAt: "2026-07-04T02:00:00.000Z",
      lastTickStartedAt: "2026-07-04T02:00:00.000Z",
      lastTickFinishedAt: "2026-07-04T02:00:00.000Z",
      secondsSinceHeartbeat: 1,
      staleAfterSeconds: 120,
      lastError: null,
      recommendedAction: null,
      details: {}
    },
    ...input
  };
}

describe("freshness summary", () => {
  test("reports a current cache when sync layers and object freshness are healthy", () => {
    expect(summarizeFreshness(sync({}))).toMatchObject({
      severity: "ok",
      label: "cache current",
      tagColor: "green",
      unhealthyLayers: [],
      oldestLayerSuccessAt: "2026-07-04T00:30:00.000Z"
    });
  });

  test("warns when cache objects are stale or partial even if sync layers are green", () => {
    expect(summarizeFreshness(sync({ staleObjects: 2, partialObjects: 1 }))).toMatchObject({
      severity: "warning",
      label: "cache needs attention",
      tagColor: "orange"
    });
  });

  test("reports critical degradation for failed or blocked sync layers", () => {
    const summary = summarizeFreshness(
      sync({
        health: [
          layer({ layer: "github_sync", status: "success" }),
          layer({ layer: "webhooks", status: "blocked", errorMessage: "permission denied" })
        ]
      })
    );

    expect(summary).toMatchObject({
      severity: "critical",
      label: "sync degraded",
      tagColor: "red"
    });
    expect(summary.unhealthyLayers.map((item) => item.layer)).toEqual(["webhooks"]);
  });
});
