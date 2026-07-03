import { describe, expect, test } from "vitest";
import type { NormalizedIssue, RepoProfile, WorkflowViolationView } from "@mo-devflow/shared";
import { buildWorkflowFixPreview } from "./actions";

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

const issue: NormalizedIssue = {
  githubId: 1,
  number: 42,
  title: "panic on insert",
  body: "",
  state: "open",
  authorLogin: "alice",
  htmlUrl: "https://github.com/matrixorigin/matrixone/issues/42",
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T01:00:00.000Z",
  closedAt: null,
  labels: ["kind/bug"],
  assignees: [],
  ownerLogin: "alice",
  ownerReason: "author",
  lifecycleState: "other",
  severity: null,
  aiEffortLabel: null,
  isPullRequest: false,
  sourceAuthType: "anonymous",
  visibilityClass: "anonymous_readable",
  isComplete: false,
  rawPayload: {}
};

const violation: WorkflowViolationView = {
  objectType: "issue",
  objectNumber: 42,
  title: "panic on insert",
  htmlUrl: "https://github.com/matrixorigin/matrixone/issues/42",
  ruleKey: "bug_missing_needs_triage",
  severity: "warning",
  relatedLogin: "alice",
  evidenceSummary: "Open bug issue #42 has no needs-triage label.",
  suggestedAction: "Add needs-triage or move it to an explicit lifecycle state.",
  fixable: true,
  firstDetectedAt: "2026-07-03T00:00:00.000Z",
  lastDetectedAt: "2026-07-03T00:00:00.000Z"
};

describe("workflow fix previews", () => {
  test("previews adding needs-triage for a missing intake label violation", () => {
    const preview = buildWorkflowFixPreview({
      profile,
      issue,
      violation,
      actionKey: "add_needs_triage",
      previewId: "preview-1",
      createdAt: "2026-07-03T00:00:00.000Z",
      expiresAt: "2026-07-03T00:10:00.000Z"
    });

    expect(preview.blockedReason).toBeNull();
    expect(preview.operations).toEqual([{ type: "add_label", label: "needs-triage" }]);
    expect(preview.warnings).toContain("Preview is based on partial cached issue data; confirm execution should re-check GitHub state.");
  });

  test("blocks preview when the label already exists in cache", () => {
    const preview = buildWorkflowFixPreview({
      profile,
      issue: { ...issue, labels: ["kind/bug", "needs-triage"] },
      violation,
      actionKey: "add_needs_triage",
      previewId: "preview-2",
      createdAt: "2026-07-03T00:00:00.000Z",
      expiresAt: "2026-07-03T00:10:00.000Z"
    });

    expect(preview.operations).toEqual([]);
    expect(preview.blockedReason).toBe("Issue already has needs-triage.");
  });

  test("blocks unsupported rule/action combinations", () => {
    const preview = buildWorkflowFixPreview({
      profile,
      issue,
      violation: { ...violation, ruleKey: "needs_triage_stale" },
      actionKey: "add_needs_triage",
      previewId: "preview-3",
      createdAt: "2026-07-03T00:00:00.000Z",
      expiresAt: "2026-07-03T00:10:00.000Z"
    });

    expect(preview.operations).toEqual([]);
    expect(preview.blockedReason).toBe("This action only applies to bug issues missing needs-triage.");
  });
});
