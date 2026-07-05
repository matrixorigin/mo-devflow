import { beforeEach, describe, expect, test, vi } from "vitest";
import type { RepoProfile, WorkflowFixPreview, WorkflowFixStateSnapshot } from "@mo-devflow/shared";
import {
  applyWorkflowFixPreview,
  classifyGitHubError,
  fetchIssueWritePermission,
  fetchGitHubSnapshot,
  configuredGitHubSourceAuthType,
  githubSnapshotCursorValue,
  githubSnapshotNextHighWatermark,
  githubSnapshotPreviousHighWatermark,
  githubSnapshotWindowScope,
  githubLinkHeaderHasNextPage,
  linkedIssueNumbersFromPullRequestGraphqlResponse
} from "./index";

const octokitMocks = vi.hoisted(() => ({
  issuesGet: vi.fn(),
  issuesListForRepo: vi.fn(),
  issuesAddLabels: vi.fn(),
  issuesRemoveLabel: vi.fn(),
  issuesCreateComment: vi.fn(),
  paginateIterator: vi.fn(),
  pullsList: vi.fn(),
  reposGet: vi.fn(),
  usersGetAuthenticated: vi.fn()
}));

vi.mock("@octokit/rest", () => ({
  Octokit: vi.fn(function MockOctokit() {
    return {
      rest: {
        issues: {
          get: octokitMocks.issuesGet,
          listForRepo: octokitMocks.issuesListForRepo,
          addLabels: octokitMocks.issuesAddLabels,
          removeLabel: octokitMocks.issuesRemoveLabel,
          createComment: octokitMocks.issuesCreateComment
        },
        pulls: {
          list: octokitMocks.pullsList
        },
        repos: {
          get: octokitMocks.reposGet
        },
        users: {
          getAuthenticated: octokitMocks.usersGetAuthenticated
        }
      },
      paginate: {
        iterator: octokitMocks.paginateIterator
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
  currentState: stateSnapshot(["kind/bug"]),
  proposedState: stateSnapshot(["kind/bug", "needs-triage"]),
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
  currentState: stateSnapshot(["kind/bug", "needs-triage"]),
  proposedState: {
    ...stateSnapshot(["kind/bug", "deferred"]),
    lifecycleState: "deferred"
  },
  operations: [
    { type: "remove_label", label: "needs-triage" },
    { type: "add_label", label: "deferred" },
    { type: "add_comment", body: deferredComment }
  ]
};

const deferredExplanationPreview: WorkflowFixPreview = {
  ...preview,
  previewId: "eb9c9c9d-47ce-4e3e-a5c6-b4e2d2bdf9a1",
  actionKey: "add_deferred_explanation_comment",
  ruleKey: "deferred_missing_explanation_comment",
  reason: "Deferred issue #42 has no cached comment explaining why it was deferred.",
  currentState: stateSnapshot(["kind/bug", "deferred"]),
  proposedState: {
    ...stateSnapshot(["kind/bug", "deferred"]),
    lifecycleState: "deferred"
  },
  operations: [{ type: "add_comment", body: deferredComment }]
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

function issueResponseWithUpdatedAt(labels: string[], updatedAt: string, state: "open" | "closed" = "open") {
  return {
    data: {
      state,
      labels: labels.map((name) => ({ name })),
      updated_at: updatedAt
    },
    headers: { "x-ratelimit-remaining": "99" }
  };
}

function snapshotPage<T>(data: T[], link: string | null = null) {
  return {
    data,
    headers: {
      ...(link ? { link } : {}),
      "x-ratelimit-remaining": "88"
    }
  };
}

function snapshotIssue(number: number, updatedAt: string) {
  return {
    id: number,
    number,
    title: `issue ${number}`,
    state: "open",
    user: { login: "alice" },
    html_url: `https://github.com/matrixorigin/matrixone/issues/${number}`,
    created_at: updatedAt,
    updated_at: updatedAt,
    closed_at: null,
    labels: [],
    assignees: []
  };
}

function snapshotPullRequest(number: number, state: "open" | "closed", updatedAt: string) {
  return {
    id: number,
    number,
    title: `pr ${number}`,
    state,
    user: { login: "alice" },
    html_url: `https://github.com/matrixorigin/matrixone/pull/${number}`,
    created_at: updatedAt,
    updated_at: updatedAt,
    closed_at: state === "closed" ? updatedAt : null,
    merged_at: null,
    draft: false,
    head: { ref: "feature" },
    base: { ref: "main" },
    labels: [],
    assignees: [],
    requested_reviewers: []
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
    { state: "open" as const, labels: ["kind/bug", "needs-triage"], skipped: "issue_labels_changed" },
    { state: "open" as const, labels: [], skipped: "issue_labels_changed" },
    { state: "open" as const, labels: ["kind/bug", "deferred"], skipped: "issue_labels_changed" },
    { state: "open" as const, labels: ["kind/bug", "severity/s0"], skipped: "issue_labels_changed" }
  ])("does not execute when the preview baseline is stale: $skipped", async ({ state, labels, skipped }) => {
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

  test("does not execute when the issue was updated after the preview", async () => {
    octokitMocks.issuesGet.mockResolvedValue(issueResponseWithUpdatedAt(["kind/bug"], "2026-07-03T00:02:00.000Z"));

    const result = await applyWorkflowFixPreview({
      token: "test-user-token",
      profile,
      preview
    });

    expect(octokitMocks.issuesAddLabels).not.toHaveBeenCalled();
    expect(result.appliedOperations).toEqual([]);
    expect(result.response).toEqual({ skipped: "issue_updated_since_preview" });
  });

  test("does not execute previews that were not built from GitHub fresh state", async () => {
    octokitMocks.issuesGet.mockResolvedValue(issueResponse(["kind/bug"]));

    const result = await applyWorkflowFixPreview({
      token: "test-user-token",
      profile,
      preview: {
        ...preview,
        currentState: {
          ...preview.currentState,
          source: "cache"
        }
      }
    });

    expect(octokitMocks.issuesAddLabels).not.toHaveBeenCalled();
    expect(result.appliedOperations).toEqual([]);
    expect(result.response).toEqual({ skipped: "preview_state_not_fresh" });
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

  test("does not move to deferred when labels changed after preview", async () => {
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
    expect(result.response).toEqual({ skipped: "issue_labels_changed" });
  });

  test("adds a deferred explanation comment without changing labels", async () => {
    octokitMocks.issuesGet.mockResolvedValue(issueResponse(["kind/bug", "deferred"]));

    const result = await applyWorkflowFixPreview({
      token: "test-user-token",
      profile,
      preview: deferredExplanationPreview
    });

    expect(octokitMocks.issuesRemoveLabel).not.toHaveBeenCalled();
    expect(octokitMocks.issuesAddLabels).not.toHaveBeenCalled();
    expect(octokitMocks.issuesCreateComment).toHaveBeenCalledWith({
      owner: "matrixorigin",
      repo: "matrixone",
      issue_number: 42,
      body: deferredComment
    });
    expect(result.appliedOperations).toEqual(deferredExplanationPreview.operations);
    expect(result.beforeState.labels).toEqual(["kind/bug", "deferred"]);
    expect(result.afterState).toMatchObject({
      labels: ["kind/bug", "deferred"],
      lifecycleState: "deferred",
      updatedAt: null
    });
  });

  test("does not add deferred explanation comments after the issue leaves deferred", async () => {
    octokitMocks.issuesGet.mockResolvedValue(issueResponse(["kind/bug", "needs-triage"]));

    const result = await applyWorkflowFixPreview({
      token: "test-user-token",
      profile,
      preview: deferredExplanationPreview
    });

    expect(octokitMocks.issuesCreateComment).not.toHaveBeenCalled();
    expect(result.appliedOperations).toEqual([]);
    expect(result.response).toEqual({ skipped: "issue_labels_changed" });
  });
});

describe("GitHub repository write permission", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("allows issue workflow fixes for triage or stronger repository permission", async () => {
    octokitMocks.reposGet.mockResolvedValue({
      data: { permissions: { pull: true, triage: true, push: false, maintain: false, admin: false } },
      headers: { "x-ratelimit-remaining": "88" }
    });

    const result = await fetchIssueWritePermission({ token: "test-user-token", profile });

    expect(octokitMocks.reposGet).toHaveBeenCalledWith({ owner: "matrixorigin", repo: "matrixone" });
    expect(result).toMatchObject({
      allowed: true,
      permission: "triage",
      rateLimitRemaining: 88
    });
  });

  test("blocks issue workflow fixes when the token only has read permission", async () => {
    octokitMocks.reposGet.mockResolvedValue({
      data: { permissions: { pull: true, triage: false, push: false, maintain: false, admin: false } },
      headers: { "x-ratelimit-remaining": "87" }
    });

    const result = await fetchIssueWritePermission({ token: "test-user-token", profile });

    expect(result).toMatchObject({
      allowed: false,
      permission: "read"
    });
    expect(result.message).toContain("triage or write access");
  });

  test("blocks issue workflow fixes when repository permissions are not reported", async () => {
    octokitMocks.reposGet.mockResolvedValue({
      data: {},
      headers: {}
    });

    const result = await fetchIssueWritePermission({ token: "test-user-token", profile });

    expect(result).toMatchObject({
      allowed: false,
      permission: "unverified",
      rateLimitRemaining: null
    });
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

  test("builds an explicit updated-at polling window for snapshot sync runs", () => {
    const scope = githubSnapshotWindowScope(
      [
        { updated_at: "2026-07-04T09:00:00Z" },
        { updated_at: "not-a-date" },
        { updated_at: "2026-07-04T10:00:00Z" }
      ],
      false,
      true
    );

    expect(scope).toEqual({
      returned: 3,
      complete: false,
      watermarkReached: true,
      newestUpdatedAt: "2026-07-04T10:00:00Z",
      oldestUpdatedAt: "2026-07-04T09:00:00Z"
    });
    const window = {
      mode: "updated_desc_window" as const,
      maxPages: 2,
      previousHighWatermarkAt: "2026-07-03T00:00:00Z",
      nextHighWatermarkAt: null,
      issues: scope,
      openPullRequests: githubSnapshotWindowScope([{ updated_at: "2026-07-04T08:00:00Z" }], true),
      closedPullRequests: githubSnapshotWindowScope([], true)
    };
    const nextHighWatermarkAt = githubSnapshotNextHighWatermark(window);
    expect(nextHighWatermarkAt).toBe("2026-07-04T10:00:00Z");
    expect(
      githubSnapshotNextHighWatermark({
        ...window,
        previousHighWatermarkAt: "2026-07-05T00:00:00Z"
      })
    ).toBe("2026-07-05T00:00:00Z");
    expect(
      JSON.parse(
        githubSnapshotCursorValue({
          ...window,
          nextHighWatermarkAt
        })
      )
    ).toEqual({
      mode: "updated_desc_window",
      maxPages: 2,
      previousHighWatermarkAt: "2026-07-03T00:00:00Z",
      nextHighWatermarkAt: "2026-07-04T10:00:00Z",
      issuesNewestUpdatedAt: "2026-07-04T10:00:00Z",
      issuesOldestUpdatedAt: "2026-07-04T09:00:00Z",
      openPrsNewestUpdatedAt: "2026-07-04T08:00:00Z",
      openPrsOldestUpdatedAt: "2026-07-04T08:00:00Z",
      closedPrsNewestUpdatedAt: null,
      closedPrsOldestUpdatedAt: null,
      issuesComplete: false,
      openPullRequestsComplete: true,
      issuesWatermarkReached: true,
      openPullRequestsWatermarkReached: false,
      closedPullRequestsWatermarkReached: false
    });
    expect(githubSnapshotPreviousHighWatermark(githubSnapshotCursorValue({ ...window, nextHighWatermarkAt }))).toBe(
      "2026-07-04T10:00:00Z"
    );
    expect(githubSnapshotPreviousHighWatermark("not-json")).toBeNull();
  });

  test("stops updated-desc snapshot pagination after reaching the previous watermark", async () => {
    const originalEnv = { ...process.env };
    process.env = {
      ...originalEnv,
      MO_DEVFLOW_SYNC_MAX_PAGES: "3",
      MO_DEVFLOW_PR_DETAIL_MAX_ITEMS: "0",
      MO_DEVFLOW_ISSUE_COMMENT_MAX_ITEMS: "0"
    };
    const pageCounts = new Map<string, number>();
    const paged = async function* <T>(key: string, pages: Array<{ data: T[]; headers: Record<string, string> }>) {
      for (const page of pages) {
        pageCounts.set(key, (pageCounts.get(key) ?? 0) + 1);
        yield page;
      }
    };
    octokitMocks.paginateIterator.mockImplementation((endpoint: unknown, params: { state?: string }) => {
      if (endpoint === octokitMocks.issuesListForRepo) {
        return paged("issues", [
          snapshotPage(
            [snapshotIssue(1, "2026-07-04T10:00:00Z")],
            '<https://api.github.test/issues?page=2>; rel="next"'
          ),
          snapshotPage(
            [snapshotIssue(2, "2026-07-04T09:00:00Z")],
            '<https://api.github.test/issues?page=3>; rel="next"'
          ),
          snapshotPage([snapshotIssue(3, "2026-07-04T08:00:00Z")])
        ]);
      }
      if (endpoint === octokitMocks.pullsList && params.state === "open") {
        return paged("open-prs", [
          snapshotPage(
            [snapshotPullRequest(10, "open", "2026-07-04T09:15:00Z")],
            '<https://api.github.test/pulls?page=2>; rel="next"'
          ),
          snapshotPage([snapshotPullRequest(11, "open", "2026-07-04T08:15:00Z")])
        ]);
      }
      return paged("closed-prs", [
        snapshotPage(
          [snapshotPullRequest(12, "closed", "2026-07-04T08:30:00Z")],
          '<https://api.github.test/pulls?page=2>; rel="next"'
        ),
        snapshotPage([snapshotPullRequest(13, "closed", "2026-07-04T07:30:00Z")])
      ]);
    });

    try {
      const snapshot = await fetchGitHubSnapshot(profile, {
        previousCursorValue: JSON.stringify({
          mode: "updated_desc_window",
          nextHighWatermarkAt: "2026-07-04T09:30:00Z"
        })
      });

      expect(pageCounts.get("issues")).toBe(2);
      expect(pageCounts.get("open-prs")).toBe(1);
      expect(pageCounts.get("closed-prs")).toBe(1);
      expect(snapshot.syncWindow.previousHighWatermarkAt).toBe("2026-07-04T09:30:00Z");
      expect(snapshot.syncWindow.nextHighWatermarkAt).toBe("2026-07-04T10:00:00Z");
      expect(snapshot.syncWindow.issues.watermarkReached).toBe(true);
      expect(snapshot.syncWindow.openPullRequests.watermarkReached).toBe(true);
      expect(snapshot.syncWindow.closedPullRequests.watermarkReached).toBe(true);
      expect(snapshot.issues.map((issue) => issue.number)).toEqual([1, 2]);
      expect(snapshot.pullRequests.map((pr) => pr.number)).toEqual([10, 12]);
    } finally {
      process.env = originalEnv;
    }
  });
});

describe("pull request linked issue GraphQL response", () => {
  test("combines closing references with manually connected issues", () => {
    expect(
      linkedIssueNumbersFromPullRequestGraphqlResponse({
        repository: {
          pullRequest: {
            closingIssuesReferences: { nodes: [{ number: 42 }] },
            timelineItems: {
              nodes: [
                {
                  __typename: "ConnectedEvent",
                  createdAt: "2026-07-03T01:00:00Z",
                  subject: { __typename: "Issue", number: 24994 }
                }
              ]
            }
          }
        },
        rateLimit: { remaining: 98 }
      })
    ).toEqual([42, 24994]);
  });

  test("does not keep an issue after a later disconnect event", () => {
    expect(
      linkedIssueNumbersFromPullRequestGraphqlResponse({
        repository: {
          pullRequest: {
            closingIssuesReferences: { nodes: [] },
            timelineItems: {
              nodes: [
                {
                  __typename: "ConnectedEvent",
                  createdAt: "2026-07-03T01:00:00Z",
                  subject: { __typename: "Issue", number: 24994 }
                },
                {
                  __typename: "DisconnectedEvent",
                  createdAt: "2026-07-03T02:00:00Z",
                  subject: { __typename: "Issue", number: 24994 }
                }
              ]
            }
          }
        }
      })
    ).toEqual([]);
  });
});
