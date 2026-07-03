import { beforeEach, describe, expect, test, vi } from "vitest";
import type { RepoProfile, WorkflowFixPreview } from "@mo-devflow/shared";
import { applyWorkflowFixPreview } from "./index";

const octokitMocks = vi.hoisted(() => ({
  issuesGet: vi.fn(),
  issuesAddLabels: vi.fn(),
  usersGetAuthenticated: vi.fn()
}));

vi.mock("@octokit/rest", () => ({
  Octokit: vi.fn(function MockOctokit() {
    return {
      rest: {
        issues: {
          get: octokitMocks.issuesGet,
          addLabels: octokitMocks.issuesAddLabels
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
  operations: [{ type: "add_label", label: "needs-triage" }],
  warnings: [],
  blockedReason: null,
  createdAt: "2026-07-03T00:00:00.000Z",
  expiresAt: "2026-07-03T00:10:00.000Z"
};

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
    expect(result.response).toEqual({ skipped });
  });
});
