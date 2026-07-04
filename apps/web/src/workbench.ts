import type {
  CriticalIssueLinkedPullRequestView,
  CriticalIssueView,
  PersonSummary,
  PersonalActionView,
  PersonalIssueView,
  PersonalPullRequestView,
  TestingFlowState
} from "@mo-devflow/shared";

export type WorkloadStatus = "critical" | "attention" | "triage" | "active" | "clear";
export type PersonalActivityTone = "critical" | "attention" | "normal" | "muted";
export type PersonalActivityObjectType = "issue" | "pull_request";
export type PersonalDurationKind = "critical_active" | "issue_age" | "pr_age" | "unknown";

export interface PersonalActivityItem {
  id: string;
  objectType: PersonalActivityObjectType;
  number: number;
  title: string;
  htmlUrl: string;
  ownerLogin: string | null;
  phase: string;
  tone: PersonalActivityTone;
  priority: number;
  ageHours: number;
  durationHours: number | null;
  durationKind: PersonalDurationKind;
  durationEvidence: string;
  lastHumanActionAt: string | null;
  testingQueueAgeHours: number | null;
  severity: string | null;
  lifecycleState: string | null;
  reviewDecision: string | null;
  ciState: string | null;
  mergeStateStatus: string | null;
  testingState: TestingFlowState | null;
  linkedIssueNumbers: number[];
  linkedPullRequestNumbers: number[];
  reasons: string[];
  isComplete: boolean;
}

export type PersonalGanttTone = "critical" | "attention" | "normal" | "muted";
export type PersonalGanttRowKind = "issue" | "other_prs";

export interface PersonalGanttBarLayout {
  startAgeHours: number;
  endAgeHours: number;
  offsetPercent: number;
  widthPercent: number;
}

export interface PersonalGanttPrBar extends PersonalGanttBarLayout {
  number: number;
  title: string;
  htmlUrl: string;
  ownerLogin: string;
  state: "open" | "closed";
  tone: PersonalGanttTone;
  reviewDecision: string | null;
  mergeStateStatus: string | null;
  ciState: string | null;
  testingState: TestingFlowState;
  testingQueueAgeHours: number | null;
  attentionFlags: string[];
  linkedIssueNumbers: number[];
  reasons: string[];
  isShared: boolean;
  isComplete: boolean;
}

export interface PersonalGanttIssueBar extends PersonalGanttBarLayout {
  number: number | null;
  title: string;
  htmlUrl: string | null;
  tone: PersonalGanttTone;
  severity: string | null;
  lifecycleState: string | null;
  aiEffortLabel: string | null;
  durationHours: number | null;
  durationKind: PersonalDurationKind;
  durationEvidence: string;
  reasons: string[];
  isComplete: boolean;
}

export interface PersonalGanttRow {
  id: string;
  kind: PersonalGanttRowKind;
  title: string;
  priority: number;
  tone: PersonalGanttTone;
  issue: PersonalGanttIssueBar;
  prs: PersonalGanttPrBar[];
  linkedIssueNumbers: number[];
}

export interface PersonalGanttChart {
  rows: PersonalGanttRow[];
  maxAgeHours: number;
  sharedPrCount: number;
  unlinkedPrCount: number;
  outsideIssuePrCount: number;
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
    testingPrs > 0 ? `${testingPrs} linked to test issues` : null,
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
  testing_stalled: "Test wait over 24h",
  review_requested_no_response: "Review waiting"
};

const failedCiStates = new Set(["failure", "failed", "error", "timed_out", "action_required", "cancelled"]);

type PrAttentionReasonSource = Pick<
  PersonalPullRequestView,
  "attentionFlags" | "reviewDecision" | "ciState" | "mergeStateStatus" | "testingState"
>;

export function prAttentionReasons(pr: PrAttentionReasonSource): string[] {
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
    reasons.push("Test changes requested");
  }

  return [...new Set(reasons)];
}

export function criticalIssueReasons(issue: CriticalIssueView): string[] {
  const blockers = issue.blockers.filter((blocker) => blocker.severity !== "info").map((blocker) => blocker.message);
  const evidence = [
    issue.linkedPullRequests.length === 0 ? "No linked PR visible" : null,
    !issue.isComplete ? "Incomplete cache evidence" : null,
    effectiveAiEffortLabel(issue.aiEffortLabel)
  ].filter((reason): reason is string => reason !== null);

  return [...blockers, ...evidence];
}

