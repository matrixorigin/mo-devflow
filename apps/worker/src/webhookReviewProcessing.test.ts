import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { RepoProfile } from "@mo-devflow/shared";

const mocks = vi.hoisted(() => ({
  claimNextGitHubWebhookDelivery: vi.fn(),
  completeGitHubWebhookDelivery: vi.fn(),
  configuredGitHubSourceAuthType: vi.fn(),
  failGitHubWebhookDelivery: vi.fn(),
  fetchIssueCommentsForNumber: vi.fn(),
  fetchPullRequestInsightForNumber: vi.fn(),
  listCachedIssuesForRules: vi.fn(),
  listIssueCommentBackfillCandidates: vi.fn(),
  listPullRequestNumbersForDetailBackfill: vi.fn(),
  loadEnv: vi.fn(),
  loadRepoProfile: vi.fn(),
  notificationDashboardBaseUrlFromEnv: vi.fn(() => "http://localhost:5173"),
  notificationDashboardUrl: vi.fn((baseUrl: string, _sourceType: string, objectType: string) =>
    objectType === "pull_request" ? `${baseUrl}/#prs` : `${baseUrl}/#overview`
  ),
  recordSyncRun: vi.fn(),
  replaceIssueComments: vi.fn(),
  replaceWorkflowViolations: vi.fn(),
  resolveStaleAttentionItems: vi.fn(),
  upsertAttentionItem: vi.fn(),
  upsertPullRequest: vi.fn(),
  upsertRepoProfile: vi.fn()
}));

vi.mock("@mo-devflow/db", () => ({
  issueAttentionRuleKeys: ["critical_no_human_action"],
  pullRequestAttentionRuleKeys: [
    "no_human_action_24h",
    "review_requested_no_response",
    "requested_changes",
    "ci_failed",
    "merge_conflict",
    "testing_stalled"
  ],
  snapshotManagedAttentionRuleKeys: [
    "critical_no_human_action",
    "no_human_action_24h",
    "review_requested_no_response",
    "requested_changes",
    "ci_failed",
    "merge_conflict",
    "testing_stalled"
  ],
  claimNextGitHubWebhookDelivery: mocks.claimNextGitHubWebhookDelivery,
  completeGitHubWebhookDelivery: mocks.completeGitHubWebhookDelivery,
  failGitHubWebhookDelivery: mocks.failGitHubWebhookDelivery,
  isNotificationInCooldown: vi.fn(),
  listCachedIssuesForRules: mocks.listCachedIssuesForRules,
  listIssueCommentBackfillCandidates: mocks.listIssueCommentBackfillCandidates,
  listPullRequestNumbersForDetailBackfill: mocks.listPullRequestNumbersForDetailBackfill,
  listNotificationCandidates: vi.fn(),
  notificationDashboardBaseUrlFromEnv: mocks.notificationDashboardBaseUrlFromEnv,
  notificationDashboardUrl: mocks.notificationDashboardUrl,
  recordNotificationDelivery: vi.fn(),
  recordSyncRun: mocks.recordSyncRun,
  recomputeDailyMetricsFromCache: vi.fn(),
  replaceAiDriftSignals: vi.fn(),
  replaceIssueComments: mocks.replaceIssueComments,
  replaceWorkflowViolations: mocks.replaceWorkflowViolations,
  resolveStaleAttentionItems: mocks.resolveStaleAttentionItems,
  runWithJobLease: vi.fn(),
  upsertAttentionItem: mocks.upsertAttentionItem,
  upsertIssue: vi.fn(),
  upsertPullRequest: mocks.upsertPullRequest,
  upsertRepoProfile: mocks.upsertRepoProfile
}));

vi.mock("@mo-devflow/github", () => ({
  classifyGitHubError: vi.fn(),
  configuredGitHubSourceAuthType: mocks.configuredGitHubSourceAuthType,
  fetchIssueCommentsForNumber: mocks.fetchIssueCommentsForNumber,
  fetchGitHubSnapshot: vi.fn(),
  fetchPullRequestInsightForNumber: mocks.fetchPullRequestInsightForNumber
}));

vi.mock("@mo-devflow/notifications", () => ({
  buildWeComMarkdown: vi.fn(),
  isInQuietHours: vi.fn(),
  sendWeComMarkdown: vi.fn()
}));

vi.mock("@mo-devflow/config", () => ({
  loadEnv: mocks.loadEnv,
  loadRepoProfile: mocks.loadRepoProfile
}));

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
  people: { watchedUsers: ["alice"], testers: ["tester-a"] },
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
    handoffSignals: { labels: [], reviewerUsers: ["tester-a"], assigneeUsers: [], comments: [] }
  },
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

