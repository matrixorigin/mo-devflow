import { describe, expect, test } from "vitest";
import type { RepoProfile } from "@mo-devflow/shared";
import { cacheStaleHoursFromEnv, isPersonalNeedsTriageIssue, visibleClassesForDashboard } from "./repositories";

const baseProfile: RepoProfile = {
  key: "matrixorigin/matrixone",
  repo: { owner: "matrixorigin", name: "matrixone" },
  reporting: { timezone: "Asia/Shanghai", weekStart: "Monday" },
  access: {
    anonymousRead: true,
    exposeUserTokenSyncedPrivateData: false,
    criticalScope: "repo-wide"
  },
  people: { watchedUsers: [], testers: [] },
  ownership: {
    issueOwnerPriority: ["assignee", "linked_pr_author", "author"],
    prOwner: "author",
    unownedBucket: true
  },
  labels: {
    bug: "kind/bug",
    needsTriage: "needs-triage",
    deferred: "deferred",
    critical: ["severity/s-1", "severity/s0"],
    active: ["severity/s-1", "severity/s0", "severity/s1"],
    aiEffort: ["ai-easy", "ai-light", "ai-medium", "ai-heavy", "ai-manual"]
  },
  thresholds: {
    prNoActionAttentionHours: 24,
    criticalNoActionAttentionHours: 24,
    aiEasyS0ToTestAttentionDays: 7,
    needsTriageStaleHours: 72,
    prematureSeverityWindowHours: 24,
    aiEasyCriticalCriticalDays: 14
  },
  testing: {
    handoffSignals: { labels: [], reviewerUsers: [], assigneeUsers: [], comments: [] }
  },
  notifications: {
    wecom: { enabled: false },
    employees: {},
    routing: { cooldownHours: 12, fallbackRecipient: "maintainer_group" }
  },
  raw: {}
};

describe("dashboard visibility", () => {
  test("anonymous viewers only see anonymous-readable cache objects", () => {
    expect(visibleClassesForDashboard(baseProfile, { authenticated: false })).toEqual(["anonymous_readable"]);
  });

  test("logged-in viewers can see anonymous and logged-in readable cache objects", () => {
    expect(visibleClassesForDashboard(baseProfile, { authenticated: true })).toEqual([
      "anonymous_readable",
      "logged_in_readable"
    ]);
  });

  test("anonymous viewers see no GitHub cache objects when anonymous read is disabled", () => {
    expect(
      visibleClassesForDashboard(
        {
          ...baseProfile,
          access: {
            ...baseProfile.access,
            anonymousRead: false
          }
        },
        { authenticated: false }
      )
    ).toEqual([]);
  });
});

describe("cache freshness", () => {
  test("uses a conservative default stale threshold", () => {
    expect(cacheStaleHoursFromEnv({})).toBe(6);
  });

  test("accepts configured positive stale threshold and ignores invalid values", () => {
    expect(cacheStaleHoursFromEnv({ MO_DEVFLOW_CACHE_STALE_HOURS: "0.5" })).toBe(0.5);
    expect(cacheStaleHoursFromEnv({ MO_DEVFLOW_CACHE_STALE_HOURS: "not-a-number" })).toBe(6);
    expect(cacheStaleHoursFromEnv({ MO_DEVFLOW_CACHE_STALE_HOURS: "-1" })).toBe(6);
  });
});

describe("personal issue buckets", () => {
  test("keeps critical issues out of the personal needs-triage action bucket", () => {
    expect(
      isPersonalNeedsTriageIssue(
        { lifecycleState: "needs-triage", severity: "severity/s0" },
        baseProfile.labels.critical
      )
    ).toBe(false);
    expect(
      isPersonalNeedsTriageIssue(
        { lifecycleState: "needs-triage", severity: null },
        baseProfile.labels.critical
      )
    ).toBe(true);
    expect(
      isPersonalNeedsTriageIssue(
        { lifecycleState: "deferred", severity: null },
        baseProfile.labels.critical
      )
    ).toBe(false);
  });
});