export function personalIssueReasons(issue: PersonalIssueView): string[] {
  const reasons = [
    issue.lifecycleState === "needs-triage" ? "Waiting triage decision" : null,
    issue.lifecycleState === "deferred" ? "Deferred follow-up" : null,
    issue.severity ? issue.severity : null,
    !issue.isComplete ? "Incomplete cache evidence" : null
  ].filter((reason): reason is string => reason !== null);

  if (reasons.length > 0) {
    return reasons;
  }
  return issue.labels.slice(0, 3);
}

type GanttPullRequestSource = PersonalPullRequestView | CriticalIssueLinkedPullRequestView;

type PersonalGanttPrDraft = Omit<PersonalGanttPrBar, keyof PersonalGanttBarLayout> & {
  startAgeHours: number;
  endAgeHours: number;
};

type PersonalGanttIssueDraft = Omit<PersonalGanttIssueBar, keyof PersonalGanttBarLayout> & {
  startAgeHours: number;
  endAgeHours: number;
};

interface PersonalGanttRowDraft {
  id: string;
  kind: PersonalGanttRowKind;
  title: string;
  priority: number;
  tone: PersonalGanttTone;
  issue: PersonalGanttIssueDraft;
  prs: PersonalGanttPrDraft[];
  linkedIssueNumbers: number[];
}

export function personalGanttChart(
  person: PersonalActionView,
  nowIso: string = new Date().toISOString()
): PersonalGanttChart {
  const personalPrs = collectPersonalPullRequests(person);
  const visibleIssues = [...person.activeCriticalIssues, ...person.needsTriageIssues, ...person.deferredIssues];
  const visibleIssueNumbers = new Set(visibleIssues.map((issue) => issue.number));
  const prNumbersShownInIssueRows = new Set<number>();
  const drafts: PersonalGanttRowDraft[] = visibleIssues.map((issue) => {
    const criticalIssue = isCriticalIssue(issue);
    const relatedPrs = new Map<number, GanttPullRequestSource>();
    if (criticalIssue) {
      for (const pr of issue.linkedPullRequests) {
        relatedPrs.set(pr.number, personalPrs.get(pr.number) ?? pr);
      }
    }
    for (const pr of personalPrs.values()) {
      if (pr.linkedIssueNumbers.includes(issue.number)) {
        relatedPrs.set(pr.number, pr);
      }
    }
    const prs = Array.from(relatedPrs.values())
      .map((pr) => prDraft(pr, nowIso, isSharedPullRequest(pr)))
      .sort(sortGanttPrDrafts);
    for (const pr of prs) {
      prNumbersShownInIssueRows.add(pr.number);
    }

    return {
      id: `issue:${issue.number}`,
      kind: "issue",
      title: `Issue #${issue.number}`,
      priority: issuePriority(issue),
      tone: issueGanttTone(issue),
      issue: issueDraft(issue, nowIso),
      prs,
      linkedIssueNumbers: [issue.number]
    };
  });

  const otherPrs = Array.from(personalPrs.values())
    .filter((pr) => !prNumbersShownInIssueRows.has(pr.number))
    .map((pr) => prDraft(pr, nowIso, isSharedPullRequest(pr)))
    .sort(sortGanttPrDrafts);
  if (otherPrs.length > 0) {
    const maxOtherAge = Math.max(...otherPrs.map((pr) => pr.startAgeHours), 1);
    drafts.push({
      id: "other-prs",
      kind: "other_prs",
      title: "Other PR work",
      priority: 220,
      tone: otherPrs.some((pr) => pr.tone === "attention") ? "attention" : "normal",
      issue: {
        number: null,
        title: "PRs without a visible issue lane",
        htmlUrl: null,
        tone: otherPrs.some((pr) => pr.tone === "attention") ? "attention" : "normal",
        severity: null,
        lifecycleState: null,
        aiEffortLabel: null,
        durationHours: maxOtherAge,
        durationKind: "pr_age",
        durationEvidence: "Pull request created time",
        reasons: [`${otherPrs.length} PRs`],
        isComplete: otherPrs.every((pr) => pr.isComplete),
        startAgeHours: maxOtherAge,
        endAgeHours: 0
      },
      prs: otherPrs,
      linkedIssueNumbers: Array.from(new Set(otherPrs.flatMap((pr) => pr.linkedIssueNumbers))).sort(
        (left, right) => left - right
      )
    });
  }

  const maxAgeHours = Math.max(
    24,
    ...drafts.map((row) => row.issue.startAgeHours),
    ...drafts.flatMap((row) => row.prs.map((pr) => pr.startAgeHours))
  );

  const rows = drafts
    .sort((left, right) => right.priority - left.priority || right.issue.startAgeHours - left.issue.startAgeHours)
    .map((row) => ({
      ...row,
      issue: withLayout(row.issue, maxAgeHours),
      prs: row.prs.map((pr) => withLayout(pr, maxAgeHours))
    }));
  const uniquePrs = Array.from(personalPrs.values());

  return {
    rows,
    maxAgeHours,
    sharedPrCount: uniquePrs.filter(isSharedPullRequest).length,
    unlinkedPrCount: uniquePrs.filter((pr) => pr.linkedIssueNumbers.length === 0).length,
    outsideIssuePrCount: uniquePrs.filter(
      (pr) =>
        pr.linkedIssueNumbers.length > 0 && pr.linkedIssueNumbers.every((number) => !visibleIssueNumbers.has(number))
    ).length
  };
}

