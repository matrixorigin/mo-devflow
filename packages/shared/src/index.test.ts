import { describe, expect, test } from "vitest";
import {
  buildGitHubWriteCapabilities,
  githubWebhookConnectivityEvents,
  isGitHubWebhookConnectivityEvent,
  isSupportedGitHubWebhookEvent,
  notificationStatusAllowsRetry,
  notificationStatusRequiresAcknowledgement,
  repoProfileConfigurationStatus,
  supportedGitHubWebhookEvents
} from "./index";
import type { RepoProfile } from "./index";

const profile: RepoProfile = {
  key: "example/repo",
  repo: {
    owner: "example",
    name: "repo",
    localPath: "/tmp/repo"
  },
  reporting: {
    timezone: "Asia/Shanghai",
    weekStart: "Monday"
  },
  access: {
    anonymousRead: true,
    exposeUserTokenSyncedPrivateData: false,
    criticalScope: "repo-wide",
    writeBackEnabled: true
  },
  people: {
    watchedUsers: ["alice"],
    testers: ["qa"]
  },
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
    aiEffort: ["ai-easy", "ai-manual"]
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
    handoffScope: "issue",
    handoffSignals: {
      labels: [],
      reviewerUsers: [],
      assigneeUsers: ["qa"],
      comments: []
    }
  },
  workflow: {
    skipUsers: []
  },
  notifications: {
    wecom: {
      enabled: false
    },
    employees: {},
    routing: {
      cooldownHours: 12,
      fallbackRecipient: "maintainers",
      escalateAfterHours: 24
    }
  },
  raw: {}
};

describe("repo profile configuration status", () => {
  test("keeps GitHub evidence backfill disabled by default without a service token", () => {
    expect(repoProfileConfigurationStatus(profile, {})).toMatchObject({
      githubServiceTokenConfigured: false,
      prDetailBackfillLimit: 0,
      commentBackfillLimit: 0,
      issueTimelineBackfillLimit: 0,
      githubEvidenceBackfillConfigured: false
    });
  });

  test("defaults GitHub evidence backfill to bounded batches when a service token exists", () => {
    const status = repoProfileConfigurationStatus(profile, {
      MO_DEVFLOW_GITHUB_TOKEN: "secret-token"
    });

    expect(status).toMatchObject({
      githubServiceTokenConfigured: true,
      prDetailBackfillLimit: 25,
      commentBackfillLimit: 25,
      issueTimelineBackfillLimit: 25,
      githubEvidenceBackfillConfigured: true
    });
    expect(JSON.stringify(status)).not.toContain("secret-token");
  });

  test("uses explicit backfill limits without requiring a service token", () => {
    expect(
      repoProfileConfigurationStatus(profile, {
        MO_DEVFLOW_PR_BACKFILL_MAX_ITEMS: "3",
        MO_DEVFLOW_COMMENT_BACKFILL_MAX_ITEMS: "4",
        MO_DEVFLOW_ISSUE_TIMELINE_BACKFILL_MAX_ITEMS: "5"
      })
    ).toMatchObject({
      githubServiceTokenConfigured: false,
      prDetailBackfillLimit: 3,
      commentBackfillLimit: 4,
      issueTimelineBackfillLimit: 5,
      githubEvidenceBackfillConfigured: true
    });
  });

  test("allows explicit zero limits to disable service-token backfill", () => {
    expect(
      repoProfileConfigurationStatus(profile, {
        GITHUB_TOKEN: "secret-token",
        MO_DEVFLOW_PR_BACKFILL_MAX_ITEMS: "-1",
        MO_DEVFLOW_COMMENT_BACKFILL_MAX_ITEMS: "bad",
        MO_DEVFLOW_ISSUE_TIMELINE_BACKFILL_MAX_ITEMS: "2"
      })
    ).toMatchObject({
      githubServiceTokenConfigured: true,
      prDetailBackfillLimit: 0,
      commentBackfillLimit: 25,
      issueTimelineBackfillLimit: 2,
      githubEvidenceBackfillConfigured: false
    });
  });
});

