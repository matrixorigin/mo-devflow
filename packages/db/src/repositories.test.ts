import { describe, expect, test } from "vitest";
import type { CriticalIssueLinkedPullRequestView, DailyMetricPoint, RepoProfile } from "@mo-devflow/shared";
import { extractLinkedIssueNumbers } from "@mo-devflow/shared";
import {
  aggregateMetricPoints,
  cacheStaleHoursFromEnv,
  criticalIssueBlockersFromCache,
  isPersonalNeedsTriageIssue,
  visibleClassesForDashboard
} from "./repositories";

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

describe("linked PR issue references", () => {
  test("extracts strong GitHub issue links and closing keywords", () => {
    expect(
      extractLinkedIssueNumbers(
        "Fixes #123 and resolves https://github.com/matrixorigin/matrixone/issues/456\nSee also #789"
      )
    ).toEqual([123, 456]);
  });

  test("does not treat ordinary hash mentions as linked issues", () => {
    expect(extractLinkedIssueNumbers("Related discussion in #123 but not a closing reference")).toEqual([]);
  });

  test("deduplicates repeated issue references", () => {
    expect(extractLinkedIssueNumbers("Closes #42. Fixes #42")).toEqual([42]);
  });
});

describe("critical issue cache blockers", () => {
  const linkedPr: CriticalIssueLinkedPullRequestView = {
    number: 101,
    title: "fix critical issue",
    htmlUrl: "https://github.com/matrixorigin/matrixone/pull/101",
    state: "open",
    ownerLogin: "alice",
    ageHours: 30,
    lastHumanActionAt: "2026-07-03T00:00:00Z",
    reviewDecision: "changes_requested",
    mergeStateStatus: null,
    ciState: "failure",
    testingState: "not_ready",
    testingTesters: [],
    testingQueueAgeHours: null,
    attentionFlags: ["requested_changes", "ci_failed"],
    isComplete: true
  };

  test("surfaces cache-derived issue and linked PR blockers", () => {
    expect(
      criticalIssueBlockersFromCache({
        ownerLogin: null,
        aiEffortLabel: null,
        isComplete: false,
        syncError: null,
        linkedPullRequests: [linkedPr]
      }).map((blocker) => blocker.key)
    ).toEqual([
      "issue:unowned",
      "issue:missing_ai_effort",
      "issue:partial_cache",
      "pr:101:requested_changes",
      "pr:101:ci_failed"
    ]);
  });

  test("surfaces stalled testing handoff as a linked PR blocker", () => {
    const blockers = criticalIssueBlockersFromCache({
      ownerLogin: "alice",
      aiEffortLabel: "ai-easy",
      isComplete: true,
      syncError: null,
      linkedPullRequests: [
        {
          ...linkedPr,
          testingState: "test_requested",
          testingTesters: ["tester-a"],
          testingQueueAgeHours: 48,
          attentionFlags: ["testing_stalled"]
        }
      ]
    });

    expect(blockers).toContainEqual({
      key: "pr:101:testing_stalled",
      severity: "warning",
      message: "PR #101 is stalled in testing handoff.",
      relatedPrNumber: 101
    });
  });

  test("marks missing linked PR as informational cache evidence", () => {
    expect(
      criticalIssueBlockersFromCache({
        ownerLogin: "alice",
        aiEffortLabel: "ai-easy",
        isComplete: true,
        syncError: null,
        linkedPullRequests: []
      })
    ).toEqual([
      {
        key: "issue:no_linked_pr_in_cache",
        severity: "info",
        message: "No linked PR is visible in cache.",
        relatedPrNumber: null
      }
    ]);
  });
});

describe("metric aggregation", () => {
  const points: DailyMetricPoint[] = [
    {
      date: "2026-06-28",
      scopeType: "team",
      scopeKey: "all",
      prsCreated: 1,
      prsMerged: 0,
      issuesOpened: 1,
      issuesClosed: 0,
      issuesDeferred: 0,
      workflowViolationsDetected: 0,
      sourceCompleteness: "complete_cache",
      generatedAt: "2026-07-04T00:00:00Z"
    },
    {
      date: "2026-06-29",
      scopeType: "team",
      scopeKey: "all",
      prsCreated: 2,
      prsMerged: 1,
      issuesOpened: 0,
      issuesClosed: 0,
      issuesDeferred: 0,
      workflowViolationsDetected: 1,
      sourceCompleteness: "partial_cache",
      generatedAt: "2026-07-04T00:01:00Z"
    },
    {
      date: "2026-07-01",
      scopeType: "team",
      scopeKey: "all",
      prsCreated: 3,
      prsMerged: 1,
      issuesOpened: 2,
      issuesClosed: 1,
      issuesDeferred: 1,
      workflowViolationsDetected: 0,
      sourceCompleteness: "complete_cache",
      generatedAt: "2026-07-04T00:02:00Z"
    }
  ];

  test("aggregates weeks using the configured Monday start", () => {
    const weekly = aggregateMetricPoints(points, "week", "Monday");

    expect(weekly.map((point) => ({ start: point.periodStart, prsCreated: point.prsCreated }))).toEqual([
      { start: "2026-06-22", prsCreated: 1 },
      { start: "2026-06-29", prsCreated: 5 }
    ]);
    expect(weekly[1]).toMatchObject({
      periodEnd: "2026-07-06",
      label: "06-29-07-05",
      prsMerged: 2,
      issuesOpened: 2,
      issuesClosed: 1,
      issuesDeferred: 1,
      workflowViolationsDetected: 1,
      sourceCompleteness: "partial_cache",
      generatedAt: "2026-07-04T00:02:00Z"
    });
  });

  test("aggregates weeks using the configured Sunday start", () => {
    const weekly = aggregateMetricPoints(points, "week", "Sunday");

    expect(weekly.map((point) => ({ start: point.periodStart, prsCreated: point.prsCreated }))).toEqual([
      { start: "2026-06-28", prsCreated: 6 }
    ]);
  });

  test("aggregates months without mixing calendar boundaries", () => {
    const monthly = aggregateMetricPoints(points, "month", "Monday");

    expect(monthly.map((point) => ({ start: point.periodStart, end: point.periodEnd, created: point.prsCreated }))).toEqual([
      { start: "2026-06-01", end: "2026-07-01", created: 3 },
      { start: "2026-07-01", end: "2026-08-01", created: 3 }
    ]);
  });
});