function collectPersonalPullRequests(person: PersonalActionView): Map<number, PersonalPullRequestView> {
  const prs = new Map<number, PersonalPullRequestView>();
  const add = (pr: PersonalPullRequestView): void => {
    const existing = prs.get(pr.number);
    prs.set(pr.number, existing ? mergePersonalPullRequest(existing, pr) : pr);
  };

  for (const pr of person.pendingPrs) {
    add(pr);
  }
  for (const pr of person.attentionPrs) {
    add(pr);
  }
  for (const pr of person.testingPrs) {
    add(pr);
  }
  for (const pr of person.prsCreatedYesterday) {
    add(pr);
  }
  for (const pr of person.prsMergedYesterday) {
    add(pr);
  }

  return prs;
}

function mergePersonalPullRequest(
  left: PersonalPullRequestView,
  right: PersonalPullRequestView
): PersonalPullRequestView {
  return {
    ...left,
    ...right,
    reviewDecision: right.reviewDecision ?? left.reviewDecision,
    mergeStateStatus: right.mergeStateStatus ?? left.mergeStateStatus,
    ciState: right.ciState ?? left.ciState,
    latestReviewState: right.latestReviewState ?? left.latestReviewState,
    latestReviewSubmittedAt: right.latestReviewSubmittedAt ?? left.latestReviewSubmittedAt,
    latestCommitAt: right.latestCommitAt ?? left.latestCommitAt,
    detailSyncedAt: right.detailSyncedAt ?? left.detailSyncedAt,
    detailError: right.detailError ?? left.detailError,
    testingQueueAgeHours: right.testingQueueAgeHours ?? left.testingQueueAgeHours,
    attentionFlags: uniqueStrings([...left.attentionFlags, ...right.attentionFlags]),
    linkedIssueNumbers: uniqueNumbers([...left.linkedIssueNumbers, ...right.linkedIssueNumbers]),
    testingTesters: uniqueStrings([...left.testingTesters, ...right.testingTesters]),
    testingSignals: uniqueStrings([...left.testingSignals, ...right.testingSignals]),
    isComplete: left.isComplete && right.isComplete
  };
}

function issueDraft(issue: CriticalIssueView | PersonalIssueView, nowIso: string): PersonalGanttIssueDraft {
  const criticalIssue = isCriticalIssue(issue);
  const duration = issueDuration(issue);
  return {
    number: issue.number,
    title: issue.title,
    htmlUrl: issue.htmlUrl,
    tone: issueGanttTone(issue),
    severity: issue.severity,
    lifecycleState: issue.lifecycleState,
    aiEffortLabel: criticalIssue ? effectiveAiEffortLabel(issue.aiEffortLabel) : null,
    durationHours: duration.hours,
    durationKind: duration.kind,
    durationEvidence: duration.evidence,
    reasons: criticalIssue ? criticalIssueReasons(issue) : personalIssueReasons(issue),
    isComplete: issue.isComplete,
    startAgeHours: Math.max(duration.hours ?? 0, 0),
    endAgeHours: 0
  };
}