describe("GitHub write capabilities", () => {
  test("requires a validated connected token before issue label writes are enabled", () => {
    const capabilities = buildGitHubWriteCapabilities({
      writeBackEnabled: true,
      tokenScopes: ["repo"],
      repoPermission: "write",
      tokenLastValidatedAt: null
    });

    expect(capabilities.issueLabels).toMatchObject({
      enabled: false,
      status: "missing_token"
    });
  });

  test("enables issue label writes for classic repo scope", () => {
    const capabilities = buildGitHubWriteCapabilities({
      writeBackEnabled: true,
      tokenScopes: ["read:user", "repo"],
      repoPermission: "write",
      tokenLastValidatedAt: "2026-07-04T00:00:00.000Z"
    });

    expect(capabilities.issueLabels).toMatchObject({
      enabled: true,
      status: "ready"
    });
  });

  test("enables issue label writes for classic public_repo scope", () => {
    const capabilities = buildGitHubWriteCapabilities({
      writeBackEnabled: true,
      tokenScopes: ["public_repo"],
      repoPermission: "triage",
      tokenLastValidatedAt: "2026-07-04T00:00:00.000Z"
    });

    expect(capabilities.issueLabels).toMatchObject({
      enabled: true,
      status: "ready",
      repoPermission: "triage",
      requiredRepoPermissions: ["admin", "maintain", "write", "triage"]
    });
  });

  test("keeps issue label writes disabled for insufficient classic scopes", () => {
    const capabilities = buildGitHubWriteCapabilities({
      writeBackEnabled: true,
      tokenScopes: ["read:user"],
      repoPermission: "write",
      tokenLastValidatedAt: "2026-07-04T00:00:00.000Z"
    });

    expect(capabilities.issueLabels).toMatchObject({
      enabled: false,
      status: "insufficient_scope"
    });
  });

  test("keeps issue label writes disabled when GitHub did not report classic scopes", () => {
    const capabilities = buildGitHubWriteCapabilities({
      writeBackEnabled: true,
      tokenScopes: [],
      repoPermission: "write",
      tokenLastValidatedAt: "2026-07-04T00:00:00.000Z"
    });

    expect(capabilities.issueLabels).toMatchObject({
      enabled: false,
      status: "scope_unverified"
    });
  });

  test("keeps issue label writes disabled when repository permission was not verified", () => {
    const capabilities = buildGitHubWriteCapabilities({
      writeBackEnabled: true,
      tokenScopes: ["repo"],
      repoPermission: "unverified",
      tokenLastValidatedAt: "2026-07-04T00:00:00.000Z"
    });

    expect(capabilities.issueLabels).toMatchObject({
      enabled: false,
      status: "repo_permission_unverified",
      repoPermission: "unverified"
    });
  });

  test("keeps issue label writes disabled when token has only repository read permission", () => {
    const capabilities = buildGitHubWriteCapabilities({
      writeBackEnabled: true,
      tokenScopes: ["repo"],
      repoPermission: "read",
      tokenLastValidatedAt: "2026-07-04T00:00:00.000Z"
    });

    expect(capabilities.issueLabels).toMatchObject({
      enabled: false,
      status: "insufficient_repo_permission",
      repoPermission: "read"
    });
  });

  test("keeps issue label writes disabled when repo write-back is disabled", () => {
    const capabilities = buildGitHubWriteCapabilities({
      writeBackEnabled: false,
      tokenScopes: ["repo"],
      repoPermission: "write",
      tokenLastValidatedAt: "2026-07-04T00:00:00.000Z"
    });

    expect(capabilities.issueLabels).toMatchObject({
      enabled: false,
      status: "write_back_disabled"
    });
    expect(capabilities.issueLabels.message).toContain("disabled in the repository profile");
  });
});

describe("notification acknowledgement policy", () => {
  test("only sent notification deliveries require acknowledgement", () => {
    expect(notificationStatusRequiresAcknowledgement("sent")).toBe(true);
    expect(notificationStatusRequiresAcknowledgement("dry_run")).toBe(false);
    expect(notificationStatusRequiresAcknowledgement("failed_transient")).toBe(false);
    expect(notificationStatusRequiresAcknowledgement("failed_permanent")).toBe(false);
    expect(notificationStatusRequiresAcknowledgement("retry_requested")).toBe(false);
    expect(notificationStatusRequiresAcknowledgement("skipped_disabled")).toBe(false);
    expect(notificationStatusRequiresAcknowledgement("skipped_no_webhook")).toBe(false);
    expect(notificationStatusRequiresAcknowledgement("skipped_quiet_hours")).toBe(false);
  });

  test("only failed notification deliveries can be manually retried", () => {
    expect(notificationStatusAllowsRetry("failed_transient")).toBe(true);
    expect(notificationStatusAllowsRetry("failed_permanent")).toBe(true);
    expect(notificationStatusAllowsRetry("retry_requested")).toBe(false);
    expect(notificationStatusAllowsRetry("sent")).toBe(false);
    expect(notificationStatusAllowsRetry("dry_run")).toBe(false);
    expect(notificationStatusAllowsRetry("skipped_no_webhook")).toBe(false);
  });
});

describe("GitHub webhook event contract", () => {
  test("lists only webhook events with implemented cache ingestion", () => {
    expect(supportedGitHubWebhookEvents).toEqual([
      "issues",
      "issue_comment",
      "pull_request",
      "pull_request_review",
      "workflow_run",
      "check_run"
    ]);
    expect(isSupportedGitHubWebhookEvent("issues")).toBe(true);
    expect(isSupportedGitHubWebhookEvent("issue_comment")).toBe(true);
    expect(isSupportedGitHubWebhookEvent("pull_request")).toBe(true);
    expect(isSupportedGitHubWebhookEvent("pull_request_review")).toBe(true);
    expect(isSupportedGitHubWebhookEvent("workflow_run")).toBe(true);
    expect(isSupportedGitHubWebhookEvent("check_run")).toBe(true);
    expect(isSupportedGitHubWebhookEvent("ping")).toBe(false);
    expect(isSupportedGitHubWebhookEvent("deployment_status")).toBe(false);
  });

  test("keeps connectivity probes separate from cache-ingested events", () => {
    expect(githubWebhookConnectivityEvents).toEqual(["ping"]);
    expect(isGitHubWebhookConnectivityEvent("ping")).toBe(true);
    expect(isGitHubWebhookConnectivityEvent("issues")).toBe(false);
  });
});
