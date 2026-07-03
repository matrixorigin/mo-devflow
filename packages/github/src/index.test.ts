import { beforeEach, describe, expect, test, vi } from "vitest";
import type { RepoProfile, WorkflowFixPreview, WorkflowFixStateSnapshot } from "@mo-devflow/shared";
import {
  applyWorkflowFixPreview,
  classifyGitHubError,
  configuredGitHubSourceAuthType,
  githubLinkHeaderHasNextPage
} from "./index";

const octokitMocks = vi.hoisted(() => ({
  issuesGet: vi.fn(),
  issuesAddLabels: vi.fn(),
  issuesRemoveLabel: vi.fn(),
  issuesCreateComment: vi.fn(),
  usersGetAuthenticated: vi.fn()
}));

vi.mock("@octokit/rest", () => ({
  Octokit: vi.fn(function MockOctokit() {
    return {
      rest: {
        issues: {
          get: octokitMocks.issuesGet,
          addLabels: octokitMocks.issuesAddLabels,
          removeLabel: octokitMocks.issuesRemoveLabel,
          createComment: octokitMocks.issuesCreateComment
        },
        users: {
          getAuthenticated: octokitMocks.usersGetAuthenticated
        }
      }
    };
  })
}));

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

const preview: WorkflowFixPreview = {
  previewId: "d74bc48e-2f9d-4282-a69f-410125f38f0d",
  actionKey: "add_needs_triage",
  repoKey: "matrixorigin/matrixone",
  objectType: "issue",
  objectNumber: 42,
  ruleKey: "bug_missing_needs_triage",
  title: "panic on insert",
  htmlUrl: "https://github.com/matrixorigin/matrixone/issues/42",
  reason: "Open bug issue #42 has no needs-triage label.",
  currentState: stateSnapshot(["kind/bug"], "cache"),
  proposedState: stateSnapshot(["kind/bug", "needs-triage"], "cache"),
  operations: [{ type: "add_label", label: "needs-triage" }],
  warnings: [],
  blockedReason: null,
  createdAt: "2026-07-03T00:00:00.000Z",
  expiresAt: "2026-07-03T00:10:00.000Z"
};

const deferredComment =
  "Deferred by mo-devflow workflow fix.\n\nReason: Issue #42 has stayed in needs-triage for 96h.\n\nIf this issue becomes urgent or broad-impact again, remove `deferred` and apply the appropriate severity label.";

const deferredPreview: WorkflowFixPreview = {
  ...preview,
  previewId: "a63a6d37-0b8d-4b93-b4f8-5698e2c6ec8b",
  actionKey: "move_to_deferred",
  ruleKey: "needs_triage_stale",
  reason: "Issue #42 has stayed in needs-triage for 96h.",
  currentState: stateSnapshot(["kind/bug", "needs-triage"], "cache"),
  proposedState: {
    ...stateSnapshot(["kind/bug", "deferred"], "cache"),
    lifecycleState: "deferred"
  },
  operations: [
    { type: "remove_label", label: "needs-triage" },
    { type: "add_label", label: "deferred" },
    { type: "add_comment", body: deferredComment }
  ]
};

function stateSnapshot(
  labels: string[],
  source: WorkflowFixStateSnapshot["source"] = "github"
): WorkflowFixStateSnapshot {
  return {
    source,
    state: "open",
    labels,
    assignees: [],
    lifecycleState: null,
    severity: null,
    aiEffortLabel: null,
    updatedAt: source === "github" ? "2026-07-03T00:01:00.000Z" : "2026-07-03T00:00:00.000Z"
  };
}

function issueResponse(labels: string[], state: "open" | "closed" = "open") {
  return {
    data: {
      state,
      labels: labels.map((name) => ({ name })),
      updated_at: "2026-07-03T00:01:00.000Z"
    },
    headers: { "x-ratelimit-remaining": "99" }
  };
}