function prDraft(pr: GanttPullRequestSource, nowIso: string, isShared: boolean): PersonalGanttPrDraft {
  const reasons = prReasons(pr);
  return {
    number: pr.number,
    title: pr.title,
    htmlUrl: pr.htmlUrl,
    ownerLogin: pr.ownerLogin,
    state: pr.state,
    tone: prGanttTone(pr, reasons),
    reviewDecision: pr.reviewDecision,
    mergeStateStatus: pr.mergeStateStatus,
    ciState: pr.ciState,
    testingState: pr.testingState,
    testingQueueAgeHours: pr.testingQueueAgeHours,
    attentionFlags: pr.attentionFlags,
    linkedIssueNumbers: pr.linkedIssueNumbers,
    reasons,
    isShared,
    isComplete: pr.isComplete,
    startAgeHours: prStartAgeHours(pr, nowIso),
    endAgeHours: prEndAgeHours(pr, nowIso)
  };
}

function issuePriority(issue: CriticalIssueView | PersonalIssueView): number {
  if (isCriticalIssue(issue)) {
    return 1_000 + severityPriority(issue.severity);
  }
  if (issue.lifecycleState === "needs-triage") {
    return 660;
  }
  if (issue.lifecycleState === "deferred") {
    return 360;
  }
  return 500;
}

function issueGanttTone(issue: CriticalIssueView | PersonalIssueView): PersonalGanttTone {
  if (isCriticalIssue(issue)) {
    return "critical";
  }
  if (issue.lifecycleState === "needs-triage") {
    return "attention";
  }
  if (issue.lifecycleState === "deferred") {
    return "muted";
  }
  return "normal";
}

function prGanttTone(pr: GanttPullRequestSource, reasons: string[]): PersonalGanttTone {
  if (reasons.length > 0) {
    return "attention";
  }
  if (pr.state === "closed") {
    return "muted";
  }
  return "normal";
}

function prReasons(pr: GanttPullRequestSource): string[] {
  const reasons = pr.attentionFlags.map((flag) => attentionFlagLabels[flag] ?? flag.replaceAll("_", " "));
  if (pr.reviewDecision === "changes_requested") {
    reasons.push(attentionFlagLabels.requested_changes);
  }
  if (pr.ciState && failedCiStates.has(pr.ciState)) {
    reasons.push(attentionFlagLabels.ci_failed);
  }
  if (pr.mergeStateStatus === "dirty") {
    reasons.push(attentionFlagLabels.merge_conflict);
  }
  if (pr.testingState === "test_changes_requested") {
    reasons.push("Test changes requested");
  }
  if (pr.testingQueueAgeHours !== null && pr.testingQueueAgeHours >= 24) {
    reasons.push("Test wait over 24h");
  }
  return uniqueStrings(reasons);
}

function prStartAgeHours(pr: GanttPullRequestSource, nowIso: string): number {
  if ("createdAt" in pr) {
    return hoursBetween(pr.createdAt, nowIso) ?? Math.max(pr.ageHours, 0);
  }
  return Math.max(pr.ageHours, 0);
}

function prEndAgeHours(pr: GanttPullRequestSource, nowIso: string): number {
  if ("mergedAt" in pr && pr.mergedAt) {
    return hoursBetween(pr.mergedAt, nowIso) ?? 0;
  }
  return 0;
}

function hoursBetween(startIso: string, endIso: string): number | null {
  const start = Date.parse(startIso);
  const end = Date.parse(endIso);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    return null;
  }
  return Math.round(((end - start) / 3_600_000) * 10) / 10;
}

