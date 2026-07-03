import type {
  NormalizedIssue,
  RepoProfile,
  WorkflowFixActionKey,
  WorkflowFixOperation,
  WorkflowFixPreview,
  WorkflowViolationView
} from "@mo-devflow/shared";

export interface BuildWorkflowFixPreviewInput {
  profile: RepoProfile;
  issue: NormalizedIssue;
  violation: WorkflowViolationView;
  actionKey: WorkflowFixActionKey;
  previewId: string;
  createdAt: string;
  expiresAt: string;
}

export function buildWorkflowFixPreview(input: BuildWorkflowFixPreviewInput): WorkflowFixPreview {
  const warnings: string[] = [];
  let blockedReason: string | null = null;
  const operations: WorkflowFixOperation[] = [];

  if (input.violation.objectType !== "issue") {
    blockedReason = "Only issue workflow fixes can be previewed in this version.";
  } else if (input.issue.state !== "open") {
    blockedReason = "The issue is no longer open in the cache.";
  } else if (input.actionKey !== "add_needs_triage") {
    blockedReason = "Unsupported workflow fix action.";
  } else if (input.violation.ruleKey !== "bug_missing_needs_triage") {
    blockedReason = "This action only applies to bug issues missing needs-triage.";
  } else if (input.issue.labels.includes(input.profile.labels.needsTriage)) {
    blockedReason = `Issue already has ${input.profile.labels.needsTriage}.`;
  } else {
    operations.push({
      type: "add_label",
      label: input.profile.labels.needsTriage
    });
  }

  if (!input.issue.isComplete) {
    warnings.push("Preview is based on partial cached issue data; confirm execution should re-check GitHub state.");
  }

  return {
    previewId: input.previewId,
    actionKey: input.actionKey,
    repoKey: input.profile.key,
    objectType: input.violation.objectType,
    objectNumber: input.violation.objectNumber,
    ruleKey: input.violation.ruleKey,
    title: input.issue.title,
    htmlUrl: input.issue.htmlUrl,
    operations,
    warnings,
    blockedReason,
    createdAt: input.createdAt,
    expiresAt: input.expiresAt
  };
}
