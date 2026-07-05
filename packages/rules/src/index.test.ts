import { describe, expect, test } from "vitest";
import type { RepoProfile } from "@mo-devflow/shared";
import {
  aiDriftSignalsForIssue,
  aiDriftSignalsForPullRequest,
  criticalAttentionForIssue,
  issueLastHumanActionAt,
  linkedPrAuthorsByIssueNumber,
  normalizeIssue,
  normalizePullRequest,
  workflowViolationsForIssue
} from "./index";

const profile: RepoProfile = {
  key: "matrixorigin/matrixone",
  repo: { owner: "matrixorigin", name: "matrixone" },
  reporting: { timezone: "Asia/Shanghai", weekStart: "Monday" },
  access: {
    anonymousRead: true,
    exposeUserTokenSyncedPrivateData: false,
    criticalScope: "repo-wide",
    writeBackEnabled: true
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
  testing: {},
  workflow: {
    skipUsers: []
  },
  notifications: {
    wecom: { enabled: false },
    employees: {},
    routing: { cooldownHours: 12, fallbackRecipient: "maintainer_group", escalateAfterHours: 24 }
  },
  raw: {}
};

const anonymousSource = { authType: "anonymous" as const, userId: null };

describe("rules", () => {
  test("s0 issue is active and owner is derived from assignee first", () => {
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
      anonymousSource
    );

    expect(issue.lifecycleState).toBe("active");
    expect(issue.severity).toBe("severity/s0");
    expect(issue.ownerLogin).toBe("owner");
    expect(issue.ownerReason).toBe("assignee");
    expect(issue.visibilityClass).toBe("anonymous_readable");
  });

  test("rejects user-token cache sources without a source user id", () => {
    expect(() =>
      normalizeIssue(
        profile,
        {
          id: 1,
          number: 7,
          title: "private issue",
          state: "open",
          user: { login: "reporter" }
        },
        { authType: "user_token", userId: null }
      )
    ).toThrow("user_token cache source requires source user id");
  });

  test("marks user-token cache as token-owner-only when profile does not expose it", () => {
    const issue = normalizeIssue(
      profile,
      {
        id: 1,
        number: 7,
        title: "private issue",
        state: "open",
        user: { login: "reporter" }
      },
      { authType: "user_token", userId: 42 }
    );

    expect(issue.sourceAuthType).toBe("user_token");
    expect(issue.sourceUserId).toBe(42);
    expect(issue.visibilityClass).toBe("token_owner_only");
  });

  test("issue owner can be derived from linked active PR author", () => {
    const issue = normalizeIssue(
      profile,
      {
        id: 12,
        number: 18,
        title: "panic with linked PR",
        state: "open",
        user: { login: "reporter" },
        html_url: "https://example.test/18",
        created_at: "2026-07-01T00:00:00Z",
        updated_at: "2026-07-01T01:00:00Z",
        labels: [{ name: "kind/bug" }, { name: "severity/s0" }],
        assignees: []
      },
      anonymousSource,
      { linkedPrAuthorByIssueNumber: new Map([[18, "pr-author"]]) }
    );

    expect(issue.ownerLogin).toBe("pr-author");
    expect(issue.ownerReason).toBe("linked_pr_author");
  });

  test("assignee issue owner wins before linked PR author", () => {
    const issue = normalizeIssue(
      profile,
      {
        id: 13,
        number: 19,
        title: "panic with assigned owner",
        state: "open",
        user: { login: "reporter" },
        html_url: "https://example.test/19",
        created_at: "2026-07-01T00:00:00Z",
        updated_at: "2026-07-01T01:00:00Z",
        labels: [{ name: "kind/bug" }, { name: "severity/s0" }],
        assignees: [{ login: "assigned-owner" }]
      },
      anonymousSource,
      { linkedPrAuthorByIssueNumber: new Map([[19, "pr-author"]]) }
    );

    expect(issue.ownerLogin).toBe("assigned-owner");
    expect(issue.ownerReason).toBe("assignee");
  });

  test("linked PR author hints use open PRs only", () => {
    const owners = linkedPrAuthorsByIssueNumber([
      {
        id: 14,
        number: 20,
        title: "Fixes #18",
        body: null,
        state: "open",
        user: { login: "open-author" }
      },
      {
        id: 15,
        number: 21,
        title: "Closes #19",
        body: null,
        state: "closed",
        user: { login: "closed-author" }
      }
    ]);

    expect(owners.get(18)).toBe("open-author");
    expect(owners.has(19)).toBe(false);
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
      anonymousSource
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
      anonymousSource,
      {
        number: 9,
        reviewDecision: null,
        mergeStateStatus: "clean",
        ciState: "success",
        latestReviewState: null,
        latestReviewSubmittedAt: null,
        latestCommitAt: staleHumanAction,
        linkedIssueNumbers: [],
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
      anonymousSource,
      {
        number: 10,
        reviewDecision: "changes_requested",
        mergeStateStatus: "dirty",
        ciState: "failure",
        latestReviewState: "CHANGES_REQUESTED",
        latestReviewSubmittedAt: now,
        latestCommitAt: now,
        linkedIssueNumbers: [],
        detailSyncedAt: now,
        detailError: null
      }
    );

    expect(pr.attentionFlags).toContain("requested_changes");
    expect(pr.attentionFlags).toContain("ci_failed");
    expect(pr.attentionFlags).toContain("merge_conflict");
  });

  test("PR attention includes stale review requests without response", () => {
    const staleUpdate = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const pr = normalizePullRequest(
      profile,
      {
        id: 401,
        number: 401,
        title: "waiting for review",
        state: "open",
        user: { login: "alice" },
        html_url: "https://example.test/401",
        created_at: staleUpdate,
        updated_at: staleUpdate,
        requested_reviewers: [{ login: "reviewer-a" }],
        head: { ref: "fix" },
        base: { ref: "main" }
      },
      anonymousSource,
      {
        number: 401,
        reviewDecision: null,
        mergeStateStatus: "clean",
        ciState: "success",
        latestReviewState: null,
        latestReviewSubmittedAt: null,
        latestCommitAt: staleUpdate,
        linkedIssueNumbers: [],
        detailSyncedAt: new Date().toISOString(),
        detailError: null
      }
    );

    expect(pr.attentionFlags).toContain("review_requested_no_response");
  });

  test("PR attention does not include review-request no-response after a review arrives", () => {
    const staleUpdate = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const now = new Date().toISOString();
    const pr = normalizePullRequest(
      profile,
      {
        id: 402,
        number: 402,
        title: "reviewed",
        state: "open",
        user: { login: "alice" },
        html_url: "https://example.test/402",
        created_at: staleUpdate,
        updated_at: staleUpdate,
        requested_reviewers: [{ login: "reviewer-a" }],
        head: { ref: "fix" },
        base: { ref: "main" }
      },
      anonymousSource,
      {
        number: 402,
        reviewDecision: "reviewed",
        mergeStateStatus: "clean",
        ciState: "success",
        latestReviewState: "COMMENTED",
        latestReviewSubmittedAt: now,
        latestCommitAt: staleUpdate,
        linkedIssueNumbers: [],
        detailSyncedAt: now,
        detailError: null
      }
    );

    expect(pr.attentionFlags).not.toContain("review_requested_no_response");
  });

  test("PR detail insight marks cache evidence complete when detail sync succeeds", () => {
    const now = new Date().toISOString();
    const completePr = normalizePullRequest(
      profile,
      {
        id: 40,
        number: 40,
        title: "reviewed pr",
        state: "open",
        user: { login: "alice" },
        html_url: "https://example.test/40",
        created_at: "2026-07-01T00:00:00Z",
        updated_at: now,
        head: { ref: "fix" },
        base: { ref: "main" }
      },
      anonymousSource,
      {
        number: 40,
        reviewDecision: "changes_requested",
        mergeStateStatus: "clean",
        ciState: "success",
        latestReviewState: "CHANGES_REQUESTED",
        latestReviewSubmittedAt: now,
        latestCommitAt: now,
        linkedIssueNumbers: [],
        detailSyncedAt: now,
        detailError: null
      }
    );
    const partialPr = normalizePullRequest(
      profile,
      {
        id: 41,
        number: 41,
        title: "detail failed pr",
        state: "open",
        user: { login: "alice" },
        html_url: "https://example.test/41",
        created_at: "2026-07-01T00:00:00Z",
        updated_at: now,
        head: { ref: "fix" },
        base: { ref: "main" }
      },
      anonymousSource,
      {
        number: 41,
        reviewDecision: null,
        mergeStateStatus: null,
        ciState: null,
        latestReviewState: null,
        latestReviewSubmittedAt: null,
        latestCommitAt: null,
        linkedIssueNumbers: [],
        detailSyncedAt: now,
        detailError: "GitHub API failed"
      }
    );

    expect(completePr.isComplete).toBe(true);
    expect(partialPr.isComplete).toBe(false);
  });

  test("skips workflow violations, AI drift, and critical attention for configured skip users", () => {
    const skippedProfile = {
      ...profile,
      workflow: { skipUsers: ["skip-me"] }
    };
    const issue = normalizeIssue(
      skippedProfile,
      {
        id: 50,
        number: 50,
        title: "critical skipped issue",
        state: "open",
        user: { login: "skip-me" },
        html_url: "https://example.test/50",
        created_at: "2026-07-01T00:00:00Z",
        updated_at: "2026-07-01T00:00:00Z",
        labels: [{ name: "kind/bug" }, { name: "severity/s0" }],
        assignees: []
      },
      anonymousSource
    );

    expect(workflowViolationsForIssue(skippedProfile, issue)).toEqual([]);
    expect(aiDriftSignalsForIssue(skippedProfile, issue)).toEqual([]);
    expect(criticalAttentionForIssue(skippedProfile, issue)).toEqual([]);

    const skippedPr = normalizePullRequest(
      skippedProfile,
      {
        id: 51,
        number: 51,
        title: "skipped pr with blockers",
        state: "open",
        user: { login: "skip-me" },
        html_url: "https://example.test/51",
        created_at: "2026-07-01T00:00:00Z",
        updated_at: "2026-07-01T00:00:00Z",
        labels: [{ name: "ai-easy" }],
        head: { ref: "fix" },
        base: { ref: "main" }
      },
      anonymousSource,
      {
        number: 51,
        reviewDecision: "changes_requested",
        mergeStateStatus: "dirty",
        ciState: "failure",
        latestReviewState: "CHANGES_REQUESTED",
        latestReviewSubmittedAt: "2026-07-01T01:00:00Z",
        latestCommitAt: "2026-07-01T00:30:00Z",
        linkedIssueNumbers: [],
        detailSyncedAt: "2026-07-01T01:00:00Z",
        detailError: null
      }
    );

    expect(skippedPr.workflowSkipped).toBe(true);
    expect(skippedPr.attentionFlags).toEqual([]);
    expect(aiDriftSignalsForPullRequest(skippedProfile, skippedPr)).toEqual([]);
  });

  test("critical issue attention uses complete human comment evidence when available", () => {
    const updatedAt = "2026-01-02T00:00:00Z";
    const recentCommentAt = new Date().toISOString();
    const issue = normalizeIssue(
      profile,
      {
        id: 51,
        number: 51,
        title: "critical with recent discussion",
        state: "open",
        user: { login: "reporter" },
        html_url: "https://example.test/51",
        created_at: "2026-01-01T00:00:00Z",
        updated_at: updatedAt,
        labels: [{ name: "kind/bug" }, { name: "severity/s0" }],
        assignees: [{ login: "alice" }]
      },
      anonymousSource
    );
    issue.commentEvidence = {
      isComplete: true,
      lastSyncedAt: recentCommentAt,
      syncError: null,
      comments: [
        {
          authorLogin: "alice",
          body: "Still investigating the active s0 path.",
          createdAt: recentCommentAt,
          updatedAt: recentCommentAt
        }
      ]
    };

    expect(issueLastHumanActionAt(issue)).toBe(recentCommentAt);
    expect(criticalAttentionForIssue(profile, issue)).toEqual([]);
  });

  test("testing flow ignores configured PR reviewer handoff", () => {
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
      anonymousSource
    );

    expect(pr.testingState).toBe("not_ready");
    expect(pr.testingTesters).toEqual([]);
    expect(pr.testingSignals).toEqual([]);
    expect(pr.testingQueueAgeHours).toBeNull();
  });

  test("pull-request scoped testing does not treat every configured tester review request as handoff", () => {
    const pr = normalizePullRequest(
      {
        ...profile,
        people: { ...profile.people, testers: ["tester-a"] }
      },
      {
        id: 12,
        number: 18,
        title: "ordinary tester review",
        state: "open",
        user: { login: "alice" },
        html_url: "https://example.test/18",
        created_at: "2026-07-01T00:00:00Z",
        updated_at: "2026-07-02T00:00:00Z",
        head: { ref: "fix" },
        base: { ref: "main" },
        requested_reviewers: [{ login: "tester-a" }]
      },
      anonymousSource
    );

    expect(pr.testingState).toBe("not_ready");
    expect(pr.testingTesters).toEqual([]);
    expect(pr.testingSignals).toEqual([]);
    expect(pr.testingQueueAgeHours).toBeNull();
  });

  test("default issue-scoped testing ignores PR reviewer handoff", () => {
    const pr = normalizePullRequest(
      {
        ...profile,
        people: { ...profile.people, testers: ["tester-a"] }
      },
      {
        id: 12,
        number: 18,
        title: "ordinary review",
        state: "open",
        user: { login: "alice" },
        html_url: "https://example.test/18",
        created_at: "2026-07-01T00:00:00Z",
        updated_at: "2026-07-02T00:00:00Z",
        head: { ref: "fix" },
        base: { ref: "main" },
        requested_reviewers: [{ login: "tester-a" }]
      },
      anonymousSource
    );

    expect(pr.testingState).toBe("not_ready");
    expect(pr.testingTesters).toEqual([]);
    expect(pr.testingQueueAgeHours).toBeNull();
  });

  test("does not keep self-referential linked issue numbers for pull requests", () => {
    const pr = normalizePullRequest(
      profile,
      {
        id: 18,
        number: 18,
        title: "fix: protocol panic on execute (#18)",
        body: "Fixes #18 and relates to #42",
        state: "open",
        user: { login: "alice" },
        html_url: "https://example.test/18",
        created_at: "2026-07-01T00:00:00Z",
        updated_at: "2026-07-02T00:00:00Z",
        head: { ref: "fix" },
        base: { ref: "main" }
      },
      anonymousSource,
      {
        number: 18,
        reviewDecision: null,
        mergeStateStatus: null,
        ciState: null,
        latestReviewState: null,
        latestReviewSubmittedAt: null,
        latestCommitAt: null,
        linkedIssueNumbers: [18, 42],
        detailSyncedAt: "2026-07-02T00:00:00Z",
        detailError: null
      }
    );

    expect(pr.linkedIssueNumbers).toEqual([42]);
  });

  test("stale PR reviewer handoff does not produce testing stalled attention", () => {
    const staleUpdate = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const pr = normalizePullRequest(
      {
        ...profile,
        people: { ...profile.people, testers: ["tester-a"] }
      },
      {
        id: 16,
        number: 22,
        title: "stale testing handoff",
        state: "open",
        user: { login: "alice" },
        html_url: "https://example.test/22",
        created_at: staleUpdate,
        updated_at: staleUpdate,
        requested_reviewers: [{ login: "tester-a" }],
        head: { ref: "fix" },
        base: { ref: "main" }
      },
      anonymousSource
    );

    expect(pr.testingState).toBe("not_ready");
    expect(pr.testingQueueAgeHours).toBeNull();
    expect(pr.attentionFlags).not.toContain("testing_stalled");
  });

  test("PR approval does not produce a testing pass state", () => {
    const staleUpdate = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const now = new Date().toISOString();
    const pr = normalizePullRequest(
      {
        ...profile,
        people: { ...profile.people, testers: ["tester-a"] }
      },
      {
        id: 17,
        number: 23,
        title: "passed testing handoff",
        state: "open",
        user: { login: "alice" },
        html_url: "https://example.test/23",
        created_at: staleUpdate,
        updated_at: staleUpdate,
        requested_reviewers: [{ login: "tester-a" }],
        head: { ref: "fix" },
        base: { ref: "main" }
      },
      anonymousSource,
      {
        number: 23,
        reviewDecision: "approved",
        mergeStateStatus: null,
        ciState: null,
        latestReviewState: "APPROVED",
        latestReviewSubmittedAt: now,
        latestCommitAt: now,
        linkedIssueNumbers: [],
        detailSyncedAt: now,
        detailError: null
      }
    );

    expect(pr.testingState).toBe("not_ready");
    expect(pr.testingQueueAgeHours).toBeNull();
    expect(pr.attentionFlags).not.toContain("testing_stalled");
  });

  test("testing flow ignores PR label and assignee handoff signals", () => {
    const pr = normalizePullRequest(
      profile,
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
      anonymousSource
    );

    expect(pr.testingState).toBe("not_ready");
    expect(pr.testingTesters).toEqual([]);
    expect(pr.testingSignals).toEqual([]);
  });

  test("testing flow ignores configured PR comment handoff signals", () => {
    const pr = normalizePullRequest(
      profile,
      {
        id: 18,
        number: 24,
        title: "comment handoff",
        state: "open",
        user: { login: "alice" },
        html_url: "https://example.test/24",
        created_at: "2026-07-01T00:00:00Z",
        updated_at: "2026-07-02T00:00:00Z",
        head: { ref: "fix" },
        base: { ref: "main" }
      },
      anonymousSource,
      undefined,
      {
        isComplete: true,
        lastSyncedAt: "2026-07-02T00:30:00Z",
        syncError: null,
        comments: [
          {
            authorLogin: "alice",
            body: "Ready for testing after latest BVT run.",
            createdAt: "2026-07-02T00:30:00Z",
            updatedAt: "2026-07-02T00:30:00Z"
          }
        ]
      }
    );

    expect(pr.testingState).toBe("not_ready");
    expect(pr.testingSignals).toEqual([]);
    expect(pr.lastHumanActionAt).toBe("2026-07-02T00:30:00Z");
  });

  test("AI drift detects ai-easy PRs with review or CI blockers", () => {
    const now = new Date().toISOString();
    const pr = normalizePullRequest(
      profile,
      {
        id: 501,
        number: 501,
        title: "easy fix with blockers",
        state: "open",
        user: { login: "alice" },
        html_url: "https://example.test/501",
        created_at: "2026-07-01T00:00:00Z",
        updated_at: now,
        labels: [{ name: "ai-easy" }],
        head: { ref: "fix" },
        base: { ref: "main" }
      },
      anonymousSource,
      {
        number: 501,
        reviewDecision: "changes_requested",
        mergeStateStatus: "clean",
        ciState: "failure",
        latestReviewState: "CHANGES_REQUESTED",
        latestReviewSubmittedAt: now,
        latestCommitAt: now,
        linkedIssueNumbers: [],
        detailSyncedAt: now,
        detailError: null
      }
    );

    expect(aiDriftSignalsForPullRequest(profile, pr).map((item) => item.ruleKey)).toEqual(["ai_easy_pr_has_blockers"]);
  });

  test("AI drift treats missing effort labels as ai-easy on PRs with blockers", () => {
    const now = new Date().toISOString();
    const pr = normalizePullRequest(
      profile,
      {
        id: 503,
        number: 503,
        title: "unlabeled fix with blockers",
        state: "open",
        user: { login: "alice" },
        html_url: "https://example.test/503",
        created_at: "2026-07-01T00:00:00Z",
        updated_at: now,
        labels: [{ name: "kind/bug" }],
        head: { ref: "fix" },
        base: { ref: "main" }
      },
      anonymousSource,
      {
        number: 503,
        reviewDecision: "changes_requested",
        mergeStateStatus: "clean",
        ciState: "failure",
        latestReviewState: "CHANGES_REQUESTED",
        latestReviewSubmittedAt: now,
        latestCommitAt: now,
        linkedIssueNumbers: [],
        detailSyncedAt: now,
        detailError: null
      }
    );

    const signals = aiDriftSignalsForPullRequest(profile, pr);
    expect(signals.map((item) => item.ruleKey)).toEqual(["ai_easy_pr_has_blockers"]);
    expect(signals[0]?.aiEffortLabel).toBe("ai-easy");
    expect(signals[0]?.evidenceSummary).toContain("has no ai-* label and is treated as ai-easy");
  });

  test("AI drift ignores ai-easy PRs without blocker evidence", () => {
    const now = new Date().toISOString();
    const pr = normalizePullRequest(
      profile,
      {
        id: 502,
        number: 502,
        title: "easy clean fix",
        state: "open",
        user: { login: "alice" },
        html_url: "https://example.test/502",
        created_at: "2026-07-01T00:00:00Z",
        updated_at: now,
        labels: [{ name: "ai-easy" }],
        head: { ref: "fix" },
        base: { ref: "main" }
      },
      anonymousSource,
      {
        number: 502,
        reviewDecision: "approved",
        mergeStateStatus: "clean",
        ciState: "success",
        latestReviewState: "APPROVED",
        latestReviewSubmittedAt: now,
        latestCommitAt: now,
        linkedIssueNumbers: [],
        detailSyncedAt: now,
        detailError: null
      }
    );

    expect(aiDriftSignalsForPullRequest(profile, pr)).toEqual([]);
  });

  test("testing flow ignores PR review states and still reflects closed PRs", () => {
    const testProfile = {
      ...profile,
      people: { ...profile.people, testers: ["tester-a"] }
    };
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

    const changesRequested = normalizePullRequest(testProfile, basePr, anonymousSource, {
      number: 20,
      reviewDecision: "changes_requested",
      mergeStateStatus: null,
      ciState: null,
      latestReviewState: "CHANGES_REQUESTED",
      latestReviewSubmittedAt: now,
      latestCommitAt: now,
      linkedIssueNumbers: [],
      detailSyncedAt: now,
      detailError: null
    });
    const approved = normalizePullRequest(testProfile, basePr, anonymousSource, {
      number: 20,
      reviewDecision: "approved",
      mergeStateStatus: null,
      ciState: null,
      latestReviewState: "APPROVED",
      latestReviewSubmittedAt: now,
      latestCommitAt: now,
      linkedIssueNumbers: [],
      detailSyncedAt: now,
      detailError: null
    });
    const closed = normalizePullRequest(testProfile, { ...basePr, state: "closed", closed_at: now }, anonymousSource);

    expect(changesRequested.testingState).toBe("not_ready");
    expect(approved.testingState).toBe("not_ready");
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
      anonymousSource
    );

    expect(workflowViolationsForIssue(profile, issue).map((item) => item.ruleKey)).toContain(
      "bug_missing_needs_triage"
    );
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
      anonymousSource
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
      anonymousSource
    );

    expect(workflowViolationsForIssue(profile, issue).map((item) => item.ruleKey)).toContain(
      "premature_active_severity"
    );
  });

  test("workflow violations do not mark old active severity as premature without timeline evidence", () => {
    const issue = normalizeIssue(
      profile,
      {
        id: 8,
        number: 14,
        title: "old active s0",
        state: "open",
        user: { login: "reporter" },
        html_url: "https://example.test/14",
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-02T00:00:00Z",
        labels: [{ name: "kind/bug" }, { name: "severity/s0" }],
        assignees: [{ login: "alice" }]
      },
      anonymousSource
    );

    expect(workflowViolationsForIssue(profile, issue).map((item) => item.ruleKey)).not.toContain(
      "premature_active_severity"
    );
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
      anonymousSource
    );

    const rules = workflowViolationsForIssue(profile, issue).map((item) => item.ruleKey);
    expect(rules).toContain("conflicting_lifecycle_labels");
  });

  test("does not report missing deferred explanation until issue comments are fully backfilled", () => {
    const issue = normalizeIssue(
      profile,
      {
        id: 90,
        number: 90,
        title: "deferred without comment evidence",
        state: "open",
        user: { login: "reporter" },
        html_url: "https://example.test/90",
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-02T00:00:00Z",
        labels: [{ name: "kind/bug" }, { name: "deferred" }],
        assignees: [{ login: "alice" }]
      },
      anonymousSource
    );

    expect(workflowViolationsForIssue(profile, issue).map((item) => item.ruleKey)).not.toContain(
      "deferred_missing_explanation_comment"
    );
  });

  test("detects deferred issues missing an explanation comment when comments are fully backfilled", () => {
    const issue = {
      ...normalizeIssue(
        profile,
        {
          id: 91,
          number: 91,
          title: "deferred without explanation",
          state: "open",
          user: { login: "reporter" },
          html_url: "https://example.test/91",
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-02T00:00:00Z",
          labels: [{ name: "kind/bug" }, { name: "deferred" }],
          assignees: [{ login: "alice" }]
        },
        anonymousSource
      ),
      commentEvidence: {
        isComplete: true,
        lastSyncedAt: "2026-07-04T00:00:00.000Z",
        syncError: null,
        comments: [
          {
            authorLogin: "alice",
            body: "I looked at this.",
            createdAt: "2026-01-02T00:00:00Z",
            updatedAt: "2026-01-02T00:00:00Z"
          }
        ]
      }
    };

    expect(workflowViolationsForIssue(profile, issue).map((item) => item.ruleKey)).toContain(
      "deferred_missing_explanation_comment"
    );
  });

  test("accepts deferred issues with an explanation comment", () => {
    const issue = {
      ...normalizeIssue(
        profile,
        {
          id: 92,
          number: 92,
          title: "deferred with explanation",
          state: "open",
          user: { login: "reporter" },
          html_url: "https://example.test/92",
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-02T00:00:00Z",
          labels: [{ name: "kind/bug" }, { name: "deferred" }],
          assignees: [{ login: "alice" }]
        },
        anonymousSource
      ),
      commentEvidence: {
        isComplete: true,
        lastSyncedAt: "2026-07-04T00:00:00.000Z",
        syncError: null,
        comments: [
          {
            authorLogin: "alice",
            body: "Deferred after triage.\n\nReason: non-critical path, no current owner.",
            createdAt: "2026-01-02T00:00:00Z",
            updatedAt: "2026-01-02T00:00:00Z"
          }
        ]
      }
    };

    expect(workflowViolationsForIssue(profile, issue).map((item) => item.ruleKey)).not.toContain(
      "deferred_missing_explanation_comment"
    );
  });

  test("AI drift treats missing effort labels as ai-easy on critical issues", () => {
    const issue = normalizeIssue(
      profile,
      {
        id: 10,
        number: 16,
        title: "critical missing effort",
        state: "open",
        user: { login: "reporter" },
        html_url: "https://example.test/16",
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-02T00:00:00Z",
        labels: [{ name: "kind/bug" }, { name: "severity/s0" }],
        assignees: [{ login: "alice" }]
      },
      anonymousSource
    );

    const signals = aiDriftSignalsForIssue(profile, issue);
    const signal = signals.find((item) => item.ruleKey === "ai_easy_critical_too_old");
    expect(issue.aiEffortLabel).toBe("ai-easy");
    expect(signals.map((item) => item.ruleKey)).not.toContain("critical_missing_ai_effort");
    expect(signal?.aiEffortLabel).toBe("ai-easy");
    expect(signal?.evidenceSummary).toContain("has no ai-* label and is treated as ai-easy");
  });

  test("AI drift detects old ai-easy active s-1/s0 issues with partial-cache evidence", () => {
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
      anonymousSource
    );

    const signals = aiDriftSignalsForIssue(profile, issue);
    expect(signals.map((item) => item.ruleKey)).toContain("ai_easy_critical_too_old");
    expect(signals.find((item) => item.ruleKey === "ai_easy_critical_too_old")?.sourceCompleteness).toBe(
      "partial_cache"
    );
  });

  test("AI drift uses severity activation time instead of issue created time when timeline evidence exists", () => {
    const issue = {
      ...normalizeIssue(
        profile,
        {
          id: 12,
          number: 18,
          title: "recently promoted ai easy critical",
          state: "open",
          user: { login: "reporter" },
          html_url: "https://example.test/18",
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-07-04T00:00:00Z",
          labels: [{ name: "kind/bug" }, { name: "severity/s0" }, { name: "ai-easy" }],
          assignees: [{ login: "alice" }]
        },
        anonymousSource
      ),
      criticalStartedAt: "2026-07-04T00:00:00Z"
    };

    expect(aiDriftSignalsForIssue(profile, issue)).toEqual([]);
  });

  test("AI drift measures ai-easy critical duration to issue testing handoff when available", () => {
    const issue = {
      ...normalizeIssue(
        profile,
        {
          id: 13,
          number: 19,
          title: "slow handoff ai easy critical",
          state: "open",
          user: { login: "reporter" },
          html_url: "https://example.test/19",
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-09T00:00:00Z",
          labels: [{ name: "kind/bug" }, { name: "severity/s0" }, { name: "ai-easy" }],
          assignees: [{ login: "alice" }, { login: "tester-a" }]
        },
        anonymousSource
      ),
      criticalStartedAt: "2026-01-01T00:00:00Z",
      testingHandoffStartedAt: "2026-01-09T00:00:00Z"
    };

    const [signal] = aiDriftSignalsForIssue(profile, issue);

    expect(signal).toMatchObject({
      ruleKey: "ai_easy_critical_too_old",
      actualHours: 192,
      sourceCompleteness: "complete_cache"
    });
    expect(signal?.evidenceSummary).toContain("s-1/s0 active time until testing handoff");
    expect(signal?.suggestedAction).toContain("testing handoff took longer");
  });
});