function withLayout<T extends { startAgeHours: number; endAgeHours: number }>(
  draft: T,
  maxAgeHours: number
): T & PersonalGanttBarLayout {
  const startAgeHours = clamp(draft.startAgeHours, 0, maxAgeHours);
  const endAgeHours = clamp(Math.min(draft.endAgeHours, startAgeHours), 0, maxAgeHours);
  const offsetPercent = ((maxAgeHours - startAgeHours) / maxAgeHours) * 100;
  const widthPercent = Math.max(1.8, ((startAgeHours - endAgeHours) / maxAgeHours) * 100);
  return {
    ...draft,
    startAgeHours,
    endAgeHours,
    offsetPercent: Math.round(offsetPercent * 10) / 10,
    widthPercent: Math.round(widthPercent * 10) / 10
  };
}

function sortGanttPrDrafts(left: PersonalGanttPrDraft, right: PersonalGanttPrDraft): number {
  const toneDelta = ganttToneRank(right.tone) - ganttToneRank(left.tone);
  if (toneDelta !== 0) {
    return toneDelta;
  }
  return right.startAgeHours - left.startAgeHours || left.number - right.number;
}

function ganttToneRank(tone: PersonalGanttTone): number {
  if (tone === "critical") {
    return 4;
  }
  if (tone === "attention") {
    return 3;
  }
  if (tone === "normal") {
    return 2;
  }
  return 1;
}

function isSharedPullRequest(pr: GanttPullRequestSource): boolean {
  return uniqueNumbers(pr.linkedIssueNumbers).length > 1;
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter((value) => value.length > 0)));
}

