import { describe, expect, test, vi } from "vitest";
import type { RepoProfile } from "@mo-devflow/shared";

const mocks = vi.hoisted(() => ({
  fetchPullRequestInsightForNumber: vi.fn(),
  resolveStaleAttentionItems: vi.fn(),
  upsertAttentionItem: vi.fn(),
  upsertPullRequest: vi.fn()
}));

vi.mock("@mo-devflow/db", () => ({
  issueAttentionRuleKeys: ["critical_no_human_action"],
  pullRequestAttentionRuleKeys: [
    "no_human_action_24h",
    "requested_changes",
    "ci_failed",
    "merge_conflict",
    "testing_stalled"
  ],
  snapshotManagedAttentionRuleKeys: [
    "critical_no_human_action",
    "no_human_action_24h",
    "requested_changes",
    "ci_failed",
    "merge_conflict",
    "testing_stalled"
  ],
  claimNextGitHubWebhookDelivery: vi.fn(),
  completeGitHubWebhookDelivery: vi.fn(),
  failGitHubWebhookDelivery: vi.fn(),
  isNotificationInCooldown: vi.fn(),
  listCachedIssuesForRules: vi.fn(),
  listNotificationCandidates: vi.fn(),
  recordNotificationDelivery: vi.fn(),
  recordSyncRun: vi.fn(),
  recomputeDailyMetricsFromCache: vi.fn(),
  replaceAiDriftSignals: vi.fn(),
  replaceWorkflowViolations: vi.fn(),
  resolveStaleAttentionItems: mocks.resolveStaleAttentionItems,
  runWithJobLease: vi.fn(),
  upsertAttentionItem: mocks.upsertAttentionItem,
  upsertIssue: vi.fn(),
  upsertPullRequest: mocks.upsertPullRequest,
  upsertRepoProfile: vi.fn()
}));

vi.mock("@mo-devflow/github", () => ({
  classifyGitHubError: vi.fn(),
  configuredGitHubSourceAuthType: vi.fn(),
  fetchGitHubSnapshot: vi.fn(),
  fetchPullRequestInsightForNumber: mocks.fetchPullRequestInsightForNumber
}));

vi.mock("@mo-devflow/notifications", () => ({
  buildWeComMarkdown: vi.fn(),
  isInQuietHours: vi.fn(),
  sendWeComMarkdown: vi.fn()
}));

vi.mock("@mo-devflow/config", () => ({
  loadEnv: vi.fn(),
  loadRepoProfile: vi.fn()
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
  notifications: {
    wecom: { enabled: false },
    employees: {},
    routing: { cooldownHours: 12, fallbackRecipient: "maintainer_group" }
  },
  raw: {}
};

describe("webhook review processing", () => {
  test("refreshes PR insight from GitHub before updating requested-change attention", async () => {
    const { processWebhookPayload } = await import("./sync");
    const now = new Date().toISOString();
    mocks.fetchPullRequestInsightForNumber.mockResolvedValue({
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
        evidenceSummary: "PR #42 has unresolved requested changes."
      })
    );
    expect(mocks.resolveStaleAttentionItems).toHaveBeenCalledWith(
      expect.objectContaining({
        repoId: 10,
        activeDedupeKeys: expect.any(Set),
        managedRuleKeys: [
          "no_human_action_24h",
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
});
