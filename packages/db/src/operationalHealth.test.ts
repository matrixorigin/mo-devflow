import { describe, expect, test } from "vitest";
import type { SyncHealth } from "@mo-devflow/shared";
import { activeCacheStaleSummarySql } from "./cacheHealthSql";
import { cacheHealthStatus, operationalHealthRecommendedAction, operationalHealthStatus } from "./operationalHealth";

function layer(input: Partial<SyncHealth> & Pick<SyncHealth, "layer">): SyncHealth {
  return {
    layer: input.layer,
    status: input.status ?? "success",
    lastSuccessfulAt: input.lastSuccessfulAt ?? "2026-07-04T00:00:00.000Z",
    lastAttemptedAt: input.lastAttemptedAt ?? "2026-07-04T00:00:00.000Z",
    lastFailedAt: input.lastFailedAt ?? null,
    lastFailureMessage: input.lastFailureMessage ?? null,
    errorMessage: input.errorMessage ?? null,
    rateLimitRemaining: input.rateLimitRemaining ?? null,
    skipped: input.skipped ?? false,
    skipReason: input.skipReason ?? null
  };
}

const healthyInput = {
  syncHealth: [layer({ layer: "github_sync" })],
  staleObjects: 0,
  notificationFailures: 0,
  webhookFailures: 0
};

describe("operational health summary", () => {
  test("keeps healthy sync and cache as healthy", () => {
    expect(operationalHealthStatus(healthyInput)).toBe("healthy");
    expect(cacheHealthStatus({ staleObjects: 0, partialObjects: 0 })).toBe("healthy");
  });

  test("marks stale cache, failed sync, notification failures, and webhook failures as degraded", () => {
    expect(operationalHealthStatus({ ...healthyInput, staleObjects: 1 })).toBe("degraded");
    expect(
      operationalHealthStatus({
        ...healthyInput,
        syncHealth: [layer({ layer: "github_sync", status: "blocked", errorMessage: "permission denied" })]
      })
    ).toBe("degraded");
    expect(operationalHealthStatus({ ...healthyInput, notificationFailures: 1 })).toBe("degraded");
    expect(operationalHealthStatus({ ...healthyInput, webhookFailures: 1 })).toBe("degraded");
  });

  test("separates partial cache warnings from stale cache degradation", () => {
    expect(cacheHealthStatus({ staleObjects: 0, partialObjects: 3 })).toBe("partial");
    expect(operationalHealthStatus({ ...healthyInput, staleObjects: 0 })).toBe("healthy");
  });

  test("stale cache SQL only treats active visible GitHub objects as freshness degraders", () => {
    const sql = activeCacheStaleSummarySql({
      staleCutoff: "2026-07-04 00:00:00",
      issueWhereSql: "i.visibility_class = 'anonymous_readable'",
      pullRequestWhereSql: "p.visibility_class = 'anonymous_readable'"
    });

    expect(sql).toContain("i.state = 'open'");
    expect(sql).toContain("i.is_pull_request = 0");
    expect(sql).toContain("p.state = 'open'");
    expect(sql).toContain("i.visibility_class = 'anonymous_readable'");
    expect(sql).toContain("p.visibility_class = 'anonymous_readable'");
    expect(sql).not.toContain("is_complete");
  });

  test("returns the highest priority recovery action", () => {
    expect(
      operationalHealthRecommendedAction({
        syncHealth: [layer({ layer: "github_sync", status: "failed", errorMessage: "rate limited" })],
        staleObjects: 2,
        notificationFailures: 1,
        webhookFailures: 1,
        latestWebhookFailure: "delivery-1: bad payload"
      })
    ).toContain("github_sync");

    expect(
      operationalHealthRecommendedAction({
        syncHealth: [layer({ layer: "github_sync" })],
        staleObjects: 0,
        notificationFailures: 0,
        webhookFailures: 1,
        latestWebhookFailure: "delivery-1: bad payload"
      })
    ).toContain("delivery-1");
  });
});
