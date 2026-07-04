import { describe, expect, test } from "vitest";
import type { DashboardSummary, SyncHealth } from "@mo-devflow/shared";
import { summarizeCacheEvidence, summarizeFreshness } from "./freshness";

function layer(input: Partial<SyncHealth> & Pick<SyncHealth, "layer">): SyncHealth {
  return {
    layer: input.layer,
    status: input.status ?? "success",
    lastSuccessfulAt: input.lastSuccessfulAt ?? "2026-07-04T01:00:00.000Z",
    lastAttemptedAt: input.lastAttemptedAt ?? "2026-07-04T01:00:00.000Z",
    lastFailedAt: input.lastFailedAt ?? null,
    lastFailureMessage: input.lastFailureMessage ?? null,
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

describe("cache evidence summary", () => {
  test("reports clear evidence when sync, cache, and visibility are clean", () => {
    expect(
      summarizeCacheEvidence({
        sync: sync({}),
        visibility: {
          scope: "anonymous",
          visibleClasses: ["anonymous_readable"],
          hiddenIssues: 0,
          hiddenPullRequests: 0,
          hiddenObjects: 0,
          note: null
        }
      })
    ).toMatchObject({
      severity: "ok",
      alertType: "success",
      title: "Evidence quality is clear",
      affectedConclusions: []
    });
  });

  test("treats stale active cache as the highest-priority evidence warning", () => {
    const summary = summarizeCacheEvidence({
      sync: sync({ staleObjects: 3, oldestCacheAgeHours: 9.5, staleThresholdHours: 6, partialObjects: 40 }),
      visibility: {
        scope: "anonymous",
        visibleClasses: ["anonymous_readable"],
        hiddenIssues: 0,
        hiddenPullRequests: 0,
        hiddenObjects: 0,
        note: null
      }
    });

    expect(summary).toMatchObject({
      severity: "warning",
      alertType: "warning",
      title: "Some active cache evidence is stale"
    });
    expect(summary.description).toContain("3 active visible GitHub objects");
    expect(summary.description).toContain("9.5h");
    expect(summary.affectedConclusions).toContain("current critical ownership and blockers");
    expect(summary.facts).toContain("40 cached objects are partial");
  });

  test("explains partial cache as incomplete evidence instead of system failure", () => {
    const summary = summarizeCacheEvidence({
      sync: sync({ partialObjects: 350 }),
      visibility: {
        scope: "anonymous",
        visibleClasses: ["anonymous_readable"],
        hiddenIssues: 0,
        hiddenPullRequests: 0,
        hiddenObjects: 0,
        note: null
      }
    });

    expect(summary).toMatchObject({
      severity: "warning",
      alertType: "warning",
      title: "Some workflow evidence is partial"
    });
    expect(summary.description).toContain("Known cached facts remain visible");
    expect(summary.description).toContain("not confirmed conclusions");
    expect(summary.affectedConclusions).toContain("deferred explanation checks");
    expect(summary.affectedConclusions).toContain("review, CI, mergeability, and testing handoff rules");
  });

  test("surfaces visibility filtering as access-scope evidence", () => {
    const summary = summarizeCacheEvidence({
      sync: sync({}),
      visibility: {
        scope: "anonymous",
        visibleClasses: ["anonymous_readable"],
        hiddenIssues: 2,
        hiddenPullRequests: 1,
        hiddenObjects: 3,
        note: "3 cached GitHub objects are hidden from this view."
      }
    });

    expect(summary).toMatchObject({
      severity: "info",
      alertType: "info",
      title: "This view is filtered by access policy"
    });
    expect(summary.description).toContain("anonymous");
    expect(summary.facts).toContain("3 cached GitHub objects are hidden");
  });
});
