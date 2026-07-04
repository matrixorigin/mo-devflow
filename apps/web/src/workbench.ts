import type { CriticalIssueView, PersonSummary, PersonalIssueView, PersonalPullRequestView } from "@mo-devflow/shared";

export type WorkloadStatus = "critical" | "attention" | "triage" | "active" | "clear";

export function personWorkloadScore(person: PersonSummary): number {
  return (
    person.activeCriticalIssues * 100 +
    person.attentionPrs * 40 +
    person.needsTriageIssues * 14 +
    person.pendingPrs * 5 +
    person.deferredIssues * 3 +
    person.prsCreatedYesterday +
    person.prsMergedYesterday
  );
}

export function personWorkloadStatus(person: PersonSummary): WorkloadStatus {
  if (person.activeCriticalIssues > 0) {
    return "critical";
  }
  if (person.attentionPrs > 0) {
    return "attention";
  }
  if (person.needsTriageIssues > 0) {
    return "triage";
  }
  if (
    person.pendingPrs > 0 ||
    person.deferredIssues > 0 ||
    person.prsCreatedYesterday > 0 ||
    person.prsMergedYesterday > 0
  ) {
    return "active";
  }
  return "clear";
}

export function sortPeopleByWorkload(people: PersonSummary[]): PersonSummary[] {
  return [...people].sort((left, right) => {
    const statusDelta =
      workloadStatusRank(personWorkloadStatus(right)) - workloadStatusRank(personWorkloadStatus(left));
    if (statusDelta !== 0) {
      return statusDelta;
    }
    const scoreDelta = personWorkloadScore(right) - personWorkloadScore(left);
    return scoreDelta === 0 ? left.login.localeCompare(right.login) : scoreDelta;
  });
}

function workloadStatusRank(status: WorkloadStatus): number {
  if (status === "critical") {
    return 5;
  }
  if (status === "attention") {
    return 4;
  }
  if (status === "triage") {
    return 3;
  }
  if (status === "active") {
    return 2;
  }
  return 1;
}

export function personPrimaryReasons(person: PersonSummary, testingPrs: number): string[] {
  const reasons = [
    person.activeCriticalIssues > 0 ? `${person.activeCriticalIssues} active critical` : null,
    person.attentionPrs > 0 ? `${person.attentionPrs} PR attention` : null,
    testingPrs > 0 ? `${testingPrs} in testing` : null,
    person.needsTriageIssues > 0 ? `${person.needsTriageIssues} needs triage` : null,
    person.pendingPrs > 0 ? `${person.pendingPrs} pending PRs` : null,
    person.deferredIssues > 0 ? `${person.deferredIssues} deferred` : null
  ].filter((reason): reason is string => reason !== null);

  if (reasons.length > 0) {
    return reasons;
  }
  return ["No active watched work"];
}

const attentionFlagLabels: Record<string, string> = {
  requested_changes: "Changes requested",
  ci_failed: "CI failed",
  merge_conflict: "Merge conflict",
  no_human_action_24h: "No human action over 24h",
  testing_stalled: "Testing stalled",
  review_requested_no_response: "Review waiting"
};

export function prAttentionReasons(pr: PersonalPullRequestView): string[] {
  const reasons = pr.attentionFlags.map((flag) => attentionFlagLabels[flag] ?? flag.replaceAll("_", " "));

  if (pr.reviewDecision === "changes_requested" && !reasons.includes(attentionFlagLabels.requested_changes)) {
    reasons.push(attentionFlagLabels.requested_changes);
  }
  if (pr.ciState && ["failure", "failed", "error", "timed_out", "action_required", "cancelled"].includes(pr.ciState)) {
    reasons.push(attentionFlagLabels.ci_failed);
  }
  if (pr.mergeStateStatus === "dirty") {
    reasons.push(attentionFlagLabels.merge_conflict);
  }
  if (pr.testingState === "test_changes_requested") {
    reasons.push("Testing changes requested");
  }

  return [...new Set(reasons)];
}

export function criticalIssueReasons(issue: CriticalIssueView): string[] {
  const blockers = issue.blockers.filter((blocker) => blocker.severity !== "info").map((blocker) => blocker.message);
  const evidence = [
    issue.linkedPullRequests.length === 0 ? "No linked PR visible" : null,
    !issue.isComplete ? "Partial cache evidence" : null,
    issue.aiEffortLabel ? issue.aiEffortLabel : "AI effort unknown"
  ].filter((reason): reason is string => reason !== null);

  return [...blockers, ...evidence];
}

export function personalIssueReasons(issue: PersonalIssueView): string[] {
  const reasons = [
    issue.lifecycleState === "needs-triage" ? "Waiting triage decision" : null,
    issue.lifecycleState === "deferred" ? "Deferred follow-up" : null,
    issue.severity ? issue.severity : null,
    !issue.isComplete ? "Partial cache evidence" : null
  ].filter((reason): reason is string => reason !== null);

  if (reasons.length > 0) {
    return reasons;
  }
  return issue.labels.slice(0, 3);
}
