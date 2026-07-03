import { describe, expect, test } from "vitest";
import type { RepoProfile } from "@mo-devflow/shared";
import { normalizeIssue, normalizePullRequest, workflowViolationsForIssue } from "./index";

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
    prematureSeverityWindowHours: 24
  },
  testing: {
    handoffSignals: { labels: [], reviewerUsers: [], assigneeUsers: [], comments: [] }
  },
  notifications: { wecom: { enabled: false }, employees: {} },
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
});