const originalEnv = { ...process.env };

describe("webhook review processing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    mocks.configuredGitHubSourceAuthType.mockReturnValue("service_read_token");
    mocks.loadRepoProfile.mockReturnValue(profile);
    mocks.upsertRepoProfile.mockResolvedValue(10);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  test("backfills selected PR detail and records a dedicated sync layer", async () => {
    const { backfillPullRequestDetailsOnce } = await import("./sync");
    process.env.MO_DEVFLOW_PR_BACKFILL_MAX_ITEMS = "2";
    mocks.listPullRequestNumbersForDetailBackfill.mockResolvedValue([42, 43]);
    mocks.fetchPullRequestInsightForNumber.mockImplementation(async ({ pullNumber }: { pullNumber: number }) => {
      const now = "2026-07-04T00:00:00.000Z";
      return {
        pullRequest: {
          id: pullNumber,
          number: pullNumber,
          title: `PR ${pullNumber}`,
          state: "open",
          user: { login: "alice" },
          html_url: `https://github.com/matrixorigin/matrixone/pull/${pullNumber}`,
          created_at: "2026-07-01T00:00:00Z",
          updated_at: now,
          requested_reviewers: [],
          head: { ref: "fix" },
          base: { ref: "main" }
        },
        insight: {
          number: pullNumber,
          reviewDecision: "approved",
          mergeStateStatus: "clean",
          ciState: "success",
          latestReviewState: "APPROVED",
          latestReviewSubmittedAt: now,
          latestCommitAt: now,
          detailSyncedAt: now,
          detailError: null
        },
        rateLimitRemaining: 42,
        sourceAuthType: "service_read_token"
      };
    });
    mocks.upsertPullRequest.mockImplementation(async (_repoId: number, pr: unknown) => pr);

    const result = await backfillPullRequestDetailsOnce();

    expect(result).toMatchObject({ repoId: 10, selected: 2, refreshed: 2, failed: 0 });
    expect(mocks.listPullRequestNumbersForDetailBackfill).toHaveBeenCalledWith(10, 2);
    expect(mocks.fetchPullRequestInsightForNumber).toHaveBeenCalledTimes(2);
    expect(mocks.upsertPullRequest).toHaveBeenCalledWith(
      10,
      expect.objectContaining({
        number: 42,
        isComplete: true,
        reviewDecision: "approved",
        ciState: "success"
      })
    );
    expect(mocks.recordSyncRun).toHaveBeenCalledWith(
      expect.objectContaining({
        repoId: 10,
        syncLayer: "pr_backfill",
        status: "success",
        sourceAuthType: "service_read_token",
        raw: expect.objectContaining({ selected: 2, refreshed: 2, failed: 0 })
      })
    );
  });

  test("backfills selected issue comments and refreshes workflow rules", async () => {
    const { backfillIssueCommentsOnce } = await import("./sync");
    process.env.MO_DEVFLOW_COMMENT_BACKFILL_MAX_ITEMS = "2";
    const syncedAt = "2026-07-04T00:00:00.000Z";
    mocks.listIssueCommentBackfillCandidates.mockResolvedValue([
      {
        issueNumber: 50,
        objectType: "issue",
        visibilityClass: "anonymous_readable",
        sourceUpdatedAt: "2026-07-04T00:00:00.000Z",
        lastCommentSyncedAt: null
      }
    ]);
    mocks.fetchIssueCommentsForNumber.mockResolvedValue({
      issueNumber: 50,
      comments: [
        {
          id: 5001,
          user: { login: "alice" },
          body: "Deferred because the reproduction is not stable yet.",
          html_url: "https://github.com/matrixorigin/matrixone/issues/50#issuecomment-5001",
          created_at: syncedAt,
          updated_at: syncedAt
        }
      ],
      isComplete: true,
      syncError: null,
      syncedAt,
      rateLimitRemaining: 40,
      sourceAuthType: "service_read_token"
    });
    mocks.listCachedIssuesForRules.mockResolvedValue([]);

    const result = await backfillIssueCommentsOnce();

    expect(result).toMatchObject({
      repoId: 10,
      selected: 1,
      refreshed: 1,
      complete: 1,
      partial: 0,
      failed: 0,
      workflowViolations: 0
    });
    expect(mocks.listIssueCommentBackfillCandidates).toHaveBeenCalledWith(10, {
      includePullRequests: false,
      limit: 2
    });
    expect(mocks.fetchIssueCommentsForNumber).toHaveBeenCalledWith({ profile, issueNumber: 50 });
    expect(mocks.replaceIssueComments).toHaveBeenCalledWith(
      expect.objectContaining({
        repoId: 10,
        issueNumber: 50,
        sourceAuthType: "service_read_token",
        visibilityClass: "anonymous_readable",
        isComplete: true,
        syncError: null,
        syncedAt,
        comments: [
          expect.objectContaining({
            githubId: 5001,
            authorLogin: "alice",
            body: "Deferred because the reproduction is not stable yet."
          })
        ]
      })
    );
    expect(mocks.recordSyncRun).toHaveBeenCalledWith(
      expect.objectContaining({
        repoId: 10,
        syncLayer: "comment_backfill",
        status: "success",
        sourceAuthType: "service_read_token",
        raw: expect.objectContaining({ selected: 1, refreshed: 1, complete: 1 })
      })
    );
    expect(mocks.replaceWorkflowViolations).toHaveBeenCalledWith(10, []);
  });

  test("refreshes PR insight from GitHub before updating requested-change attention", async () => {
    const { processWebhookPayload } = await import("./sync");
    const now = new Date().toISOString();
    mocks.fetchPullRequestInsightForNumber.mockResolvedValue({
      pullRequest: {
        id: 4242,
        number: 42,
        title: "review handoff",
        state: "open",
        user: { login: "alice" },
        html_url: "https://github.com/matrixorigin/matrixone/pull/42",
        created_at: "2026-07-01T00:00:00Z",
        updated_at: now,
        requested_reviewers: [{ login: "tester-a" }],
        head: { ref: "fix" },
        base: { ref: "main" }
      },
      insight: {
        number: 42,
        reviewDecision: "changes_requested",
        mergeStateStatus: "clean",
        ciState: "success",
        latestReviewState: "CHANGES_REQUESTED",
        latestReviewSubmittedAt: now,
        latestCommitAt: now,
        detailSyncedAt: now,
        detailError: null
      },
      rateLimitRemaining: 42,
      sourceAuthType: "service_read_token"
    });
    mocks.upsertPullRequest.mockImplementation(async (_repoId: number, pr: unknown) => pr);

    const result = await processWebhookPayload({
      repoId: 10,
      profile,
      eventName: "pull_request_review",
      payload: {
        action: "submitted",
        pull_request: {
          id: 4242,
          number: 42,
          title: "review handoff",
          state: "open",
          user: { login: "alice" },
          html_url: "https://github.com/matrixorigin/matrixone/pull/42",
          created_at: "2026-07-01T00:00:00Z",
          updated_at: now,
          requested_reviewers: [{ login: "tester-a" }],
          head: { ref: "fix" },
          base: { ref: "main" }
        }
      }
    });

    expect(result).toEqual({ processed: true, skipped: false, message: "updated PR #42 review insight" });
    expect(mocks.fetchPullRequestInsightForNumber).toHaveBeenCalledWith({ profile, pullNumber: 42 });
    expect(mocks.upsertPullRequest).toHaveBeenCalledWith(
      10,
      expect.objectContaining({
        number: 42,
        reviewDecision: "changes_requested",
        latestReviewState: "changes_requested",
        testingState: "test_changes_requested",
        isComplete: true,
        attentionFlags: expect.arrayContaining(["requested_changes"])
      })
    );
    expect(mocks.upsertAttentionItem).toHaveBeenCalledWith(
      expect.objectContaining({
        repoId: 10,
        objectType: "pull_request",
        objectNumber: 42,
        ruleKey: "requested_changes",
        severity: "warning",
        relatedLogin: "alice",
        targetRecipient: "alice",
        dedupeKey: "matrixorigin/matrixone:pr:42:requested_changes",
        evidenceSummary: "PR #42 has unresolved requested changes.",
        dashboardUrl: "http://localhost:5173/#prs"
      })
    );
    expect(mocks.resolveStaleAttentionItems).toHaveBeenCalledWith(
      expect.objectContaining({
        repoId: 10,
        activeDedupeKeys: expect.any(Set),
        managedRuleKeys: [
          "no_human_action_24h",
          "review_requested_no_response",
          "requested_changes",
          "ci_failed",
          "merge_conflict",
          "testing_stalled"
        ],
        objectType: "pull_request",
        objectNumber: 42
      })
    );
  });

  test("refreshes PR insight from GitHub before updating CI attention", async () => {
    const { processWebhookPayload } = await import("./sync");
    const now = new Date().toISOString();
    mocks.fetchPullRequestInsightForNumber.mockResolvedValue({
      pullRequest: {
        id: 4343,
        number: 43,
        title: "ci handoff",
        state: "open",
        user: { login: "bob" },
        html_url: "https://github.com/matrixorigin/matrixone/pull/43",
        created_at: "2026-07-01T00:00:00Z",
        updated_at: now,
        requested_reviewers: [],
        head: { ref: "fix-ci", sha: "abc123" },
        base: { ref: "main" }
      },
      insight: {
        number: 43,
        reviewDecision: "approved",
        mergeStateStatus: "clean",
        ciState: "failure",
        latestReviewState: "APPROVED",
        latestReviewSubmittedAt: now,
        latestCommitAt: now,
        detailSyncedAt: now,
        detailError: null
      },
      rateLimitRemaining: 41,
      sourceAuthType: "service_read_token"
    });
    mocks.upsertPullRequest.mockImplementation(async (_repoId: number, pr: unknown) => pr);

    const result = await processWebhookPayload({
      repoId: 10,
      profile,
      eventName: "workflow_run",
      payload: {
        action: "completed",
        workflow_run: {
          id: 1001,
          conclusion: "failure",
          pull_requests: [{ number: 43 }]
        }
      }
    });

    expect(result).toEqual({ processed: true, skipped: false, message: "updated PR CI insight for #43" });
    expect(mocks.fetchPullRequestInsightForNumber).toHaveBeenCalledWith({ profile, pullNumber: 43 });
    expect(mocks.upsertPullRequest).toHaveBeenCalledWith(
      10,
      expect.objectContaining({
        number: 43,
        title: "ci handoff",
        ciState: "failure",
        isComplete: true,
        attentionFlags: expect.arrayContaining(["ci_failed"])
      })
    );
    expect(mocks.upsertAttentionItem).toHaveBeenCalledWith(
      expect.objectContaining({
        repoId: 10,
        objectType: "pull_request",
        objectNumber: 43,
        ruleKey: "ci_failed",
        severity: "warning",
        relatedLogin: "bob",
        targetRecipient: "bob",
        dedupeKey: "matrixorigin/matrixone:pr:43:ci_failed",
        evidenceSummary: "PR #43 has failing CI checks.",
        dashboardUrl: "http://localhost:5173/#prs"
      })
    );
  });

  test("fails CI webhook processing when linked PR detail cannot be refreshed", async () => {
    const { processWebhookPayload } = await import("./sync");
    const now = new Date().toISOString();
    mocks.fetchPullRequestInsightForNumber.mockResolvedValue({
      pullRequest: null,
      insight: {
        number: 44,
        reviewDecision: null,
        mergeStateStatus: null,
        ciState: null,
        latestReviewState: null,
        latestReviewSubmittedAt: null,
        latestCommitAt: null,
        detailSyncedAt: now,
        detailError: "GitHub rate limit exceeded"
      },
      rateLimitRemaining: 0,
      sourceAuthType: "anonymous"
    });

    await expect(
      processWebhookPayload({
        repoId: 10,
        profile,
        eventName: "check_run",
        payload: {
          action: "completed",
          check_run: {
            id: 1002,
            conclusion: "failure",
            pull_requests: [{ number: 44 }]
          }
        }
      })
    ).rejects.toThrow("Cannot refresh PR #44 insight from GitHub: GitHub rate limit exceeded");
    expect(mocks.upsertPullRequest).not.toHaveBeenCalled();
    expect(mocks.upsertAttentionItem).not.toHaveBeenCalled();
  });

  test("marks malformed supported webhook deliveries as failed normalization", async () => {
    const { processGitHubWebhookDeliveriesOnce } = await import("./sync");
    mocks.claimNextGitHubWebhookDelivery
      .mockResolvedValueOnce({
        id: 100,
        repoId: 10,
        deliveryId: "delivery-bad-issue",
        eventName: "issues",
        action: "opened",
        attempts: 1,
        payload: { action: "opened" },
        processingOwner: "worker-1"
      })
      .mockResolvedValueOnce(null);

    const result = await processGitHubWebhookDeliveriesOnce();

    expect(result).toMatchObject({
      repoId: 10,
      claimed: 1,
      processed: 0,
      failed: 1,
      skipped: 0
    });
    expect(mocks.failGitHubWebhookDelivery).toHaveBeenCalledWith({
      deliveryId: 100,
      processingOwner: expect.any(String),
      errorMessage: "issues payload missing issue object",
      status: "failed_normalization"
    });
    expect(mocks.completeGitHubWebhookDelivery).not.toHaveBeenCalled();
    expect(mocks.recordSyncRun).toHaveBeenCalledWith(
      expect.objectContaining({
        repoId: 10,
        syncLayer: "webhooks",
        status: "partial",
        raw: expect.objectContaining({
          claimed: 1,
          failed: 1
        })
      })
    );
  });
});
