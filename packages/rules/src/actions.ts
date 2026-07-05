import type {
  AiDriftSignalView,
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

export interface BuildAiEffortLabelPreviewInput {
  profile: RepoProfile;
  signal: AiDriftSignalView;
  currentState: {
    state: "open" | "closed";
    labels: string[];
    updatedAt: string | null;
  };
  targetLabel: string;
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
  } else if (input.actionKey === "add_deferred_explanation_comment") {
    const result = buildDeferredExplanationCommentPreview(input.profile, input.issue, input.violation, proposedState);
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

export function buildAiEffortLabelPreview(input: BuildAiEffortLabelPreviewInput): WorkflowFixPreview {
  const currentState: WorkflowFixStateSnapshot = {
    source: input.stateSource ?? "github",
    state: input.currentState.state,
    labels: [...input.currentState.labels],
    assignees: [],
    lifecycleState: null,
    severity: severityFromLabels(input.profile, input.currentState.labels),
    aiEffortLabel: explicitAiEffortLabel(input.profile, input.currentState.labels),
    updatedAt: input.currentState.updatedAt
  };
  let proposedState: WorkflowFixStateSnapshot = {
    ...currentState,
    labels: [...currentState.labels],
    assignees: [...currentState.assignees]
  };
  let blockedReason: string | null = null;
  const warnings: string[] = [];
  const operations: WorkflowFixOperation[] = [];

  if (!input.profile.labels.aiEffort.includes(input.targetLabel)) {
    blockedReason = `Target label ${input.targetLabel} is not configured as an AI effort label.`;
  } else if (input.currentState.state !== "open") {
    blockedReason = `${input.signal.objectType === "pull_request" ? "PR" : "Issue"} is no longer open on GitHub.`;
  } else {
    const existingAiLabels = input.currentState.labels.filter((label) => input.profile.labels.aiEffort.includes(label));
    operations.push(
      ...existingAiLabels
        .filter((label) => label !== input.targetLabel)
        .map((label) => ({ type: "remove_label" as const, label }))
    );
    if (!existingAiLabels.includes(input.targetLabel)) {
      operations.push({ type: "add_label", label: input.targetLabel });
    }
    if (operations.length === 0) {
      blockedReason = `${input.signal.objectType === "pull_request" ? "PR" : "Issue"} already has ${input.targetLabel}.`;
    }
    proposedState = {
      ...proposedState,
      labels: appendUnique(
        proposedState.labels.filter((label) => !input.profile.labels.aiEffort.includes(label)),
        input.targetLabel
      ),
      aiEffortLabel: input.targetLabel
    };
  }

  if (input.signal.sourceCompleteness === "partial_cache") {
    warnings.push("AI drift evidence is partial; the write preview used fresh GitHub labels before proposing changes.");
  }

  return {
    previewId: input.previewId,
    actionKey: "update_ai_effort_label",
    repoKey: input.profile.key,
    objectType: input.signal.objectType,
    objectNumber: input.signal.objectNumber,
    ruleKey: input.signal.ruleKey,
    title: input.signal.title,
    htmlUrl: input.signal.htmlUrl,
    reason: input.signal.evidenceSummary,
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

function buildDeferredExplanationCommentPreview(
  profile: RepoProfile,
  issue: NormalizedIssue,
  violation: WorkflowViolationView,
  proposedState: WorkflowFixStateSnapshot
): { blockedReason: string | null; operations: WorkflowFixOperation[]; proposedState: WorkflowFixStateSnapshot } {
  if (violation.ruleKey !== "deferred_missing_explanation_comment") {
    return {
      blockedReason: "This action only applies to deferred issues missing an explanation comment.",
      operations: [],
      proposedState
    };
  }
  if (!issue.labels.includes(profile.labels.deferred)) {
    return {
      blockedReason: `Issue no longer has ${profile.labels.deferred}.`,
      operations: [],
      proposedState
    };
  }
  if (hasDeferredExplanationComment(issue)) {
    return {
      blockedReason: "Issue already has a cached deferred explanation comment.",
      operations: [],
      proposedState
    };
  }
  return {
    blockedReason: null,
    operations: [{ type: "add_comment", body: deferredCommentBody(profile, violation) }],
    proposedState: {
      ...proposedState,
      lifecycleState: "deferred"
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

function hasDeferredExplanationComment(issue: NormalizedIssue): boolean {
  const evidence = issue.commentEvidence;
  if (!evidence?.isComplete) {
    return false;
  }
  return evidence.comments.some((comment) => isDeferredExplanationComment(comment.body));
}

function isDeferredExplanationComment(body: string): boolean {
  const normalized = body.toLowerCase();
  return normalized.includes("defer") && normalized.includes("reason:");
}

function appendUnique(values: string[], value: string): string[] {
  return values.includes(value) ? values : [...values, value];
}

function explicitAiEffortLabel(profile: RepoProfile, labels: string[]): string | null {
  return profile.labels.aiEffort.find((label) => labels.includes(label)) ?? null;
}

function severityFromLabels(profile: RepoProfile, labels: string[]): string | null {
  return profile.labels.active.find((label) => labels.includes(label)) ?? null;
}
