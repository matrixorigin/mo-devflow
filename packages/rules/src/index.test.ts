import { describe, expect, test } from "vitest";
import type { RepoProfile } from "@mo-devflow/shared";
import { aiDriftSignalsForIssue, normalizeIssue, normalizePullRequest, workflowViolationsForIssue } from "./index";

const profile: RepoProfile = {
  key: "matrixorigin/matrixone",
  repo: { owner: "matrixorigin", name: "matrixone" },
  reporting: { timezone: "Asia/Shanghai", weekStart: "Monday" },
  access: {
    anonymousRead: true,
    exposeUserTokenSyncedPrivateData: false,
    criticalScope: "repo-wide"
  },
  people: { watchedUsers: ["alice"], testers: [] },
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

describe("rules", () => {
  test("critical issue is repo-wide and owner is derived from assignee first", () => {
    const issue = normalizeIssue(
      profile,
      {
        id: 1,
        number: 7,
        title: "panic on insert",
        state: "open",
        user: { login: "reporter" },
        html_url: "https://example.test/7",
        created_at: "2026-07-01T00:00:00Z",
        updated_at: "2026-07-01T01:00:00Z",
        labels: [{ name: "kind/bug" }, { name: "severity/s0" }],
        assignees: [{ login: "owner" }]
      },
      "anonymous"
    );

    expect(issue.lifecycleState).toBe("critical");
    expect(issue.severity).toBe("severity/s0");
    expect(issue.ownerLogin).toBe("owner");
    expect(issue.ownerReason).toBe("assignee");
    expect(issue.visibilityClass).toBe("anonymous_readable");
  });

  test("stale PR attention uses last human action", () => {
    const pr = normalizePullRequest(
      profile,
      {
        id: 2,
        number: 8,
        title: "fix",
        state: "open",
        user: { login: "alice" },
        html_url: "https://example.test/8",
        created_at: "2026-06-01T00:00:00Z",
        updated_at: "2026-06-01T00:00:00Z",
        head: { ref: "fix" },
        base: { ref: "main" }
      },
      "anonymous"
    );

    expect(pr.ownerLogin).toBe("alice");
    expect(pr.attentionFlags).toContain("no_human_action_24h");
  });

  test("detailed PR stale check ignores fresh system-only updates", () => {
    const staleHumanAction = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const freshSystemUpdate = new Date().toISOString();
    const pr = normalizePullRequest(
      profile,
      {
        id: 3,
        number: 9,
        title: "fix stale system update",
        state: "open",
        user: { login: "alice" },
        html_url: "https://example.test/9",
        created_at: "2026-06-01T00:00:00Z",
        updated_at: freshSystemUpdate,
        head: { ref: "fix" },
        base: { ref: "main" }
      },
      "anonymous",
      {
        number: 9,
        reviewDecision: null,
        mergeStateStatus: "clean",
        ciState: "success",
        latestReviewState: null,
        latestReviewSubmittedAt: null,
        latestCommitAt: staleHumanAction,
        detailSyncedAt: freshSystemUpdate,
        detailError: null
      }
    );

    expect(pr.lastHumanActionAt).toBe(staleHumanAction);
    expect(pr.attentionFlags).toContain("no_human_action_24h");
    expect(pr.attentionFlags).not.toContain("ci_failed");
  });

  test("PR attention includes requested changes, failed CI, and merge conflict", () => {
    const now = new Date().toISOString();
    const pr = normalizePullRequest(
      profile,
      {
        id: 4,
        number: 10,
        title: "fix broken pr",
        state: "open",
        user: { login: "alice" },
        html_url: "https://example.test/10",
        created_at: "2026-06-01T00:00:00Z",
        updated_at: now,
        head: { ref: "fix" },
        base: { ref: "main" }
      },
      "anonymous",
      {
        number: 10,
        reviewDecision: "changes_requested",
        mergeStateStatus: "dirty",
        ciState: "failure",
        latestReviewState: "CHANGES_REQUESTED",
        latestReviewSubmittedAt: now,
        latestCommitAt: now,
        detailSyncedAt: now,
        detailError: null
      }
    );

    expect(pr.attentionFlags).toContain("requested_changes");
    expect(pr.attentionFlags).toContain("ci_failed");
    expect(pr.attentionFlags).toContain("merge_conflict");
  });

  test("testing flow detects configured tester reviewer handoff", () => {
    const pr = normalizePullRequest(
      {
        ...profile,
        people: { ...profile.people, testers: ["tester-a"] }
      },
      {
        id: 12,
        number: 18,
        title: "handoff",
        state: "open",
        user: { login: "alice" },
        html_url: "https://example.test/18",
        created_at: "2026-07-01T00:00:00Z",
        updated_at: "2026-07-02T00:00:00Z",
        head: { ref: "fix" },
        base: { ref: "main" },
        requested_reviewers: [{ login: "tester-a" }]
      },
      "anonymous"
    );

    expect(pr.testingState).toBe("test_requested");
    expect(pr.testingTesters).toEqual(["tester-a"]);
    expect(pr.testingSignals).toContain("reviewer:tester-a");
    expect(pr.testingQueueAgeHours).not.toBeNull();
  });

  test("testing flow supports label and assignee handoff signals", () => {
    const pr = normalizePullRequest(
      {
        ...profile,
        testing: {
          handoffSignals: {
            labels: ["testing/requested"],
            reviewerUsers: [],
            assigneeUsers: ["qa-owner"],
            comments: []
          }
        }
      },
      {
        id: 13,
        number: 19,
        title: "label handoff",
        state: "open",
        user: { login: "alice" },
        html_url: "https://example.test/19",
        created_at: "2026-07-01T00:00:00Z",
        updated_at: "2026-07-02T00:00:00Z",
        labels: [{ name: "testing/requested" }],
        assignees: [{ login: "qa-owner" }],
        head: { ref: "fix" },
        base: { ref: "main" }
      },
      "anonymous"
    );

    expect(pr.testingState).toBe("test_requested");
    expect(pr.testingTesters).toEqual(["qa-owner"]);
    expect(pr.testingSignals).toEqual(expect.arrayContaining(["label:testing/requested", "assignee:qa-owner"]));
  });

  test("testing flow reflects requested changes, approval, and close states", () => {
    const testProfile = { ...profile, people: { ...profile.people, testers: ["tester-a"] } };
    const basePr = {
      id: 14,
      number: 20,
      title: "review handoff",
      state: "open",
      user: { login: "alice" },
      html_url: "https://example.test/20",
      created_at: "2026-07-01T00:00:00Z",
      updated_at: "2026-07-02T00:00:00Z",
      requested_reviewers: [{ login: "tester-a" }],
      head: { ref: "fix" },
      base: { ref: "main" }
    };
    const now = new Date().toISOString();

    const changesRequested = normalizePullRequest(testProfile, basePr, "anonymous", {
      number: 20,
      reviewDecision: "changes_requested",
      mergeStateStatus: null,
      ciState: null,
      latestReviewState: "CHANGES_REQUESTED",
      latestReviewSubmittedAt: now,
      latestCommitAt: now,
      detailSyncedAt: now,
      detailError: null
    });
    const approved = normalizePullRequest(testProfile, basePr, "anonymous", {
      number: 20,
      reviewDecision: "approved",
      mergeStateStatus: null,
      ciState: null,
      latestReviewState: "APPROVED",
      latestReviewSubmittedAt: now,
      latestCommitAt: now,
      detailSyncedAt: now,
      detailError: null
    });
    const closed = normalizePullRequest(testProfile, { ...basePr, state: "closed", closed_at: now }, "anonymous");

    expect(changesRequested.testingState).toBe("test_changes_requested");
    expect(approved.testingState).toBe("test_passed");
    expect(closed.testingState).toBe("closed_or_merged");
  });

  test("workflow violations detect bug issues missing intake triage", () => {
    const issue = normalizeIssue(
      profile,
      {
        id: 5,
        number: 11,
        title: "bug without intake",
        state: "open",
        user: { login: "reporter" },
        html_url: "https://example.test/11",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        labels: [{ name: "kind/bug" }],
        assignees: []
      },
      "anonymous"
    );

    expect(workflowViolationsForIssue(profile, issue).map((item) => item.ruleKey)).toContain("bug_missing_needs_triage");
  });

  test("workflow violations detect stale needs-triage issues", () => {
    const issue = normalizeIssue(
      profile,
      {
        id: 6,
        number: 12,
        title: "old triage",
        state: "open",
        user: { login: "reporter" },
        html_url: "https://example.test/12",
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-02T00:00:00Z",
        labels: [{ name: "kind/bug" }, { name: "needs-triage" }],
        assignees: [{ login: "alice" }]
      },
      "anonymous"
    );

    expect(workflowViolationsForIssue(profile, issue).map((item) => item.ruleKey)).toContain("needs_triage_stale");
  });

  test("workflow violations detect premature active severity", () => {
    const issue = normalizeIssue(
      profile,
      {
        id: 7,
        number: 13,
        title: "premature severity",
        state: "open",
        user: { login: "reporter" },
        html_url: "https://example.test/13",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        labels: [{ name: "kind/bug" }, { name: "severity/s0" }],
        assignees: [{ login: "alice" }]
      },
      "anonymous"
    );

    expect(workflowViolationsForIssue(profile, issue).map((item) => item.ruleKey)).toContain("premature_active_severity");
  });

  test("workflow violations do not mark old active severity as premature without timeline evidence", () => {
    const issue = normalizeIssue(
      profile,
      {
        id: 8,
        number: 14,
        title: "old active critical",
        state: "open",
        user: { login: "reporter" },
        html_url: "https://example.test/14",
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-02T00:00:00Z",
        labels: [{ name: "kind/bug" }, { name: "severity/s0" }],
        assignees: [{ login: "alice" }]
      },
      "anonymous"
    );

    expect(workflowViolationsForIssue(profile, issue).map((item) => item.ruleKey)).not.toContain("premature_active_severity");
  });

  test("workflow violations detect conflicting lifecycle labels", () => {
    const issue = normalizeIssue(
      profile,
      {
        id: 9,
        number: 15,
        title: "conflicting state",
        state: "open",
        user: { login: "reporter" },
        html_url: "https://example.test/15",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        labels: [{ name: "kind/bug" }, { name: "needs-triage" }, { name: "severity/s0" }],
        assignees: [{ login: "alice" }]
      },
      "anonymous"
    );

    const rules = workflowViolationsForIssue(profile, issue).map((item) => item.ruleKey);
    expect(rules).toContain("conflicting_lifecycle_labels");
  });

  test("AI drift detects missing effort labels on critical issues", () => {
    const issue = normalizeIssue(
      profile,
      {
        id: 10,
        number: 16,
        title: "critical missing effort",
        state: "open",
        user: { login: "reporter" },
        html_url: "https://example.test/16",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        labels: [{ name: "kind/bug" }, { name: "severity/s0" }],
        assignees: [{ login: "alice" }]
      },
      "anonymous"
    );

    expect(aiDriftSignalsForIssue(profile, issue).map((item) => item.ruleKey)).toContain("critical_missing_ai_effort");
  });

  test("AI drift detects old ai-easy critical issues with partial-cache evidence", () => {
    const issue = normalizeIssue(
      profile,
      {
        id: 11,
        number: 17,
        title: "old ai easy critical",
        state: "open",
        user: { login: "reporter" },
        html_url: "https://example.test/17",
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-02T00:00:00Z",
        labels: [{ name: "kind/bug" }, { name: "severity/s0" }, { name: "ai-easy" }],
        assignees: [{ login: "alice" }]
      },
      "anonymous"
    );

    const signals = aiDriftSignalsForIssue(profile, issue);
    expect(signals.map((item) => item.ruleKey)).toContain("ai_easy_critical_too_old");
    expect(signals.find((item) => item.ruleKey === "ai_easy_critical_too_old")?.sourceCompleteness).toBe("partial_cache");
  });
});
