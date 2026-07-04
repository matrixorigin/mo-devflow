import type {
  CriticalIssueView,
  PersonSummary,
  PersonalActionView,
  PersonalIssueView,
  PersonalPullRequestView
} from "@mo-devflow/shared";

export type WorkloadStatus = "critical" | "attention" | "triage" | "active" | "clear";
export type PersonalActivityTone = "critical" | "attention" | "normal" | "muted";
export type PersonalActivityObjectType = "issue" | "pull_request";

export interface PersonalActivityItem {
  id: string;
  objectType: PersonalActivityObjectType;
  number: number;
  title: string;
  htmlUrl: string;
  phase: string;
  tone: PersonalActivityTone;
  priority: number;
  ageHours: number;
  lastHumanActionAt: string | null;
  testingQueueAgeHours: number | null;
  severity: string | null;
  lifecycleState: string | null;
  reviewDecision: string | null;
  ciState: string | null;
  mergeStateStatus: string | null;
  testingState: string | null;
  linkedIssueNumbers: number[];
  linkedPullRequestNumbers: number[];
  reasons: string[];
  isComplete: boolean;
}

export interface FlowEfficiencyMetricPoint {
  prsCreated: number;
  prsMerged: number;
  issuesOpened: number;
  issuesClosed: number;
  issuesDeferred: number;
  workflowViolationsDetected: number;
}

export interface FlowEfficiencyPullRequest {
  ageHours: number;
  attentionFlags: string[];
  testingState: string;
  testingQueueAgeHours: number | null;
}

export interface FlowEfficiencyIssue {
  ageHours: number;
}

export interface FlowEfficiencySummary {
  prsCreated: number;
  prsMerged: number;
  prOpenDelta: number;
  prMergeRatePercent: number | null;
  issuesOpened: number;
  issuesResolved: number;
  issueOpenDelta: number;
  issueDrainRatePercent: number | null;
  workflowViolations: number;
  pendingPrs: number;
  averagePendingPrAgeHours: number | null;
  attentionPrs: number;
  prAttentionRatePercent: number | null;
  activeCriticalIssues: number;
  averageActiveIssueAgeHours: number | null;
  testingQueuePrs: number;
  averageTestingQueueAgeHours: number | null;
}

export function effectiveAiEffortLabel(label: string | null): string {
  return label ?? "ai-easy";
}

export function flowEfficiencySummary(input: {
  points: FlowEfficiencyMetricPoint[];
  pendingPrs: FlowEfficiencyPullRequest[];
  activeIssues: FlowEfficiencyIssue[];
  testingPrs?: Array<Pick<FlowEfficiencyPullRequest, "testingQueueAgeHours">>;
  testingQueuePrs?: number;
  averageTestingQueueAgeHours?: number | null;
}): FlowEfficiencySummary {
  const prsCreated = sumBy(input.points, (point) => point.prsCreated);
  const prsMerged = sumBy(input.points, (point) => point.prsMerged);
  const issuesOpened = sumBy(input.points, (point) => point.issuesOpened);
  const issuesResolved =
    sumBy(input.points, (point) => point.issuesClosed) + sumBy(input.points, (point) => point.issuesDeferred);
  const testingPrs = input.testingPrs ?? input.pendingPrs.filter(isTestingQueuePullRequest);

  return {
    prsCreated,
    prsMerged,
    prOpenDelta: prsCreated - prsMerged,
    prMergeRatePercent: percentage(prsMerged, prsCreated),
    issuesOpened,
    issuesResolved,
    issueOpenDelta: issuesOpened - issuesResolved,
    issueDrainRatePercent: percentage(issuesResolved, issuesOpened),
    workflowViolations: sumBy(input.points, (point) => point.workflowViolationsDetected),
    pendingPrs: input.pendingPrs.length,
    averagePendingPrAgeHours: average(input.pendingPrs.map((pr) => pr.ageHours)),
    attentionPrs: input.pendingPrs.filter((pr) => pr.attentionFlags.length > 0).length,
    prAttentionRatePercent: percentage(
      input.pendingPrs.filter((pr) => pr.attentionFlags.length > 0).length,
      input.pendingPrs.length
    ),
    activeCriticalIssues: input.activeIssues.length,
    averageActiveIssueAgeHours: average(input.activeIssues.map((issue) => issue.ageHours)),
    testingQueuePrs: input.testingQueuePrs ?? testingPrs.length,
    averageTestingQueueAgeHours:
      input.averageTestingQueueAgeHours !== undefined
        ? input.averageTestingQueueAgeHours
        : average(testingPrs.map((pr) => pr.testingQueueAgeHours).filter((age): age is number => age !== null))
  };
}

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
    person.activeCriticalIssues > 0 ? `${person.activeCriticalIssues} active s-1/s0` : null,
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
    effectiveAiEffortLabel(issue.aiEffortLabel)
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

