import type {
  NormalizedIssue,
  RepoProfile,
  WorkflowFixActionKey,
  WorkflowFixOperation,
  WorkflowFixPreview,
  WorkflowFixStateSource,
  WorkflowFixStateSnapshot,
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
  stateSource?: WorkflowFixStateSource;
}

export function buildWorkflowFixPreview(input: BuildWorkflowFixPreviewInput): WorkflowFixPreview {
  const warnings: string[] = [];
  let blockedReason: string | null = null;
  const operations: WorkflowFixOperation[] = [];
  const currentState = stateSnapshotFromIssue(input.issue, input.stateSource ?? "cache");
  let proposedState: WorkflowFixStateSnapshot = {
    ...currentState,
    labels: [...currentState.labels],
    assignees: [...currentState.assignees]
  };

  if (input.violation.objectType !== "issue") {
    blockedReason = "Only issue workflow fixes can be previewed in this version.";
  } else if (input.issue.state !== "open") {
    blockedReason = "The issue is no longer open in the cache.";
  } else if (input.actionKey === "add_needs_triage") {
    const result = buildAddNeedsTriagePreview(input.profile, input.issue, input.violation, proposedState);
    blockedReason = result.blockedReason;
    operations.push(...result.operations);
    proposedState = result.proposedState;
  } else if (input.actionKey === "move_to_deferred") {
    const result = buildMoveToDeferredPreview(input.profile, input.issue, input.violation, proposedState);
    blockedReason = result.blockedReason;
    operations.push(...result.operations);
    proposedState = result.proposedState;
  } else {
    blockedReason = "Unsupported workflow fix action.";
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
    reason: input.violation.evidenceSummary,
    currentState,
    proposedState,
    operations,
    warnings,
    blockedReason,
    createdAt: input.createdAt,
    expiresAt: input.expiresAt
  };
}

function stateSnapshotFromIssue(issue: NormalizedIssue, source: WorkflowFixStateSource): WorkflowFixStateSnapshot {
  return {
    source,
    state: issue.state,
    labels: [...issue.labels],
    assignees: [...issue.assignees],
    lifecycleState: issue.lifecycleState,
    severity: issue.severity,
    aiEffortLabel: issue.aiEffortLabel,
    updatedAt: issue.updatedAt
  };
}

function buildAddNeedsTriagePreview(
  profile: RepoProfile,
  issue: NormalizedIssue,
  violation: WorkflowViolationView,
  proposedState: WorkflowFixStateSnapshot
): { blockedReason: string | null; operations: WorkflowFixOperation[]; proposedState: WorkflowFixStateSnapshot } {
  if (violation.ruleKey !== "bug_missing_needs_triage") {
    return {
      blockedReason: "This action only applies to bug issues missing needs-triage.",
      operations: [],
      proposedState
    };
  }
  if (issue.labels.includes(profile.labels.needsTriage)) {
    return {
      blockedReason: `Issue already has ${profile.labels.needsTriage}.`,
      operations: [],
      proposedState
    };
  }
  return {
    blockedReason: null,
    operations: [{ type: "add_label", label: profile.labels.needsTriage }],
    proposedState: {
      ...proposedState,
      labels: appendUnique(proposedState.labels, profile.labels.needsTriage)
    }
  };
}

function buildMoveToDeferredPreview(
  profile: RepoProfile,
  issue: NormalizedIssue,
  violation: WorkflowViolationView,
  proposedState: WorkflowFixStateSnapshot
): { blockedReason: string | null; operations: WorkflowFixOperation[]; proposedState: WorkflowFixStateSnapshot } {
  if (!["needs_triage_stale", "premature_active_severity"].includes(violation.ruleKey)) {
    return {
      blockedReason: "This action only applies to stale triage or premature active severity issues.",
      operations: [],
      proposedState
    };
  }
  if (issue.labels.includes(profile.labels.deferred)) {
    return {
      blockedReason: `Issue already has ${profile.labels.deferred}.`,
      operations: [],
      proposedState
    };
  }
  const lifecycleLabelsToRemove = [profile.labels.needsTriage, ...profile.labels.active].filter((label) =>
    issue.labels.includes(label)
  );
  if (violation.ruleKey === "needs_triage_stale" && !issue.labels.includes(profile.labels.needsTriage)) {
    return {
      blockedReason: `Issue no longer has ${profile.labels.needsTriage}.`,
      operations: [],
      proposedState
    };
  }
  if (
    violation.ruleKey === "premature_active_severity" &&
    !profile.labels.active.some((label) => issue.labels.includes(label))
  ) {
    return {
      blockedReason: "Issue no longer has an active severity label.",
      operations: [],
      proposedState
    };
  }

  const operations: WorkflowFixOperation[] = [
    ...lifecycleLabelsToRemove.map((label) => ({ type: "remove_label" as const, label })),
    { type: "add_label", label: profile.labels.deferred },
    { type: "add_comment", body: deferredCommentBody(profile, violation) }
  ];
  return {
    blockedReason: null,
    operations,
    proposedState: {
      ...proposedState,
      labels: appendUnique(
        proposedState.labels.filter((label) => !lifecycleLabelsToRemove.includes(label)),
        profile.labels.deferred
      ),
      lifecycleState: "deferred",
      severity: null
    }
  };
}

function deferredCommentBody(profile: RepoProfile, violation: WorkflowViolationView): string {
  return [
    "Deferred by mo-devflow workflow fix.",
    "",
    `Reason: ${violation.evidenceSummary}`,
    "",
    `If this issue becomes urgent or broad-impact again, remove \`${profile.labels.deferred}\` and apply the appropriate severity label.`
  ].join("\n");
}

function appendUnique(values: string[], value: string): string[] {
  return values.includes(value) ? values : [...values, value];
}