describe("workflow fix execution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    octokitMocks.issuesAddLabels.mockResolvedValue({
      status: 200,
      data: [{ name: "kind/bug" }, { name: "needs-triage" }],
      headers: { "x-ratelimit-remaining": "98" }
    });
    octokitMocks.issuesRemoveLabel.mockResolvedValue({
      status: 200,
      headers: { "x-ratelimit-remaining": "97" }
    });
    octokitMocks.issuesCreateComment.mockResolvedValue({
      status: 201,
      data: { id: 123, html_url: "https://github.com/matrixorigin/matrixone/issues/42#issuecomment-123" },
      headers: { "x-ratelimit-remaining": "96" }
    });
  });

  test("adds needs-triage only when fresh issue state still matches the preview assumptions", async () => {
    octokitMocks.issuesGet.mockResolvedValue(issueResponse(["kind/bug"]));

    const result = await applyWorkflowFixPreview({
      token: "test-user-token",
      profile,
      preview
    });

    expect(octokitMocks.issuesAddLabels).toHaveBeenCalledWith({
      owner: "matrixorigin",
      repo: "matrixone",
      issue_number: 42,
      labels: ["needs-triage"]
    });
    expect(result.appliedOperations).toEqual(preview.operations);
    expect(result.beforeState).toMatchObject(stateSnapshot(["kind/bug"]));
    expect(result.afterState).toMatchObject({
      source: "github",
      state: "open",
      labels: ["kind/bug", "needs-triage"],
      updatedAt: null
    });
    expect(result.rateLimitRemaining).toBe(98);
  });

  test.each([
    { state: "closed" as const, labels: ["kind/bug"], skipped: "issue_closed" },
    { state: "open" as const, labels: ["kind/bug", "needs-triage"], skipped: "label_already_present" },
    { state: "open" as const, labels: [], skipped: "bug_label_missing" },
    { state: "open" as const, labels: ["kind/bug", "deferred"], skipped: "issue_deferred" },
    { state: "open" as const, labels: ["kind/bug", "severity/s0"], skipped: "active_lifecycle_present" }
  ])("does not execute when fresh state is stale: $skipped", async ({ state, labels, skipped }) => {
    octokitMocks.issuesGet.mockResolvedValue(issueResponse(labels, state));

    const result = await applyWorkflowFixPreview({
      token: "test-user-token",
      profile,
      preview
    });

    expect(octokitMocks.issuesAddLabels).not.toHaveBeenCalled();
    expect(result.appliedOperations).toEqual([]);
    expect(result.beforeState.labels).toEqual(labels);
    expect(result.afterState.labels).toEqual(labels);
    expect(result.response).toEqual({ skipped });
  });

  test("moves a stale needs-triage issue to deferred and comments with the preview reason", async () => {
    octokitMocks.issuesGet.mockResolvedValue(issueResponse(["kind/bug", "needs-triage"]));
    octokitMocks.issuesAddLabels.mockResolvedValue({
      status: 200,
      data: [{ name: "kind/bug" }, { name: "deferred" }],
      headers: { "x-ratelimit-remaining": "96" }
    });

    const result = await applyWorkflowFixPreview({
      token: "test-user-token",
      profile,
      preview: deferredPreview
    });

    expect(octokitMocks.issuesRemoveLabel).toHaveBeenCalledWith({
      owner: "matrixorigin",
      repo: "matrixone",
      issue_number: 42,
      name: "needs-triage"
    });
    expect(octokitMocks.issuesAddLabels).toHaveBeenCalledWith({
      owner: "matrixorigin",
      repo: "matrixone",
      issue_number: 42,
      labels: ["deferred"]
    });
    expect(octokitMocks.issuesCreateComment).toHaveBeenCalledWith({
      owner: "matrixorigin",
      repo: "matrixone",
      issue_number: 42,
      body: deferredComment
    });
    expect(result.appliedOperations).toEqual(deferredPreview.operations);
    expect(result.beforeState.labels).toEqual(["kind/bug", "needs-triage"]);
    expect(result.afterState.labels).toEqual(["kind/bug", "deferred"]);
    expect(result.rateLimitRemaining).toBe(96);
  });

  test("does not move to deferred when the lifecycle labels changed after preview", async () => {
    octokitMocks.issuesGet.mockResolvedValue(issueResponse(["kind/bug", "severity/s0"]));

    const result = await applyWorkflowFixPreview({
      token: "test-user-token",
      profile,
      preview: deferredPreview
    });

    expect(octokitMocks.issuesRemoveLabel).not.toHaveBeenCalled();
    expect(octokitMocks.issuesAddLabels).not.toHaveBeenCalled();
    expect(octokitMocks.issuesCreateComment).not.toHaveBeenCalled();
    expect(result.appliedOperations).toEqual([]);
    expect(result.response).toEqual({ skipped: "lifecycle_labels_changed" });
  });
});

describe("GitHub error classification", () => {
  test("classifies exhausted primary rate limit and preserves reset metadata", () => {
    const resetSeconds = Math.ceil(Date.now() / 1000) + 120;
    const result = classifyGitHubError({
      status: 403,
      message: "API rate limit exceeded",
      response: {
        headers: {
          "x-ratelimit-remaining": "0",
          "x-ratelimit-reset": String(resetSeconds)
        }
      }
    });

    expect(result.kind).toBe("rate_limited");
    expect(result.retriable).toBe(true);
    expect(result.rateLimitRemaining).toBe(0);
    expect(result.retryAfterSeconds).toBeGreaterThan(0);
    expect(result.rateLimitResetAt).toBe(new Date(resetSeconds * 1000).toISOString());
  });

  test("classifies permission failures as non-retriable when quota remains", () => {
    const result = classifyGitHubError({
      status: 403,
      message: "Resource not accessible by integration",
      response: {
        headers: {
          "x-ratelimit-remaining": "42"
        }
      }
    });

    expect(result.kind).toBe("permission");
    expect(result.retriable).toBe(false);
    expect(result.rateLimitRemaining).toBe(42);
  });

  test("classifies server and network failures as retriable", () => {
    expect(classifyGitHubError({ status: 502, message: "Bad gateway" }).kind).toBe("server");
    expect(classifyGitHubError(new Error("socket hang up")).kind).toBe("network");
    expect(classifyGitHubError(new Error("socket hang up")).retriable).toBe(true);
  });

  test("detects configured service-token auth source without creating a client", () => {
    expect(configuredGitHubSourceAuthType({})).toBe("anonymous");
    expect(configuredGitHubSourceAuthType({ MO_DEVFLOW_GITHUB_TOKEN: "token" })).toBe("service_read_token");
  });
});

describe("GitHub pagination metadata", () => {
  test("detects whether a Link header still has a next page", () => {
    expect(
      githubLinkHeaderHasNextPage({
        link: '<https://api.github.com/repositories/1/issues?page=2>; rel="next", <https://api.github.com/repositories/1/issues?page=4>; rel="last"'
      })
    ).toBe(true);

    expect(
      githubLinkHeaderHasNextPage({
        link: '<https://api.github.com/repositories/1/issues?page=1>; rel="prev"'
      })
    ).toBe(false);
    expect(githubLinkHeaderHasNextPage({})).toBe(false);
  });
});