export function personalActivityItems(person: PersonalActionView): PersonalActivityItem[] {
  const items: PersonalActivityItem[] = [];
  const seen = new Set<string>();
  const add = (item: PersonalActivityItem): void => {
    if (seen.has(item.id)) {
      return;
    }
    seen.add(item.id);
    items.push(item);
  };

  for (const issue of person.activeCriticalIssues) {
    add(activityFromIssue(issue, "Active s-1/s0", "critical", 1_000 + severityPriority(issue.severity)));
  }
  for (const pr of person.attentionPrs) {
    add(activityFromPullRequest(pr, "PR attention", "attention", 900, prAttentionReasons(pr)));
  }
  for (const pr of person.testingPrs) {
    add(
      activityFromPullRequest(pr, "Testing handoff", "attention", 780, [
        ...prAttentionReasons(pr),
        pr.testingQueueAgeHours !== null ? "Testing queue aging" : "Testing flow active"
      ])
    );
  }
  for (const issue of person.needsTriageIssues) {
    add(activityFromIssue(issue, "Needs triage", "attention", 680));
  }
  for (const pr of person.pendingPrs) {
    add(activityFromPullRequest(pr, "Pending PR", "normal", 560, prAttentionReasons(pr)));
  }
  for (const issue of person.deferredIssues) {
    add(activityFromIssue(issue, "Deferred", "muted", 360));
  }
  for (const pr of person.prsCreatedYesterday) {
    add(activityFromPullRequest(pr, "Created yesterday", "muted", 260, prAttentionReasons(pr)));
  }
  for (const pr of person.prsMergedYesterday) {
    add(activityFromPullRequest(pr, "Merged yesterday", "muted", 240, prAttentionReasons(pr)));
  }

  return items.sort((left, right) => {
    const priorityDelta = right.priority - left.priority;
    if (priorityDelta !== 0) {
      return priorityDelta;
    }
    const ageDelta = right.ageHours - left.ageHours;
    if (ageDelta !== 0) {
      return ageDelta;
    }
    return left.number - right.number;
  });
}

function activityFromIssue(
  issue: CriticalIssueView | PersonalIssueView,
  phase: string,
  tone: PersonalActivityTone,
  priority: number
): PersonalActivityItem {
  const criticalIssue = isCriticalIssue(issue);
  const reasons = criticalIssue ? criticalIssueReasons(issue) : personalIssueReasons(issue);
  return {
    id: `issue:${issue.number}`,
    objectType: "issue",
    number: issue.number,
    title: issue.title,
    htmlUrl: issue.htmlUrl,
    phase,
    tone,
    priority,
    ageHours: issue.ageHours,
    lastHumanActionAt: criticalIssue ? issue.lastHumanActionAt : null,
    testingQueueAgeHours: null,
    severity: issue.severity,
    lifecycleState: issue.lifecycleState,
    reviewDecision: null,
    ciState: null,
    mergeStateStatus: null,
    testingState: null,
    linkedIssueNumbers: [],
    linkedPullRequestNumbers: criticalIssue ? issue.linkedPullRequests.map((pr) => pr.number) : [],
    reasons,
    isComplete: issue.isComplete
  };
}

function activityFromPullRequest(
  pr: PersonalPullRequestView,
  phase: string,
  tone: PersonalActivityTone,
  priority: number,
  reasons: string[]
): PersonalActivityItem {
  return {
    id: `pull_request:${pr.number}`,
    objectType: "pull_request",
    number: pr.number,
    title: pr.title,
    htmlUrl: pr.htmlUrl,
    phase,
    tone,
    priority,
    ageHours: pr.ageHours,
    lastHumanActionAt: pr.lastHumanActionAt,
    testingQueueAgeHours: pr.testingQueueAgeHours,
    severity: null,
    lifecycleState: null,
    reviewDecision: pr.reviewDecision,
    ciState: pr.ciState,
    mergeStateStatus: pr.mergeStateStatus,
    testingState: pr.testingState,
    linkedIssueNumbers: pr.linkedIssueNumbers,
    linkedPullRequestNumbers: [],
    reasons,
    isComplete: pr.isComplete
  };
}

function isCriticalIssue(issue: CriticalIssueView | PersonalIssueView): issue is CriticalIssueView {
  return "linkedPullRequests" in issue;
}

function severityPriority(severity: string | null): number {
  if (severity === "severity/s-1") {
    return 30;
  }
  if (severity === "severity/s0") {
    return 20;
  }
  return 0;
}

function isTestingQueuePullRequest(pr: FlowEfficiencyPullRequest): boolean {
  return (
    pr.testingQueueAgeHours !== null ||
    ["dev_done", "test_requested", "testing", "test_changes_requested"].includes(pr.testingState)
  );
}

function sumBy<T>(items: T[], value: (item: T) => number): number {
  return items.reduce((total, item) => total + value(item), 0);
}

function percentage(numerator: number, denominator: number): number | null {
  if (denominator === 0) {
    return null;
  }
  return Math.round((numerator / denominator) * 100);
}

function average(values: number[]): number | null {
  const finiteValues = values.filter((value) => Number.isFinite(value));
  if (finiteValues.length === 0) {
    return null;
  }
  const total = finiteValues.reduce((sum, value) => sum + value, 0);
  return Math.round((total / finiteValues.length) * 10) / 10;
}