function uniqueNumbers(values: number[]): number[] {
  return Array.from(new Set(values)).sort((left, right) => left - right);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
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
      activityFromPullRequest(pr, "Linked issue in test", "attention", 780, [
        ...prAttentionReasons(pr),
        pr.testingQueueAgeHours !== null ? "Test wait visible" : "Issue test status visible"
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

export function personalActivityNextAction(item: PersonalActivityItem): string {
  if (item.objectType === "issue") {
    if (item.lifecycleState === "needs-triage") {
      return "Decide s-1/s0 or defer";
    }
    if (item.lifecycleState === "deferred") {
      return "Check defer reason";
    }
    if (item.tone === "critical" && item.linkedPullRequestNumbers.length === 0) {
      return "Link an execution PR";
    }
    if (item.tone === "critical") {
      return "Drive linked PRs";
    }
    return "Review issue state";
  }

  const reasons = item.reasons.map((reason) => reason.toLowerCase());
  if (reasons.some((reason) => reason.includes("ci failed"))) {
    return "Fix failing CI";
  }
  if (reasons.some((reason) => reason.includes("changes requested"))) {
    return "Address requested changes";
  }
  if (reasons.some((reason) => reason.includes("merge conflict"))) {
    return "Resolve merge conflict";
  }
  if (item.testingState === "test_changes_requested") {
    return "Respond to test feedback";
  }
  if (
    item.testingQueueAgeHours !== null ||
    ["dev_done", "test_requested", "testing"].includes(item.testingState ?? "")
  ) {
    return "Get test result";
  }
  if (reasons.some((reason) => reason.includes("review waiting"))) {
    return "Request review response";
  }
  if (reasons.some((reason) => reason.includes("no human action"))) {
    return "Refresh owner action";
  }
  if (item.phase === "Merged yesterday") {
    return "Verify linked issue closure";
  }
  if (item.phase === "Created yesterday") {
    return "Confirm review path";
  }
  return "Keep PR moving";
}

export function personalActivityPrimarySignal(item: PersonalActivityItem): string {
  if (item.reasons.length > 0) {
    return item.reasons[0];
  }
  if (item.linkedIssueNumbers.length > 0) {
    return `${item.linkedIssueNumbers.length} linked issue${item.linkedIssueNumbers.length === 1 ? "" : "s"}`;
  }
  if (item.linkedPullRequestNumbers.length > 0) {
    return `${item.linkedPullRequestNumbers.length} linked PR${item.linkedPullRequestNumbers.length === 1 ? "" : "s"}`;
  }
  return item.phase;
}

export function personalDurationText(input: {
  durationHours: number | null;
  durationKind: PersonalDurationKind;
}): string {
  if (input.durationHours === null) {
    return input.durationKind === "critical_active" ? "s0/s-1 unknown" : "unknown";
  }
  if (input.durationKind === "critical_active") {
    return `s0/s-1 ${durationHoursText(input.durationHours)}`;
  }
  if (input.durationKind === "pr_age") {
    return `PR ${durationHoursText(input.durationHours)}`;
  }
  return `issue ${durationHoursText(input.durationHours)}`;
}

export function flowThreadNextAction(row: PersonalGanttRow): string {
  const prReasons = row.prs.flatMap((pr) => pr.reasons.map((reason) => reason.toLowerCase()));
  if (row.issue.lifecycleState === "needs-triage") {
    return "Decide s-1/s0 or defer";
  }
  if (row.issue.lifecycleState === "deferred") {
    return "Check defer reason";
  }
  if (row.kind === "issue" && row.prs.length === 0) {
    return "Link an execution PR";
  }
  if (prReasons.some((reason) => reason.includes("ci failed"))) {
    return "Fix failing CI";
  }
  if (prReasons.some((reason) => reason.includes("changes requested"))) {
    return "Address requested changes";
  }
  if (prReasons.some((reason) => reason.includes("merge conflict"))) {
    return "Resolve merge conflict";
  }
  if (row.prs.some((pr) => pr.testingQueueAgeHours !== null || pr.testingState !== "not_ready")) {
    return "Get test result";
  }
  if (row.prs.length > 0) {
    return "Move PR toward merge";
  }
  return "Monitor";
}

export function flowThreadDurationWarnings(row: PersonalGanttRow): string[] {
  const warnings: string[] = [];
  if (row.issue.durationKind === "critical_active" && row.issue.durationHours === null) {
    warnings.push("missing severity timeline");
  }
  if (row.issue.aiEffortLabel === "ai-easy" && (row.issue.durationHours ?? 0) >= 168) {
    warnings.push("ai-easy over 7d");
  }
  if (row.issue.tone === "critical" && (row.issue.durationHours ?? 0) >= 72) {
    warnings.push("critical over 3d");
  }
  if (row.prs.some((pr) => pr.startAgeHours >= 24 && pr.attentionFlags.includes("no_human_action_24h"))) {
    warnings.push("PR idle over 24h");
  }
  if (row.prs.some((pr) => pr.testingQueueAgeHours !== null && pr.testingQueueAgeHours >= 24)) {
    warnings.push("test wait over 24h");
  }
  if (row.prs.some((pr) => pr.linkedIssueNumbers.length === 0)) {
    warnings.push("unlinked PR");
  }
  return uniqueStrings(warnings);
}

function activityFromIssue(
  issue: CriticalIssueView | PersonalIssueView,
  phase: string,
  tone: PersonalActivityTone,
  priority: number
): PersonalActivityItem {
  const criticalIssue = isCriticalIssue(issue);
  const reasons = criticalIssue ? criticalIssueReasons(issue) : personalIssueReasons(issue);
  const duration = issueDuration(issue);
  return {
    id: `issue:${issue.number}`,
    objectType: "issue",
    number: issue.number,
    title: issue.title,
    htmlUrl: issue.htmlUrl,
    ownerLogin: criticalIssue ? issue.ownerLogin : null,
    phase,
    tone,
    priority,
    ageHours: issue.ageHours,
    durationHours: duration.hours,
    durationKind: duration.kind,
    durationEvidence: duration.evidence,
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
    ownerLogin: pr.ownerLogin,
    phase,
    tone,
    priority,
    ageHours: pr.ageHours,
    durationHours: pr.ageHours,
    durationKind: "pr_age",
    durationEvidence: "pull_request_created_at",
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

function issueDuration(issue: CriticalIssueView | PersonalIssueView): {
  hours: number | null;
  kind: PersonalDurationKind;
  evidence: string;
} {
  if (isCriticalIssue(issue)) {
    return {
      hours: issue.criticalAgeHours,
      kind: "critical_active",
      evidence:
        issue.criticalAgeEvidence === "issue_timeline_event"
          ? "GitHub issue label event"
          : "Missing severity timeline evidence"
    };
  }
  return {
    hours: issue.ageHours,
    kind: "issue_age",
    evidence: "Issue created time"
  };
}

function durationHoursText(value: number): string {
  if (value < 24) {
    return `${value.toFixed(value % 1 === 0 ? 0 : 1)}h`;
  }
  return `${(value / 24).toFixed(1)}d`;
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
