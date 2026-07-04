import type { DashboardViewer } from "@mo-devflow/db";
import type { DashboardSummary, RepoProfile } from "@mo-devflow/shared";
import { describe, expect, test, vi } from "vitest";
import { createDashboardSummaryCache, dashboardCacheTtlMsFromEnv } from "./dashboardCache";

const profile = {
  key: "matrixorigin/matrixone",
  repo: { owner: "matrixorigin", name: "matrixone", localPath: null },
  reporting: { timezone: "Asia/Shanghai", weekStart: "Monday" },
  access: { anonymousRead: true, exposeUserTokenSyncedPrivateData: false, criticalScope: "repo-wide" },
  people: { watchedUsers: ["alice"], testers: [] },
  ownership: { issueOwnerPriority: ["assignee"], prOwner: "author", unownedBucket: true },
  notifications: {
    wecom: { enabled: false, webhookUrlEnv: "MO_DEVFLOW_WECOM_WEBHOOK_URL", quietHours: null },
    employees: {},
    routing: {}
  },
  labels: {
    bug: "kind/bug",
    needsTriage: "needs-triage",
    deferred: "deferred",
    critical: ["severity/s-1", "severity/s0"],
    active: ["severity/s-1", "severity/s0", "severity/s1"],
    aiEffort: ["ai-easy", "ai-manual"]
  },
  thresholds: {
    prNoActionAttentionHours: 24,
    criticalNoActionAttentionHours: 24,
    aiEasyS0ToTestAttentionDays: 7
  },
  testing: {
    handoffSignals: { labels: [], reviewerUsers: [], assigneeUsers: [], comments: [] },
    states: {}
  },
  workflow: { skipUsers: [] }
} as unknown as RepoProfile;

const anonymousViewer: DashboardViewer = { authenticated: false, userId: null };

function summary(label: string): DashboardSummary {
  return { repo: { key: label } } as unknown as DashboardSummary;
}

describe("dashboard summary cache", () => {
  test("uses the cached dashboard when the data version is unchanged and fresh", async () => {
    let now = 1_000;
    const cache = createDashboardSummaryCache({ now: () => now, ttlMs: 10_000 });
    const buildSummary = vi.fn().mockResolvedValue(summary("first"));
    const loadVersion = vi.fn().mockResolvedValue("v1");

    const first = await cache.get({ profile, viewer: anonymousViewer, loadVersion, buildSummary });
    const second = await cache.get({ profile, viewer: anonymousViewer, loadVersion, buildSummary });

    expect(first.status).toBe("miss");
    expect(second.status).toBe("hit");
    expect(second.summary).toEqual(summary("first"));
    expect(buildSummary).toHaveBeenCalledTimes(1);
    expect(loadVersion).toHaveBeenCalledTimes(2);

    now += 11_000;
    buildSummary.mockResolvedValue(summary("expired"));
    const expired = await cache.get({ profile, viewer: anonymousViewer, loadVersion, buildSummary });
    expect(expired.status).toBe("miss");
    expect(expired.summary).toEqual(summary("expired"));
    expect(buildSummary).toHaveBeenCalledTimes(2);
  });

  test("rebuilds when the dashboard data version changes", async () => {
    const cache = createDashboardSummaryCache({ now: () => 1_000, ttlMs: 10_000 });
    const buildSummary = vi.fn().mockResolvedValueOnce(summary("v1")).mockResolvedValueOnce(summary("v2"));
    const loadVersion = vi.fn().mockResolvedValueOnce("v1").mockResolvedValueOnce("v2");

    await cache.get({ profile, viewer: anonymousViewer, loadVersion, buildSummary });
    const changed = await cache.get({ profile, viewer: anonymousViewer, loadVersion, buildSummary });

    expect(changed.status).toBe("miss");
    expect(changed.summary).toEqual(summary("v2"));
    expect(buildSummary).toHaveBeenCalledTimes(2);
  });

  test("keeps anonymous and authenticated dashboards isolated", async () => {
    const cache = createDashboardSummaryCache({ now: () => 1_000, ttlMs: 10_000 });
    const buildSummary = vi.fn().mockResolvedValueOnce(summary("anonymous")).mockResolvedValueOnce(summary("user"));
    const loadVersion = vi.fn().mockResolvedValue("v1");
    const userViewer: DashboardViewer = { authenticated: true, userId: 7 };

    await cache.get({ profile, viewer: anonymousViewer, loadVersion, buildSummary });
    const userResult = await cache.get({ profile, viewer: userViewer, loadVersion, buildSummary });

    expect(userResult.status).toBe("miss");
    expect(userResult.summary).toEqual(summary("user"));
    expect(buildSummary).toHaveBeenCalledTimes(2);
  });

  test("returns not modified when the request etag matches a fresh cached summary", async () => {
    const cache = createDashboardSummaryCache({ now: () => 1_000, ttlMs: 10_000 });
    const buildSummary = vi.fn().mockResolvedValue(summary("first"));
    const loadVersion = vi.fn().mockResolvedValue("v1");

    const first = await cache.get({ profile, viewer: anonymousViewer, loadVersion, buildSummary });
    const second = await cache.get({
      profile,
      viewer: anonymousViewer,
      loadVersion,
      buildSummary,
      ifNoneMatch: first.etag
    });

    expect(second.status).toBe("not-modified");
    expect(second.summary).toBeNull();
    expect(second.etag).toBe(first.etag);
    expect(buildSummary).toHaveBeenCalledTimes(1);
  });

  test("serves the previous summary when version probing fails after a successful build", async () => {
    const cache = createDashboardSummaryCache({ now: () => 1_000, ttlMs: 10_000 });
    const buildSummary = vi.fn().mockResolvedValue(summary("first"));
    const loadVersion = vi.fn().mockResolvedValueOnce("v1").mockRejectedValueOnce(new Error("db unavailable"));

    await cache.get({ profile, viewer: anonymousViewer, loadVersion, buildSummary });
    const fallback = await cache.get({ profile, viewer: anonymousViewer, loadVersion, buildSummary });

    expect(fallback.status).toBe("stale-if-error");
    expect(fallback.summary).toEqual(summary("first"));
    expect(buildSummary).toHaveBeenCalledTimes(1);
  });
});

describe("dashboard cache ttl config", () => {
  test("uses a 15 second default and accepts non-negative overrides", () => {
    expect(dashboardCacheTtlMsFromEnv({})).toBe(15_000);
    expect(dashboardCacheTtlMsFromEnv({ MO_DEVFLOW_DASHBOARD_CACHE_SECONDS: "0" })).toBe(0);
    expect(dashboardCacheTtlMsFromEnv({ MO_DEVFLOW_DASHBOARD_CACHE_SECONDS: "2.5" })).toBe(2_500);
    expect(dashboardCacheTtlMsFromEnv({ MO_DEVFLOW_DASHBOARD_CACHE_SECONDS: "-1" })).toBe(15_000);
    expect(dashboardCacheTtlMsFromEnv({ MO_DEVFLOW_DASHBOARD_CACHE_SECONDS: "nope" })).toBe(15_000);
  });
});
