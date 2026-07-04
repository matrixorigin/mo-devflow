import { describe, expect, test } from "vitest";
import type { NormalizedIssue, RepoProfile, WorkflowViolationView } from "@mo-devflow/shared";
import { emptyNotificationTrace } from "@mo-devflow/shared";
import { buildWorkflowFixPreview } from "./actions";

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
  testing: {
    handoffSignals: { labels: [], reviewerUsers: [], assigneeUsers: [], comments: [] }
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
  sourceUserId: null,
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
  lastDetectedAt: "2026-07-03T00:00:00.000Z",
  notification: emptyNotificationTrace()
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
    expect(preview.reason).toBe("Open bug issue #42 has no needs-triage label.");
    expect(preview.currentState).toMatchObject({
      source: "cache",
      state: "open",
      labels: ["kind/bug"],
      assignees: [],
      lifecycleState: "other"
    });
    expect(preview.proposedState.labels).toEqual(["kind/bug", "needs-triage"]);
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
    expect(preview.currentState.labels).toEqual(["kind/bug", "needs-triage"]);
    expect(preview.proposedState.labels).toEqual(["kind/bug", "needs-triage"]);
  });

  test("marks preview state source as github after a fresh API check", () => {
    const preview = buildWorkflowFixPreview({
      profile,
      issue,
      violation,
      actionKey: "add_needs_triage",
      previewId: "preview-2b",
      createdAt: "2026-07-03T00:00:00.000Z",
      expiresAt: "2026-07-03T00:10:00.000Z",
      stateSource: "github"
    });

    expect(preview.currentState.source).toBe("github");
    expect(preview.proposedState.source).toBe("github");
  });

  test("previews moving a stale needs-triage issue to deferred with an explanation comment", () => {
    const deferredPreview = buildWorkflowFixPreview({
      profile,
      issue: {
        ...issue,
        labels: ["kind/bug", "needs-triage"],
        lifecycleState: "needs-triage"
      },
      violation: {
        ...violation,
        ruleKey: "needs_triage_stale",
        evidenceSummary: "Issue #42 has stayed in needs-triage for 96h.",
        suggestedAction: "Triage it into active work, deferred, or close/merge with an existing issue."
      },
      actionKey: "move_to_deferred",
      previewId: "preview-4",
      createdAt: "2026-07-03T00:00:00.000Z",
      expiresAt: "2026-07-03T00:10:00.000Z"
    });

    expect(deferredPreview.blockedReason).toBeNull();
    expect(deferredPreview.operations).toEqual([
      { type: "remove_label", label: "needs-triage" },
      { type: "add_label", label: "deferred" },
      {
        type: "add_comment",
        body:
          "Deferred by mo-devflow workflow fix.\n\nReason: Issue #42 has stayed in needs-triage for 96h.\n\nIf this issue becomes urgent or broad-impact again, remove `deferred` and apply the appropriate severity label."
      }
    ]);
    expect(deferredPreview.proposedState.labels).toEqual(["kind/bug", "deferred"]);
    expect(deferredPreview.proposedState.lifecycleState).toBe("deferred");
    expect(deferredPreview.proposedState.severity).toBeNull();
  });

  test("previews moving premature active severity to deferred by removing active labels", () => {
    const deferredPreview = buildWorkflowFixPreview({
      profile,
      issue: {
        ...issue,
        labels: ["kind/bug", "severity/s0", "ai-easy"],
        lifecycleState: "critical",
        severity: "severity/s0",
        aiEffortLabel: "ai-easy"
      },
      violation: {
        ...violation,
        ruleKey: "premature_active_severity",
        evidenceSummary: "New issue #42 has severity/s0 without triage evidence.",
        suggestedAction: "Confirm this is active urgent work, or move it back to needs-triage/deferred."
      },
      actionKey: "move_to_deferred",
      previewId: "preview-5",
      createdAt: "2026-07-03T00:00:00.000Z",
      expiresAt: "2026-07-03T00:10:00.000Z"
    });

    expect(deferredPreview.blockedReason).toBeNull();
    expect(deferredPreview.operations.map((operation) => operation.type)).toEqual([
      "remove_label",
      "add_label",
      "add_comment"
    ]);
    expect(deferredPreview.operations).toContainEqual({ type: "remove_label", label: "severity/s0" });
    expect(deferredPreview.proposedState.labels).toEqual(["kind/bug", "ai-easy", "deferred"]);
    expect(deferredPreview.proposedState.lifecycleState).toBe("deferred");
    expect(deferredPreview.proposedState.severity).toBeNull();
    expect(deferredPreview.proposedState.aiEffortLabel).toBe("ai-easy");
  });

  test("blocks deferred preview when issue is already deferred", () => {
    const deferredPreview = buildWorkflowFixPreview({
      profile,
      issue: {
        ...issue,
        labels: ["kind/bug", "deferred"],
        lifecycleState: "deferred"
      },
      violation: {
        ...violation,
        ruleKey: "needs_triage_stale",
        evidenceSummary: "Issue #42 has stayed in needs-triage for 96h.",
        suggestedAction: "Triage it into active work, deferred, or close/merge with an existing issue."
      },
      actionKey: "move_to_deferred",
      previewId: "preview-6",
      createdAt: "2026-07-03T00:00:00.000Z",
      expiresAt: "2026-07-03T00:10:00.000Z"
    });

    expect(deferredPreview.operations).toEqual([]);
    expect(deferredPreview.blockedReason).toBe("Issue already has deferred.");
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
