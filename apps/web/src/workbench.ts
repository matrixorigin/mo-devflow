import type {
  CriticalIssueLinkedPullRequestView,
  CriticalIssueView,
  DailyMetricPoint,
  DashboardSummary,
  NotificationDeliveryView,
  PendingPrView,
  PersonSummary,
  PersonalActionView,
  PersonalIssueView,
  PersonalPullRequestView,
  TestingSummary,
  TestingIssueQueueView,
  TestingFlowState
} from "@mo-devflow/shared";

export type WorkloadStatus = "critical" | "attention" | "triage" | "active" | "clear";
export type PersonalActivityTone = "critical" | "attention" | "normal" | "muted";
export type PersonalActivityObjectType = "issue" | "pull_request";
export type PersonalDurationKind = "critical_active" | "issue_age" | "pr_age" | "testing_queue" | "unknown";
export type PersonalActionQueueFilter =
  "all" | "critical" | "pr_blockers" | "issues" | "testing" | "prs" | "needs_link";

export interface PersonalActivityItem {
  id: string;
  objectType: PersonalActivityObjectType;
  number: number;
  title: string;
  htmlUrl: string;
  ownerLogin: string | null;
  ownerScope: CriticalIssueView["ownerScope"] | null;
  ownerReason: CriticalIssueView["ownerReason"] | null;
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

export type PersonalActionQueueCounts = Record<PersonalActionQueueFilter, number>;
export type PersonalOperatingSignalKey = "active_issues" | "pr_blockers" | "testing" | "triage" | "pending_pr";
export type PersonalOperatingSignalTone = "critical" | "attention" | "normal" | "good";
export type PersonalOperatingSignalTarget = "active_issues" | "pr_attention" | "testing" | "triage" | "pending_pr";

export interface PersonalOperatingSignal {
  key: PersonalOperatingSignalKey;
  label: string;
  value: number;
  detail: string;
  tone: PersonalOperatingSignalTone;
  target: PersonalOperatingSignalTarget;
  priority: number;
}

export type PersonalDailyPlanStage = "Do now" | "Next" | "Watch";

export interface PersonalDailyPlanItem {
  key: string;
  stage: PersonalDailyPlanStage;
  label: string;
  value: number;
  detail: string;
  tone: PersonalOperatingSignalTone;
  target: PersonalOperatingSignalTarget;
  priority: number;
}

export interface PersonalCommandSummary {
  title: string;
  detail: string;
  tone: PersonalOperatingSignalTone;
  target: PersonalOperatingSignalTarget;
  actionLabel: string;
}

export type PeopleScopeFilter =
  "all" | "critical" | "attention" | "triage" | "deferred" | "pending_pr" | "testing" | "yesterday_pr";
export type PeopleBoardSort =
  "workload" | "active" | "pr_age" | "pr_attention" | "pr_throughput" | "flow_gap" | "triage" | "testing_wait" | "name";

export const peopleScopeFilters: PeopleScopeFilter[] = [
  "all",
  "critical",
  "attention",
  "triage",
  "deferred",
  "pending_pr",
  "testing",
  "yesterday_pr"
];

export type PeopleBoardScopeCounts = Record<PeopleScopeFilter, number>;
export interface TeamPeopleFocusSummary {
  people: number;
  riskPeople: number;
  activeIssuePeople: number;
  prAttentionPeople: number;
  testingPeople: number;
  triagePeople: number;
}

export type PeopleAttentionQueueTone = "critical" | "attention" | "normal";

export interface PeopleAttentionQueueItem {
  login: string;
  label: string;
  value: number;
  detail: string;
  target: PersonalOperatingSignalTarget;
  tone: PeopleAttentionQueueTone;
  priority: number;
}

export interface TeamTriageSnapshot {
  needsTriageIssues: number;
  deferredIssues: number;
  peopleWithNeedsTriage: number;
  peopleWithDeferred: number;
}
export type TeamOperatingSignalKey = "issue_flow" | "pr_flow" | "testing_flow" | "data_trust";
export type TeamOperatingSignalTone = "critical" | "attention" | "good";
export type TeamOperatingSignalTarget =
  | "critical_issues"
  | "critical_no_action"
  | "critical_without_pr"
  | "pr_attention"
  | "all_prs"
  | "testing_stale"
  | "testing"
  | "webhooks"
  | "health"
  | "triage";
export interface TeamOperatingSignal {
  key: TeamOperatingSignalKey;
  label: string;
  value: number;
  detail: string;
  tone: TeamOperatingSignalTone;
  target: TeamOperatingSignalTarget;
}
export type TeamCommandSignalTarget = "violations" | "drift" | "notifications";
export type TeamCommandSignalTone = "critical" | "attention" | "normal";
export type NotificationDeliveryScopeFilter = "all" | "attention" | "failed" | "ack_pending" | "digest";
export type TestingTesterSort = "attention" | "queue" | "wait" | "handoff" | "login";

export interface TeamCommandSignal {
  key: string;
  title: string;
  detail: string;
  tone: TeamCommandSignalTone;
  target: TeamCommandSignalTarget;
  priority: number;
}

export interface TrendEvidenceSummary {
  totalPoints: number;
  partialPoints: number;
  latestGeneratedAt: string | null;
  evidenceLabel: string;
  message: string;
}

export type TrendMomentumKey =
  "issue_drain" | "pr_open_delta" | "active_critical" | "pr_attention" | "testing_queue" | "triage";

export interface TrendMomentumItem {
  key: TrendMomentumKey;
  label: string;
  value: number | null;
  previousValue: number | null;
  delta: number | null;
  detail: string;
  tone: "critical" | "attention" | "normal" | "good";
  target: FlowEfficiencyDiagnosticTarget;
}

export interface TrendMomentumSummary {
  latestLabel: string | null;
  previousLabel: string | null;
  items: TrendMomentumItem[];
}

export function trendEvidenceSummary(
  points: ReadonlyArray<Pick<DailyMetricPoint, "sourceCompleteness" | "generatedAt">>
): TrendEvidenceSummary {
  const partialPoints = points.filter((point) => point.sourceCompleteness === "partial_cache").length;
  const latestGeneratedAt = points.reduce<string | null>((latest, point) => {
    if (!latest) {
      return point.generatedAt;
    }
    return new Date(point.generatedAt).getTime() > new Date(latest).getTime() ? point.generatedAt : latest;
  }, null);
  return {
    totalPoints: points.length,
    partialPoints,
    latestGeneratedAt,
    evidenceLabel: partialPoints > 0 ? `${partialPoints}/${points.length} partial` : "complete points",
    message:
      partialPoints > 0
        ? "Trend lines include partial cache points; use them for direction, not final historical accounting."
        : "Every visible trend point is marked complete in the local cache."
  };
}

type TrendMomentumPoint = Pick<
  DailyMetricPoint,
  | "date"
  | "prsCreated"
  | "prsMerged"
  | "issuesOpened"
  | "issuesClosed"
  | "issuesDeferred"
  | "activeCriticalIssues"
  | "averageActiveCriticalIssueAgeHours"
  | "needsTriageIssues"
  | "deferredIssues"
  | "pendingPrs"
  | "attentionPrs"
  | "testingQueueIssues"
  | "averageTestingQueueAgeHours"
  | "generatedAt"
> & { label?: string };

function trendMomentumPointLabel(point: TrendMomentumPoint): string {
  return point.label ?? point.date;
}

function trendMomentumPointTime(point: TrendMomentumPoint): number {
  const dateTime = Date.parse(point.date);
  if (Number.isFinite(dateTime)) {
    return dateTime;
  }
  const generatedTime = Date.parse(point.generatedAt);
  return Number.isFinite(generatedTime) ? generatedTime : 0;
}

function nullableDelta(value: number | null, previousValue: number | null): number | null {
  return value === null || previousValue === null ? null : value - previousValue;
}

function maybeHoursDetail(label: string, value: number | null): string {
  return value === null ? `${label} unknown` : `${label} ${value}h`;
}

function signedHours(value: number): string {
  return value > 0 ? `+${value}h` : `${value}h`;
}

function lowerIsBetterTone(value: number | null, delta: number | null): TrendMomentumItem["tone"] {
  if ((value ?? 0) <= 0) {
    return "good";
  }
  return delta !== null && delta > 0 ? "attention" : "normal";
}

function trendMomentumItem(input: {
  key: TrendMomentumKey;
  label: string;
  value: number | null;
  previousValue: number | null;
  detail: string;
  target: FlowEfficiencyDiagnosticTarget;
  tone: TrendMomentumItem["tone"];
}): TrendMomentumItem {
  return {
    ...input,
    delta: nullableDelta(input.value, input.previousValue)
  };
}

export function trendMomentumSummary(points: ReadonlyArray<TrendMomentumPoint>): TrendMomentumSummary {
  const sortedPoints = [...points].sort(
    (left, right) =>
      trendMomentumPointTime(left) - trendMomentumPointTime(right) ||
      Date.parse(left.generatedAt) - Date.parse(right.generatedAt)
  );
  const latest = sortedPoints.at(-1) ?? null;
  const previous = sortedPoints.at(-2) ?? null;
  if (!latest) {
    return { latestLabel: null, previousLabel: null, items: [] };
  }

  const latestIssueDrain = latest.issuesClosed + latest.issuesDeferred - latest.issuesOpened;
  const previousIssueDrain = previous ? previous.issuesClosed + previous.issuesDeferred - previous.issuesOpened : null;
  const latestPrOpenDelta = latest.prsCreated - latest.prsMerged;
  const previousPrOpenDelta = previous ? previous.prsCreated - previous.prsMerged : null;
  const activeCriticalDelta = nullableDelta(latest.activeCriticalIssues, previous?.activeCriticalIssues ?? null);
  const prAttentionDelta = nullableDelta(latest.attentionPrs, previous?.attentionPrs ?? null);
  const testingQueueDelta = nullableDelta(latest.testingQueueIssues, previous?.testingQueueIssues ?? null);
  const triageDelta = nullableDelta(latest.needsTriageIssues, previous?.needsTriageIssues ?? null);
  const testingWaitDelta = nullableDelta(
    latest.averageTestingQueueAgeHours,
    previous?.averageTestingQueueAgeHours ?? null
  );
  const activeCriticalTone =
    latest.activeCriticalIssues > 0 && activeCriticalDelta !== null && activeCriticalDelta > 0
      ? "critical"
      : lowerIsBetterTone(latest.activeCriticalIssues, activeCriticalDelta);
  const prAttentionTone =
    latest.attentionPrs > 0 && prAttentionDelta !== null && prAttentionDelta > 0
      ? "critical"
      : lowerIsBetterTone(latest.attentionPrs, prAttentionDelta);
  const testingTone =
    latest.averageTestingQueueAgeHours !== null && latest.averageTestingQueueAgeHours >= 24
      ? "critical"
      : lowerIsBetterTone(latest.testingQueueIssues, testingQueueDelta);

  return {
    latestLabel: trendMomentumPointLabel(latest),
    previousLabel: previous ? trendMomentumPointLabel(previous) : null,
    items: [
      trendMomentumItem({
        key: "issue_drain",
        label: "Issue drain",
        value: latestIssueDrain,
        previousValue: previousIssueDrain,
        detail: `${latest.issuesClosed + latest.issuesDeferred} resolved / ${latest.issuesOpened} opened`,
        target: "issue_drain",
        tone: latestIssueDrain < 0 ? "attention" : "good"
      }),
      trendMomentumItem({
        key: "pr_open_delta",
        label: "PR open delta",
        value: latestPrOpenDelta,
        previousValue: previousPrOpenDelta,
        detail: `${latest.prsCreated} created / ${latest.prsMerged} merged`,
        target: "pr_flow",
        tone: latestPrOpenDelta > 0 ? "attention" : "good"
      }),
      trendMomentumItem({
        key: "active_critical",
        label: "Active s-1/s0",
        value: latest.activeCriticalIssues,
        previousValue: previous?.activeCriticalIssues ?? null,
        detail: maybeHoursDetail("avg active", latest.averageActiveCriticalIssueAgeHours),
        target: "active_critical_age",
        tone: activeCriticalTone
      }),
      trendMomentumItem({
        key: "pr_attention",
        label: "PR attention",
        value: latest.attentionPrs,
        previousValue: previous?.attentionPrs ?? null,
        detail: `${latest.attentionPrs}/${latest.pendingPrs} pending`,
        target: "pr_attention",
        tone: prAttentionTone
      }),
      trendMomentumItem({
        key: "testing_queue",
        label: "Issue testing",
        value: latest.testingQueueIssues,
        previousValue: previous?.testingQueueIssues ?? null,
        detail: `${maybeHoursDetail("avg wait", latest.averageTestingQueueAgeHours)}${
          testingWaitDelta !== null ? `, wait delta ${signedHours(testingWaitDelta)}` : ""
        }`,
        target: "testing_queue",
        tone: testingTone
      }),
      trendMomentumItem({
        key: "triage",
        label: "Needs triage",
        value: latest.needsTriageIssues,
        previousValue: previous?.needsTriageIssues ?? null,
        detail: `${latest.deferredIssues} deferred`,
        target: "triage_flow",
        tone: lowerIsBetterTone(latest.needsTriageIssues, triageDelta)
      })
    ]
  };
}

export function teamCommandSignals(input: {
  counts: Pick<
    DashboardSummary["counts"],
    "workflowViolations" | "criticalWorkflowViolations" | "aiDriftSignals" | "criticalAiDriftSignals"
  >;
  notifications: {
    failedDeliveries: number;
    unacknowledgedDeliveries: number;
    escalationPendingDeliveries: number;
    readinessStatus: DashboardSummary["notifications"]["readiness"]["status"];
  };
}): TeamCommandSignal[] {
  const signals: TeamCommandSignal[] = [];
  const { counts, notifications } = input;

  if (counts.criticalWorkflowViolations > 0) {
    signals.push({
      key: "workflow-critical",
      title: `${counts.criticalWorkflowViolations} critical workflow violations need fix`,
      detail: `${counts.workflowViolations} total violations; fix triage, severity, deferred, and AI label breaks first`,
      tone: "critical",
      target: "violations",
      priority: 880 + counts.criticalWorkflowViolations
    });
  } else if (counts.workflowViolations > 0) {
    signals.push({
      key: "workflow-violations",
      title: `${counts.workflowViolations} workflow violations need review`,
      detail: "inspect triage, deferred explanation, severity, and AI effort rule breaks",
      tone: "attention",
      target: "violations",
      priority: 620 + counts.workflowViolations
    });
  }

  if (counts.criticalAiDriftSignals > 0) {
    signals.push({
      key: "ai-drift-critical",
      title: `${counts.criticalAiDriftSignals} AI effort estimates look wrong`,
      detail: `${counts.aiDriftSignals} drift signals; inspect long ai-easy work and blocker-heavy PRs`,
      tone: "critical",
      target: "drift",
      priority: 850 + counts.criticalAiDriftSignals
    });
  } else if (counts.aiDriftSignals > 0) {
    signals.push({
      key: "ai-drift",
      title: `${counts.aiDriftSignals} AI effort drift signals need review`,
      detail: "compare ai-xxx labels with actual issue, PR, blocker, and testing duration",
      tone: "attention",
      target: "drift",
      priority: 610 + counts.aiDriftSignals
    });
  }

  if (notifications.failedDeliveries > 0) {
    signals.push({
      key: "notification-failures",
      title: `${notifications.failedDeliveries} notification deliveries failed`,
      detail: `${notifications.unacknowledgedDeliveries} unacknowledged; repair channel or retry delivery from Notifications`,
      tone: "critical",
      target: "notifications",
      priority: 820 + notifications.failedDeliveries
    });
  }

  if (notifications.escalationPendingDeliveries > 0) {
    signals.push({
      key: "notification-escalations",
      title: `${notifications.escalationPendingDeliveries} notifications need escalation`,
      detail: `${notifications.unacknowledgedDeliveries} attention notifications remain unacknowledged`,
      tone: "attention",
      target: "notifications",
      priority: 790 + notifications.escalationPendingDeliveries
    });
  } else if (notifications.unacknowledgedDeliveries > 0) {
    signals.push({
      key: "notification-ack",
      title: `${notifications.unacknowledgedDeliveries} notifications await acknowledgement`,
      detail: "open Notifications to see which attention items already reached responsible employees",
      tone: "normal",
      target: "notifications",
      priority: 730 + notifications.unacknowledgedDeliveries
    });
  }

  if (notifications.readinessStatus === "action_required" || notifications.readinessStatus === "degraded") {
    signals.push({
      key: "notification-readiness",
      title: "Notification channel needs setup",
      detail: `readiness is ${notifications.readinessStatus.replaceAll("_", " ")}; verify webhook, employee mappings, and fallback routing`,
      tone: notifications.readinessStatus === "action_required" ? "critical" : "attention",
      target: "notifications",
      priority: notifications.readinessStatus === "action_required" ? 805 : 650
    });
  }

  return signals.sort((left, right) => right.priority - left.priority);
}

export function notificationDeliveryMatchesScope(
  delivery: NotificationDeliveryView,
  filter: NotificationDeliveryScopeFilter
): boolean {
  if (filter === "all") {
    return true;
  }
  if (filter === "failed") {
    return delivery.sourceActive && (delivery.status === "failed_transient" || delivery.status === "failed_permanent");
  }
  if (filter === "ack_pending") {
    return delivery.sourceActive && delivery.status === "sent" && !delivery.acknowledgedAt;
  }
  if (filter === "digest") {
    return (
      delivery.sourceType === "daily_digest" ||
      delivery.sourceType === "weekly_digest" ||
      delivery.sourceType === "monthly_digest"
    );
  }
  return (
    delivery.sourceActive &&
    !notificationDeliveryMatchesScope(delivery, "digest") &&
    (notificationDeliveryMatchesScope(delivery, "failed") ||
      notificationDeliveryMatchesScope(delivery, "ack_pending") ||
      delivery.status === "retry_requested" ||
      delivery.status === "skipped_no_webhook" ||
      delivery.status === "skipped_quiet_hours")
  );
}

export function notificationDeliveryScopeCounts(
  deliveries: NotificationDeliveryView[]
): Record<NotificationDeliveryScopeFilter, number> {
  return {
    all: deliveries.length,
    attention: deliveries.filter((delivery) => notificationDeliveryMatchesScope(delivery, "attention")).length,
    failed: deliveries.filter((delivery) => notificationDeliveryMatchesScope(delivery, "failed")).length,
    ack_pending: deliveries.filter((delivery) => notificationDeliveryMatchesScope(delivery, "ack_pending")).length,
    digest: deliveries.filter((delivery) => notificationDeliveryMatchesScope(delivery, "digest")).length
  };
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

export interface PrQualityMetricPoint {
  pendingPrs: number;
  ciFailedPrs: number;
  requestedChangePrs: number;
  reviewWaitingPrs: number;
  mergeConflictPrs: number;
}

export interface PrQualityRiskSummary {
  pendingPrs: number;
  qualitySignalTotal: number;
  qualitySignalRatePercent: number | null;
  ciFailedPrs: number;
  ciFailureRatePercent: number | null;
  requestedChangePrs: number;
  requestedChangeRatePercent: number | null;
  reviewWaitingPrs: number;
  reviewWaitingRatePercent: number | null;
  mergeConflictPrs: number;
  mergeConflictRatePercent: number | null;
  tone: "critical" | "attention" | "normal" | "good";
}

export interface FlowEfficiencyPullRequest {
  ageHours: number;
  attentionFlags: string[];
  testingState: string;
  testingQueueAgeHours: number | null;
}

export interface FlowEfficiencyIssue {
  ageHours: number;
  criticalAgeHours?: number | null;
}

export interface PrCriticalIssueContext {
  number: number;
  title: string;
  htmlUrl: string;
  severity: string | null;
  ownerLogin: string | null;
  ownerScope: CriticalIssueView["ownerScope"];
  ownerReason: CriticalIssueView["ownerReason"];
  aiEffortLabel: string;
  criticalAgeHours: number | null;
  criticalAgeEvidence: CriticalIssueView["criticalAgeEvidence"];
  blockerCount: number;
  isComplete: boolean;
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
  needsTriageIssues: number;
  deferredIssues: number;
  testingQueueIssues: number;
  testingQueuePrs: number;
  averageTestingQueueAgeHours: number | null;
}

export type FlowEfficiencyDiagnosticTarget =
  | "pr_flow"
  | "issue_drain"
  | "pending_pr_age"
  | "pr_attention"
  | "active_critical_age"
  | "triage_flow"
  | "testing_queue"
  | "workflow_violations";

export interface FlowEfficiencyDiagnostic {
  key: string;
  title: string;
  detail: string;
  target: FlowEfficiencyDiagnosticTarget;
  tone: "critical" | "attention" | "normal" | "good";
  priority: number;
}

export interface FlowThreadStatusCounts {
  prs: number;
  blockedPrs: number;
  testingIssues: number;
  testingPrs: number;
  sharedPrs: number;
  unlinkedPrs: number;
}

export type PersonalFlowThreadFilter = "all" | "critical" | "blocked" | "testing" | "needs_link" | "shared";

export type PersonalFlowThreadCounts = Record<PersonalFlowThreadFilter, number>;

export type ObservedOwnerThreadTone = "critical" | "attention" | "normal";

export interface ObservedOwnerThread {
  id: string;
  title: string;
  issue: CriticalIssueView | null;
  prs: PendingPrView[];
  linkedIssueNumbers: number[];
  tone: ObservedOwnerThreadTone;
  durationHours: number | null;
  needsLink: boolean;
}

export type CriticalOwnerFlowTone = "critical" | "attention" | "normal";

export interface CriticalOwnerFlowSummary {
  key: string;
  ownerLogin: string | null;
  ownerLabel: string;
  ownerScope: CriticalIssueView["ownerScope"];
  activeIssues: number;
  sMinusOneIssues: number;
  sZeroIssues: number;
  noVisiblePrIssues: number;
  issuesWithPrBlockers: number;
  blockedPrs: number;
  testingIssues: number;
  staleTestingIssues: number;
  maxCriticalAgeHours: number | null;
  averageCriticalAgeHours: number | null;
  aiLabels: string[];
  tone: CriticalOwnerFlowTone;
}

export interface TeamCriticalFlowEfficiency {
  activeIssues: number;
  issuesWithPr: number;
  issuesWithoutPr: number;
  issuesInTesting: number;
  blockedPrs: number;
  averageActiveToFirstPrHours: number | null;
  averageActiveToTestingHours: number | null;
  testingCachePendingIssues: number;
}

export interface TestingTurnoverHealthSummary {
  title: string;
  detail: string;
  evidence: string;
  tone: "critical" | "attention" | "normal";
}

export function effectiveAiEffortLabel(label: string | null): string {
  return label ?? "ai-easy";
}

export function criticalIssueContextsByPullRequest(
  issues: CriticalIssueView[],
  pullRequests: Array<Pick<PendingPrView, "number" | "linkedIssueNumbers">> = []
): Map<number, PrCriticalIssueContext[]> {
  const byPullRequest = new Map<number, PrCriticalIssueContext[]>();

  for (const issue of issues) {
    const context: PrCriticalIssueContext = {
      number: issue.number,
      title: issue.title,
      htmlUrl: issue.htmlUrl,
      severity: issue.severity,
      ownerLogin: issue.ownerLogin,
      ownerScope: issue.ownerScope,
      ownerReason: issue.ownerReason,
      aiEffortLabel: effectiveAiEffortLabel(issue.aiEffortLabel),
      criticalAgeHours: issue.criticalAgeHours,
      criticalAgeEvidence: issue.criticalAgeEvidence,
      blockerCount: issue.blockers.filter((blocker) => blocker.severity !== "info").length,
      isComplete: issue.isComplete
    };

    for (const pr of issue.linkedPullRequests) {
      const existing = byPullRequest.get(pr.number) ?? [];
      existing.push(context);
      byPullRequest.set(pr.number, existing);
    }

    for (const pr of pullRequests) {
      if (!pr.linkedIssueNumbers.includes(issue.number)) {
        continue;
      }
      const existing = byPullRequest.get(pr.number) ?? [];
      if (!existing.some((context) => context.number === issue.number)) {
        existing.push(context);
        byPullRequest.set(pr.number, existing);
      }
    }
  }

  for (const [prNumber, contexts] of byPullRequest.entries()) {
    byPullRequest.set(prNumber, contexts.sort(comparePrCriticalIssueContext));
  }

  return byPullRequest;
}

export function prVisibleIssueNumbers(
  pr: Pick<PendingPrView, "linkedIssueNumbers">,
  activeIssues: PrCriticalIssueContext[] = []
): number[] {
  return uniqueNumbers([...pr.linkedIssueNumbers, ...activeIssues.map((issue) => issue.number)]);
}

export function prIssueRelationshipComplete(
  pr: Pick<PendingPrView, "isComplete" | "detailSyncedAt" | "detailError">
): boolean {
  return pr.isComplete && pr.detailSyncedAt !== null && pr.detailError === null;
}

export function prHasVisibleIssueContext(
  pr: Pick<PendingPrView, "linkedIssueNumbers">,
  activeIssues: PrCriticalIssueContext[] = []
): boolean {
  return prVisibleIssueNumbers(pr, activeIssues).length > 0;
}

export function prHasNoVisibleIssue(
  pr: Pick<PendingPrView, "linkedIssueNumbers" | "isComplete" | "detailSyncedAt" | "detailError">,
  activeIssues: PrCriticalIssueContext[] = []
): boolean {
  return !prHasVisibleIssueContext(pr, activeIssues) && prIssueRelationshipComplete(pr);
}

export function prIssueLinkEvidencePending(
  pr: Pick<PendingPrView, "linkedIssueNumbers" | "isComplete" | "detailSyncedAt" | "detailError">,
  activeIssues: PrCriticalIssueContext[] = []
): boolean {
  return !prHasVisibleIssueContext(pr, activeIssues) && !prIssueRelationshipComplete(pr);
}

export function flowEfficiencySummary(input: {
  points: FlowEfficiencyMetricPoint[];
  pendingPrs: FlowEfficiencyPullRequest[];
  activeIssues: FlowEfficiencyIssue[];
  testingPrs?: Array<Pick<FlowEfficiencyPullRequest, "testingQueueAgeHours">>;
  testingIssues?: Array<{ queueAgeHours: number | null }>;
  testingQueueIssues?: number;
  testingQueuePrs?: number;
  averageTestingQueueAgeHours?: number | null;
  needsTriageIssues?: number;
  deferredIssues?: number;
}): FlowEfficiencySummary {
  const prsCreated = sumBy(input.points, (point) => point.prsCreated);
  const prsMerged = sumBy(input.points, (point) => point.prsMerged);
  const issuesOpened = sumBy(input.points, (point) => point.issuesOpened);
  const issuesResolved =
    sumBy(input.points, (point) => point.issuesClosed) + sumBy(input.points, (point) => point.issuesDeferred);
  const testingPrs = input.testingPrs ?? input.pendingPrs.filter(isTestingQueuePullRequest);
  const testingIssues = input.testingIssues ?? [];
  const issueTestingWaits = testingIssues
    .map((issue) => issue.queueAgeHours)
    .filter((age): age is number => age !== null);
  const prTestingWaits = testingPrs.map((pr) => pr.testingQueueAgeHours).filter((age): age is number => age !== null);
  const testingWaits = issueTestingWaits.length > 0 ? issueTestingWaits : prTestingWaits;

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
    averageActiveIssueAgeHours: average(input.activeIssues.map((issue) => issue.criticalAgeHours)),
    needsTriageIssues: input.needsTriageIssues ?? 0,
    deferredIssues: input.deferredIssues ?? 0,
    testingQueueIssues: input.testingQueueIssues ?? testingIssues.length,
    testingQueuePrs: input.testingQueuePrs ?? testingPrs.length,
    averageTestingQueueAgeHours:
      input.averageTestingQueueAgeHours !== undefined ? input.averageTestingQueueAgeHours : average(testingWaits)
  };
}

export function prQualityRiskSummary(point: PrQualityMetricPoint): PrQualityRiskSummary {
  const qualitySignalTotal =
    point.ciFailedPrs + point.requestedChangePrs + point.reviewWaitingPrs + point.mergeConflictPrs;
  const criticalSignals = point.ciFailedPrs + point.requestedChangePrs + point.mergeConflictPrs;
  const qualitySignalRatePercent = percentage(qualitySignalTotal, point.pendingPrs);
  return {
    pendingPrs: point.pendingPrs,
    qualitySignalTotal,
    qualitySignalRatePercent,
    ciFailedPrs: point.ciFailedPrs,
    ciFailureRatePercent: percentage(point.ciFailedPrs, point.pendingPrs),
    requestedChangePrs: point.requestedChangePrs,
    requestedChangeRatePercent: percentage(point.requestedChangePrs, point.pendingPrs),
    reviewWaitingPrs: point.reviewWaitingPrs,
    reviewWaitingRatePercent: percentage(point.reviewWaitingPrs, point.pendingPrs),
    mergeConflictPrs: point.mergeConflictPrs,
    mergeConflictRatePercent: percentage(point.mergeConflictPrs, point.pendingPrs),
    tone:
      criticalSignals > 0
        ? "critical"
        : point.reviewWaitingPrs > 0
          ? "attention"
          : point.pendingPrs > 0
            ? "normal"
            : "good"
  };
}

export function flowEfficiencyDiagnostics(summary: FlowEfficiencySummary): FlowEfficiencyDiagnostic[] {
  const diagnostics: FlowEfficiencyDiagnostic[] = [];

  if (summary.activeCriticalIssues > 0) {
    diagnostics.push({
      key: "active-critical-age",
      title:
        summary.averageActiveIssueAgeHours !== null && summary.averageActiveIssueAgeHours >= 72
          ? `${summary.activeCriticalIssues} active s-1/s0 issues are aging`
          : `${summary.activeCriticalIssues} active s-1/s0 issues need rotation`,
      detail: `avg active ${diagnosticDuration(summary.averageActiveIssueAgeHours)}; verify owner, linked PR, and blocker state`,
      target: "active_critical_age",
      tone:
        summary.averageActiveIssueAgeHours !== null && summary.averageActiveIssueAgeHours >= 72
          ? "critical"
          : "attention",
      priority: summary.averageActiveIssueAgeHours !== null && summary.averageActiveIssueAgeHours >= 72 ? 980 : 900
    });
  }

  if (summary.attentionPrs > 0) {
    diagnostics.push({
      key: "pr-attention",
      title: `${summary.attentionPrs} pending PRs need attention`,
      detail: `${percentDiagnostic(summary.prAttentionRatePercent)} of pending PRs; review CI, requested changes, conflict, or idle state`,
      target: "pr_attention",
      tone: summary.prAttentionRatePercent !== null && summary.prAttentionRatePercent >= 50 ? "critical" : "attention",
      priority: summary.prAttentionRatePercent !== null && summary.prAttentionRatePercent >= 50 ? 940 : 840
    });
  }

  if (summary.needsTriageIssues > 0) {
    const triageHeavy = summary.needsTriageIssues > summary.activeCriticalIssues && summary.activeCriticalIssues <= 1;
    diagnostics.push({
      key: "triage-flow",
      title: triageHeavy
        ? `${summary.needsTriageIssues} needs-triage issues exceed active work`
        : `${summary.needsTriageIssues} needs-triage issues need decisions`,
      detail: `${summary.activeCriticalIssues} active s-1/s0; ${summary.deferredIssues} deferred; classify, start, or defer with reason`,
      target: "triage_flow",
      tone: triageHeavy ? "attention" : "normal",
      priority: triageHeavy ? 910 : 610 + summary.needsTriageIssues
    });
  }

  if (summary.testingQueueIssues > 0 || summary.testingQueuePrs > 0) {
    const issueQueueVisible = summary.testingQueueIssues > 0;
    diagnostics.push({
      key: "testing-queue",
      title:
        summary.averageTestingQueueAgeHours !== null && summary.averageTestingQueueAgeHours >= 24
          ? issueQueueVisible
            ? `${summary.testingQueueIssues} issues are waiting in issue testing`
            : `${summary.testingQueuePrs} linked PRs are waiting on issue testing`
          : issueQueueVisible
            ? `${summary.testingQueueIssues} issues are in issue testing`
            : `${summary.testingQueuePrs} linked PRs have issue testing context`,
      detail: `avg wait ${diagnosticDuration(summary.averageTestingQueueAgeHours)}; ${summary.testingQueuePrs} linked PRs; check issue assignment and linked PR evidence`,
      target: "testing_queue",
      tone:
        summary.averageTestingQueueAgeHours !== null && summary.averageTestingQueueAgeHours >= 24
          ? "critical"
          : "attention",
      priority: summary.averageTestingQueueAgeHours !== null && summary.averageTestingQueueAgeHours >= 24 ? 920 : 720
    });
  }

  if (summary.issueOpenDelta > 0) {
    diagnostics.push({
      key: "issue-drain",
      title: `Issue backlog grew by ${summary.issueOpenDelta}`,
      detail: `${summary.issuesResolved}/${summary.issuesOpened} resolved; drain rate ${percentDiagnostic(
        summary.issueDrainRatePercent
      )}`,
      target: "issue_drain",
      tone: "attention",
      priority: 700 + summary.issueOpenDelta
    });
  }

  if (summary.prOpenDelta > 0) {
    diagnostics.push({
      key: "pr-flow",
      title: `PR queue grew by ${summary.prOpenDelta}`,
      detail: `${summary.prsMerged}/${summary.prsCreated} merged; merge rate ${percentDiagnostic(
        summary.prMergeRatePercent
      )}`,
      target: "pr_flow",
      tone: "attention",
      priority: 680 + summary.prOpenDelta
    });
  }

  if (summary.averagePendingPrAgeHours !== null && summary.averagePendingPrAgeHours >= 24) {
    diagnostics.push({
      key: "pending-pr-age",
      title: `${summary.pendingPrs} pending PRs are aging`,
      detail: `avg age ${diagnosticDuration(summary.averagePendingPrAgeHours)}; reduce review and CI wait`,
      target: "pending_pr_age",
      tone: "attention",
      priority: 660
    });
  }

  if (summary.workflowViolations > 0) {
    diagnostics.push({
      key: "workflow-violations",
      title: `${summary.workflowViolations} workflow violations detected`,
      detail: "review triage, defer reasons, AI labels, and stale workflow evidence",
      target: "workflow_violations",
      tone: "attention",
      priority: 620 + summary.workflowViolations
    });
  }

  if (diagnostics.length === 0) {
    return [
      {
        key: "flow-clear",
        title: "No flow bottleneck in cached data",
        detail: "throughput, issue drain, PR attention, and issue testing waits are within current thresholds",
        target: "pr_flow",
        tone: "good",
        priority: 0
      }
    ];
  }

  return diagnostics.sort((left, right) => right.priority - left.priority);
}

export function sortTestingIssuesForAction(issues: TestingIssueQueueView[]): TestingIssueQueueView[] {
  return [...issues].sort(
    (left, right) =>
      Number(testingIssueNeedsAttention(right)) - Number(testingIssueNeedsAttention(left)) ||
      (right.queueAgeHours ?? 0) - (left.queueAgeHours ?? 0) ||
      testingIssueLinkedBlockerCount(right) - testingIssueLinkedBlockerCount(left) ||
      right.linkedPullRequests.length - left.linkedPullRequests.length ||
      left.number - right.number
  );
}

export function testingIssueNeedsAttention(issue: TestingIssueQueueView): boolean {
  return (issue.queueAgeHours ?? 0) >= 24 || testingIssueLinkedBlockerCount(issue) > 0 || issue.syncError !== null;
}

export function testingIssueLinkedBlockerCount(issue: TestingIssueQueueView): number {
  return issue.linkedPullRequests.filter(
    (pr) =>
      pr.attentionFlags.length > 0 ||
      prHasReviewStageFeedback(pr) ||
      pr.mergeStateStatus === "dirty" ||
      (pr.ciState !== null &&
        ["failure", "failed", "error", "timed_out", "action_required", "cancelled"].includes(pr.ciState))
  ).length;
}

type TestingTesterRow = DashboardSummary["testing"]["testers"][number];

function testingTesterAttentionScore(tester: TestingTesterRow): number {
  const wait = tester.averageIssueQueueAgeHours ?? 0;
  const close = tester.averageHandoffToCloseHours ?? 0;
  return (
    (wait >= 24 ? 10_000 : 0) +
    (close >= 48 ? 5_000 : 0) +
    tester.queueIssues * 200 +
    tester.queuePrs * 40 +
    Math.min(wait, 240) +
    Math.min(close, 240) / 4
  );
}

export function testingTesterNeedsAttention(tester: TestingTesterRow): boolean {
  return (
    tester.queueIssues > 0 ||
    tester.queuePrs > 0 ||
    (tester.averageIssueQueueAgeHours ?? 0) >= 24 ||
    (tester.averageHandoffToCloseHours ?? 0) >= 48
  );
}

export function sortTestingTestersForManagement(
  testers: TestingTesterRow[],
  sort: TestingTesterSort
): TestingTesterRow[] {
  return [...testers].sort((left, right) => {
    if (sort === "queue") {
      return (
        right.queueIssues - left.queueIssues ||
        right.queuePrs - left.queuePrs ||
        (right.averageIssueQueueAgeHours ?? 0) - (left.averageIssueQueueAgeHours ?? 0) ||
        left.login.localeCompare(right.login)
      );
    }
    if (sort === "wait") {
      return (
        (right.averageIssueQueueAgeHours ?? -1) - (left.averageIssueQueueAgeHours ?? -1) ||
        right.queueIssues - left.queueIssues ||
        left.login.localeCompare(right.login)
      );
    }
    if (sort === "handoff") {
      return (
        (right.averageHandoffToCloseHours ?? -1) - (left.averageHandoffToCloseHours ?? -1) ||
        right.handoffToCloseSamples - left.handoffToCloseSamples ||
        left.login.localeCompare(right.login)
      );
    }
    if (sort === "login") {
      return left.login.localeCompare(right.login);
    }
    return (
      testingTesterAttentionScore(right) - testingTesterAttentionScore(left) ||
      right.queueIssues - left.queueIssues ||
      (right.averageIssueQueueAgeHours ?? 0) - (left.averageIssueQueueAgeHours ?? 0) ||
      left.login.localeCompare(right.login)
    );
  });
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

function maxPersonActiveAge(person: PersonalActionView | undefined): number {
  return maxFinite(person?.activeCriticalIssues.map((issue) => issue.criticalAgeHours) ?? []) ?? -1;
}

function maxPersonPendingPrAge(person: PersonalActionView | undefined): number {
  return maxFinite(person?.pendingPrs.map((pr) => pr.ageHours) ?? []) ?? -1;
}

function maxPersonAttentionPrAge(person: PersonalActionView | undefined): number {
  return maxFinite(person?.attentionPrs.map((pr) => pr.ageHours) ?? []) ?? -1;
}

function maxPersonTriageAge(person: PersonalActionView | undefined): number {
  return maxFinite(person?.needsTriageIssues.map((issue) => issue.ageHours) ?? []) ?? -1;
}

function maxPersonTestingWait(person: PersonalActionView | undefined): number {
  return maxFinite(person?.testingIssues.map((issue) => issue.queueAgeHours) ?? []) ?? -1;
}

function personTestingCount(person: PersonalActionView | undefined): number {
  return person ? personalTestingWorkCount(person) : 0;
}

function latestMetricPoint(points: DailyMetricPoint[] | undefined): DailyMetricPoint | null {
  if (!points || points.length === 0) {
    return null;
  }
  const sorted = [...points].sort(
    (left, right) =>
      Date.parse(left.date) - Date.parse(right.date) || Date.parse(left.generatedAt) - Date.parse(right.generatedAt)
  );
  return sorted.at(-1) ?? null;
}

function metricPrThroughput(point: DailyMetricPoint | null): number {
  return point ? point.prsCreated + point.prsMerged : 0;
}

function personPrThroughputSortValues(person: PersonalActionView | undefined): number[] {
  return [
    metricPrThroughput(latestMetricPoint(person?.analytics)),
    metricPrThroughput(latestMetricPoint(person?.analyticsWeekly)),
    metricPrThroughput(latestMetricPoint(person?.analyticsMonthly)),
    person?.pendingPrs.length ?? 0,
    person?.attentionPrs.length ?? 0
  ];
}

function personFlowGapSortValues(summary: PersonSummary, person: PersonalActionView | undefined): number[] {
  const activeIssues = person?.activeCriticalIssues ?? [];
  const issuesWithoutPr = activeIssues.filter((issue) => issue.linkedPullRequests.length === 0);
  const issuesNotInTesting = activeIssues.filter(
    (issue) =>
      issue.linkedPullRequests.length === 0 ||
      !issue.linkedPullRequests.some(
        (pr) => pr.testingState !== "not_ready" || pr.testingQueueAgeHours !== null || pr.testingTesters.length > 0
      )
  );
  return [
    issuesWithoutPr.length,
    issuesNotInTesting.length,
    maxFinite(issuesWithoutPr.map((issue) => issue.criticalAgeHours)) ?? -1,
    maxFinite(issuesNotInTesting.map((issue) => issue.criticalAgeHours)) ?? -1,
    summary.activeCriticalIssues,
    summary.attentionPrs
  ];
}

function comparePersonNumbers(leftValues: number[], rightValues: number[]): number {
  for (let index = 0; index < leftValues.length; index += 1) {
    const delta = (rightValues[index] ?? 0) - (leftValues[index] ?? 0);
    if (delta !== 0) {
      return delta;
    }
  }
  return 0;
}

export function sortPeopleForBoard(
  people: PersonSummary[],
  personalViews: PersonalActionView[],
  sort: PeopleBoardSort
): PersonSummary[] {
  if (sort === "workload") {
    return sortPeopleByWorkload(people);
  }

  const personalByLogin = new Map(personalViews.map((person) => [person.login, person]));

  return [...people].sort((left, right) => {
    const leftPersonal = personalByLogin.get(left.login);
    const rightPersonal = personalByLogin.get(right.login);

    if (sort === "name") {
      return left.login.localeCompare(right.login);
    }
    if (sort === "active") {
      const delta = comparePersonNumbers(
        [left.activeCriticalIssues, maxPersonActiveAge(leftPersonal), left.attentionPrs],
        [right.activeCriticalIssues, maxPersonActiveAge(rightPersonal), right.attentionPrs]
      );
      return delta || left.login.localeCompare(right.login);
    }
    if (sort === "pr_age") {
      const delta = comparePersonNumbers(
        [maxPersonPendingPrAge(leftPersonal), left.pendingPrs, left.attentionPrs],
        [maxPersonPendingPrAge(rightPersonal), right.pendingPrs, right.attentionPrs]
      );
      return delta || left.login.localeCompare(right.login);
    }
    if (sort === "pr_attention") {
      const delta = comparePersonNumbers(
        [left.attentionPrs, maxPersonAttentionPrAge(leftPersonal), left.pendingPrs],
        [right.attentionPrs, maxPersonAttentionPrAge(rightPersonal), right.pendingPrs]
      );
      return delta || left.login.localeCompare(right.login);
    }
    if (sort === "pr_throughput") {
      const delta = comparePersonNumbers(
        personPrThroughputSortValues(leftPersonal),
        personPrThroughputSortValues(rightPersonal)
      );
      return delta || left.login.localeCompare(right.login);
    }
    if (sort === "flow_gap") {
      const delta = comparePersonNumbers(
        personFlowGapSortValues(left, leftPersonal),
        personFlowGapSortValues(right, rightPersonal)
      );
      return delta || left.login.localeCompare(right.login);
    }
    if (sort === "triage") {
      const delta = comparePersonNumbers(
        [left.needsTriageIssues, maxPersonTriageAge(leftPersonal), left.deferredIssues],
        [right.needsTriageIssues, maxPersonTriageAge(rightPersonal), right.deferredIssues]
      );
      return delta || left.login.localeCompare(right.login);
    }

    const delta = comparePersonNumbers(
      [personTestingCount(leftPersonal), maxPersonTestingWait(leftPersonal), left.attentionPrs],
      [personTestingCount(rightPersonal), maxPersonTestingWait(rightPersonal), right.attentionPrs]
    );
    return delta || left.login.localeCompare(right.login);
  });
}

export function personalTestingWorkCount(person: PersonalActionView): number {
  return person.testingIssues.length;
}

function maxFinite(values: Array<number | null>): number | null {
  const finite = values.filter((value): value is number => value !== null && Number.isFinite(value));
  return finite.length > 0 ? Math.max(...finite) : null;
}

function compactDuration(value: number | null): string {
  if (value === null) {
    return "unknown";
  }
  if (value < 24) {
    return `${Math.round(value)}h`;
  }
  return `${(value / 24).toFixed(1)}d`;
}

function prBlockerSummary(prs: PersonalPullRequestView[]): string {
  if (prs.length === 0) {
    return "no PR blockers";
  }
  const reasons = prs.flatMap(prAttentionReasons);
  const ci = reasons.filter((reason) => reason === attentionFlagLabels.ci_failed).length;
  const review = reasons.filter((reason) => reason === attentionFlagLabels.review_requested_no_response).length;
  const changes = reasons.filter((reason) => reason === attentionFlagLabels.requested_changes).length;
  const conflicts = reasons.filter((reason) => reason === attentionFlagLabels.merge_conflict).length;
  const idle = reasons.filter((reason) => reason === attentionFlagLabels.no_human_action_24h).length;
  const parts = [
    ci > 0 ? `${ci} CI` : null,
    review > 0 ? `${review} review` : null,
    changes > 0 ? `${changes} changes` : null,
    conflicts > 0 ? `${conflicts} conflict` : null,
    idle > 0 ? `${idle} idle` : null
  ].filter((part): part is string => part !== null);

  return parts.length > 0 ? parts.join(" | ") : `${prs.length} attention PR`;
}

export function personalOperatingSignals(
  person: PersonalActionView,
  activityItems: PersonalActivityItem[] = personalActivityItems(person)
): PersonalOperatingSignal[] {
  const activeItems = activityItems.filter((item) => item.durationKind === "critical_active");
  const activeNoPr = person.activeCriticalIssues.filter((issue) => issue.linkedPullRequests.length === 0).length;
  const activeMissingTimeline = activeItems.filter((item) => item.durationHours === null).length;
  const oldestActive = maxFinite(activeItems.map((item) => item.durationHours));
  const blockedPrItems = activityItems.filter(
    (item) => item.objectType === "pull_request" && personalActivityHasBlockingSignal(item)
  );
  const blockedPrNumbers = new Set(blockedPrItems.map((item) => item.number));
  const blockedPrs = person.pendingPrs.filter((pr) => blockedPrNumbers.has(pr.number));
  const staleTestingIssues = person.testingIssues.filter(testingIssueNeedsAttention);
  const oldestTesting = maxFinite(person.testingIssues.map((issue) => issue.queueAgeHours));
  const oldestTriage = maxFinite(person.needsTriageIssues.map((issue) => issue.ageHours));
  const oldestPendingPr = maxFinite(person.pendingPrs.map((pr) => pr.ageHours));
  const triageHeavy =
    person.needsTriageIssues.length > person.activeCriticalIssues.length && person.activeCriticalIssues.length <= 1;
  const activeDetail =
    person.activeCriticalIssues.length === 0
      ? "no active s-1/s0"
      : `${compactDuration(oldestActive)} active | ${activeNoPr} no PR | ${activeMissingTimeline} timeline missing`;
  const testingDetail =
    person.testingIssues.length === 0
      ? "no issue testing"
      : `${staleTestingIssues.length} need update | max wait ${compactDuration(oldestTesting)} | ${
          person.testingPrs.length
        } linked PR`;
  const triageDetail =
    person.needsTriageIssues.length === 0
      ? `${person.deferredIssues.length} deferred`
      : `${compactDuration(oldestTriage)} oldest | ${triageHeavy ? "triage-heavy" : "balanced"} | ${
          person.deferredIssues.length
        } deferred`;
  const pendingDetail =
    person.pendingPrs.length === 0
      ? "no pending PR"
      : `${person.attentionPrs.length} attention | oldest ${compactDuration(oldestPendingPr)}`;

  return [
    {
      key: "active_issues",
      label: "Active issues",
      value: person.activeCriticalIssues.length,
      detail: activeDetail,
      tone: person.activeCriticalIssues.length > 0 ? "critical" : "good",
      target: "active_issues",
      priority: person.activeCriticalIssues.length > 0 ? 1_000 + person.activeCriticalIssues.length : 100
    },
    {
      key: "pr_blockers",
      label: "PR blockers",
      value: blockedPrItems.length,
      detail: prBlockerSummary(blockedPrs),
      tone: blockedPrItems.length > 0 ? "attention" : "good",
      target: "pr_attention",
      priority: blockedPrItems.length > 0 ? 850 + blockedPrItems.length : 80
    },
    {
      key: "testing",
      label: "Issue testing",
      value: person.testingIssues.length,
      detail: testingDetail,
      tone: staleTestingIssues.length > 0 ? "critical" : person.testingIssues.length > 0 ? "attention" : "good",
      target: "testing",
      priority:
        staleTestingIssues.length > 0
          ? 920 + staleTestingIssues.length
          : person.testingIssues.length > 0
            ? 720 + person.testingIssues.length
            : 70
    },
    {
      key: "triage",
      label: "Triage",
      value: person.needsTriageIssues.length,
      detail: triageDetail,
      tone: person.needsTriageIssues.length > 0 ? "attention" : "good",
      target: "triage",
      priority: person.needsTriageIssues.length > 0 ? (triageHeavy ? 780 : 620) + person.needsTriageIssues.length : 60
    },
    {
      key: "pending_pr",
      label: "Pending PRs",
      value: person.pendingPrs.length,
      detail: pendingDetail,
      tone:
        person.attentionPrs.length > 0 || (oldestPendingPr !== null && oldestPendingPr >= 24)
          ? "attention"
          : person.pendingPrs.length > 0
            ? "normal"
            : "good",
      target: "pending_pr",
      priority:
        person.attentionPrs.length > 0 || (oldestPendingPr !== null && oldestPendingPr >= 24)
          ? 650 + person.pendingPrs.length
          : person.pendingPrs.length > 0
            ? 300 + person.pendingPrs.length
            : 50
    }
  ];
}

export function personalDailyPlan(signals: PersonalOperatingSignal[], maxItems = 3): PersonalDailyPlanItem[] {
  const stages: PersonalDailyPlanStage[] = ["Do now", "Next", "Watch"];
  const actionableSignals = signals
    .filter((signal) => signal.value > 0 && (signal.tone === "critical" || signal.tone === "attention"))
    .sort((left, right) => right.priority - left.priority);
  const actionableKeys = new Set(actionableSignals.map((signal) => signal.key));
  const routineSignals = signals
    .filter((signal) => signal.value > 0 && !actionableKeys.has(signal.key))
    .sort((left, right) => right.priority - left.priority);

  return [...actionableSignals, ...routineSignals].slice(0, maxItems).map((signal, index) => ({
    ...signal,
    key: `${stages[index] ?? "Watch"}:${signal.key}`,
    stage: stages[index] ?? "Watch"
  }));
}

function personalCommandActionLabel(target: PersonalOperatingSignalTarget): string {
  if (target === "active_issues") {
    return "Open active issues";
  }
  if (target === "pr_attention") {
    return "Open PR blockers";
  }
  if (target === "testing") {
    return "Open issue testing";
  }
  if (target === "triage") {
    return "Open triage";
  }
  return "Open PR movement";
}

export function personalCommandSummary(
  person: PersonalActionView,
  signals: PersonalOperatingSignal[] = personalOperatingSignals(person)
): PersonalCommandSummary {
  const [topItem] = personalDailyPlan(signals, 1);
  if (!topItem) {
    return {
      title: "Personal rotation is clear",
      detail: "No active s-1/s0, PR blocker, issue testing wait, triage backlog, or pending PR is visible in cache.",
      tone: "good",
      target: "pending_pr",
      actionLabel: "Review PR movement"
    };
  }

  return {
    title: `${topItem.stage}: ${topItem.label} (${topItem.value})`,
    detail: topItem.detail,
    tone: topItem.tone,
    target: topItem.target,
    actionLabel: personalCommandActionLabel(topItem.target)
  };
}

function testingCountForPerson(login: string, personalByLogin: Map<string, PersonalActionView>): number {
  const person = personalByLogin.get(login);
  return person ? personalTestingWorkCount(person) : 0;
}

export function peopleScopeMatchesPerson(
  person: PersonSummary,
  personalByLogin: Map<string, PersonalActionView>,
  scopeFilter: PeopleScopeFilter
): boolean {
  if (scopeFilter === "critical") {
    return person.activeCriticalIssues > 0;
  }
  if (scopeFilter === "attention") {
    return person.attentionPrs > 0;
  }
  if (scopeFilter === "triage") {
    return person.needsTriageIssues > 0;
  }
  if (scopeFilter === "deferred") {
    return person.deferredIssues > 0;
  }
  if (scopeFilter === "pending_pr") {
    return person.pendingPrs > 0;
  }
  if (scopeFilter === "testing") {
    return testingCountForPerson(person.login, personalByLogin) > 0;
  }
  if (scopeFilter === "yesterday_pr") {
    return person.prsCreatedYesterday + person.prsMergedYesterday > 0;
  }
  return true;
}

export function filterPeopleByScope(
  people: PersonSummary[],
  personalViews: PersonalActionView[],
  scopeFilter: PeopleScopeFilter
): PersonSummary[] {
  const personalByLogin = new Map(personalViews.map((person) => [person.login, person]));
  return people.filter((person) => peopleScopeMatchesPerson(person, personalByLogin, scopeFilter));
}

export function peopleBoardScopeCounts(
  people: PersonSummary[],
  personalViews: PersonalActionView[]
): PeopleBoardScopeCounts {
  const personalByLogin = new Map(personalViews.map((person) => [person.login, person]));
  return peopleScopeFilters.reduce((counts, scopeFilter) => {
    counts[scopeFilter] =
      scopeFilter === "all"
        ? people.length
        : people.filter((person) => peopleScopeMatchesPerson(person, personalByLogin, scopeFilter)).length;
    return counts;
  }, {} as PeopleBoardScopeCounts);
}

export function teamTriageSnapshot(data: Pick<DashboardSummary, "personalViews" | "people">): TeamTriageSnapshot {
  if (data.personalViews.length > 0) {
    const needsTriageIssues = new Set<number>();
    const deferredIssues = new Set<number>();
    let peopleWithNeedsTriage = 0;
    let peopleWithDeferred = 0;

    for (const person of data.personalViews) {
      if (person.needsTriageIssues.length > 0) {
        peopleWithNeedsTriage += 1;
      }
      if (person.deferredIssues.length > 0) {
        peopleWithDeferred += 1;
      }
      for (const issue of person.needsTriageIssues) {
        needsTriageIssues.add(issue.number);
      }
      for (const issue of person.deferredIssues) {
        deferredIssues.add(issue.number);
      }
    }

    return {
      needsTriageIssues: needsTriageIssues.size,
      deferredIssues: deferredIssues.size,
      peopleWithNeedsTriage,
      peopleWithDeferred
    };
  }

  return {
    needsTriageIssues: data.people.reduce((total, person) => total + person.needsTriageIssues, 0),
    deferredIssues: data.people.reduce((total, person) => total + person.deferredIssues, 0),
    peopleWithNeedsTriage: data.people.filter((person) => person.needsTriageIssues > 0).length,
    peopleWithDeferred: data.people.filter((person) => person.deferredIssues > 0).length
  };
}

export function teamPeopleFocusSummary(
  people: PersonSummary[],
  personalViews: PersonalActionView[]
): TeamPeopleFocusSummary {
  const personalByLogin = new Map(personalViews.map((person) => [person.login, person]));
  const riskLogins = new Set<string>();
  for (const person of people) {
    if (
      person.activeCriticalIssues > 0 ||
      person.attentionPrs > 0 ||
      person.needsTriageIssues > 0 ||
      testingCountForPerson(person.login, personalByLogin) > 0
    ) {
      riskLogins.add(person.login);
    }
  }
  return {
    people: people.length,
    riskPeople: riskLogins.size,
    activeIssuePeople: people.filter((person) => person.activeCriticalIssues > 0).length,
    prAttentionPeople: people.filter((person) => person.attentionPrs > 0).length,
    testingPeople: people.filter((person) => testingCountForPerson(person.login, personalByLogin) > 0).length,
    triagePeople: people.filter((person) => person.needsTriageIssues > 0).length
  };
}

function peopleAttentionTone(tone: PersonalOperatingSignalTone): PeopleAttentionQueueTone {
  return tone === "critical" || tone === "attention" ? tone : "normal";
}

function peopleSummaryAttentionItem(person: PersonSummary): PeopleAttentionQueueItem | null {
  if (person.activeCriticalIssues > 0) {
    return {
      login: person.login,
      label: "Active issues",
      value: person.activeCriticalIssues,
      detail: `${person.attentionPrs} PR attention | ${person.pendingPrs} pending PRs`,
      target: "active_issues",
      tone: "critical",
      priority: 1_000 + person.activeCriticalIssues
    };
  }
  if (person.attentionPrs > 0) {
    return {
      login: person.login,
      label: "PR attention",
      value: person.attentionPrs,
      detail: `${person.pendingPrs} pending PRs`,
      target: "pr_attention",
      tone: "attention",
      priority: 850 + person.attentionPrs
    };
  }
  if (person.needsTriageIssues > 0) {
    return {
      login: person.login,
      label: "Triage",
      value: person.needsTriageIssues,
      detail: `${person.deferredIssues} deferred`,
      target: "triage",
      tone: "attention",
      priority: 620 + person.needsTriageIssues
    };
  }
  if (person.pendingPrs > 0) {
    return {
      login: person.login,
      label: "Pending PRs",
      value: person.pendingPrs,
      detail: "no PR blocker visible in summary",
      target: "pending_pr",
      tone: "normal",
      priority: 300 + person.pendingPrs
    };
  }
  return null;
}

export function peopleAttentionQueue(
  people: PersonSummary[],
  personalViews: PersonalActionView[],
  limit = 3
): PeopleAttentionQueueItem[] {
  const personalByLogin = new Map(personalViews.map((person) => [person.login, person]));
  return people
    .map((person) => {
      const personal = personalByLogin.get(person.login);
      if (!personal) {
        return peopleSummaryAttentionItem(person);
      }
      const [primary] = personalDailyPlan(personalOperatingSignals(personal), 1);
      if (!primary || primary.value <= 0) {
        return peopleSummaryAttentionItem(person);
      }
      return {
        login: person.login,
        label: primary.label,
        value: primary.value,
        detail: primary.detail,
        target: primary.target,
        tone: peopleAttentionTone(primary.tone),
        priority: primary.priority
      };
    })
    .filter((item): item is PeopleAttentionQueueItem => item !== null)
    .sort((left, right) => right.priority - left.priority || left.login.localeCompare(right.login))
    .slice(0, Math.max(0, limit));
}

export function observedPeopleFromDashboard(input: {
  criticalIssues: CriticalIssueView[];
  pendingPrs: PendingPrView[];
}): PersonSummary[] {
  const peopleByLogin = new Map<string, PersonSummary>();

  const personForLogin = (login: string): PersonSummary => {
    const existing = peopleByLogin.get(login);
    if (existing) {
      return existing;
    }
    const next: PersonSummary = {
      login,
      activeCriticalIssues: 0,
      needsTriageIssues: 0,
      deferredIssues: 0,
      prsCreatedYesterday: 0,
      prsMergedYesterday: 0,
      pendingPrs: 0,
      attentionPrs: 0
    };
    peopleByLogin.set(login, next);
    return next;
  };

  for (const issue of input.criticalIssues) {
    if (issue.ownerLogin) {
      personForLogin(issue.ownerLogin).activeCriticalIssues += 1;
    }
  }

  for (const pr of input.pendingPrs) {
    const person = personForLogin(pr.ownerLogin);
    person.pendingPrs += 1;
    if (pr.attentionFlags.length > 0) {
      person.attentionPrs += 1;
    }
  }

  return sortPeopleByWorkload([...peopleByLogin.values()]);
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

export function personPrimaryReasons(person: PersonSummary, testingWork: number): string[] {
  const reasons = [
    person.activeCriticalIssues > 0 ? `${person.activeCriticalIssues} active s-1/s0` : null,
    person.attentionPrs > 0 ? `${person.attentionPrs} PR attention` : null,
    testingWork > 0 ? `${testingWork} issue testing` : null,
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
  testing_stalled: "Issue testing wait over 24h",
  review_requested_no_response: "Review waiting"
};

const failedCiStates = new Set(["failure", "failed", "error", "timed_out", "action_required", "cancelled"]);
const prDetailSyncPendingReason = "PR detail sync pending";
const prAttentionReasonPriority = new Map<string, number>([
  [attentionFlagLabels.merge_conflict, 110],
  [attentionFlagLabels.ci_failed, 100],
  [prDetailSyncPendingReason, 95],
  [attentionFlagLabels.requested_changes, 90],
  ["Issue testing changes requested", 85],
  [attentionFlagLabels.no_human_action_24h, 60],
  [attentionFlagLabels.testing_stalled, 55],
  [attentionFlagLabels.review_requested_no_response, 40]
]);

type PrReviewStageSource = Pick<PersonalPullRequestView, "reviewDecision" | "ciState" | "mergeStateStatus"> & {
  latestReviewState?: string | null;
};
type PrAttentionReasonSource = Pick<PersonalPullRequestView, "attentionFlags" | "testingState"> &
  PrReviewStageSource & { isComplete?: boolean; detailSyncedAt?: string | null; detailError?: string | null };

function prAttentionReasonScore(reason: string): number {
  return prAttentionReasonPriority.get(reason) ?? 10;
}

function orderedPrAttentionReasons(reasons: string[]): string[] {
  return uniqueStrings(reasons).sort(
    (left, right) => prAttentionReasonScore(right) - prAttentionReasonScore(left) || left.localeCompare(right)
  );
}

function prHasPreReviewBlocker(pr: PrReviewStageSource): boolean {
  return (
    pr.mergeStateStatus === "dirty" ||
    (pr.ciState !== null && pr.ciState !== undefined && failedCiStates.has(pr.ciState))
  );
}

function prReviewEvidencePending(pr: PrAttentionReasonSource): boolean {
  return pr.isComplete === false || pr.detailSyncedAt === null || Boolean(pr.detailError);
}

export function prHasReviewStageFeedback(pr: PrReviewStageSource): boolean {
  return (
    !prHasPreReviewBlocker(pr) &&
    (pr.reviewDecision === "changes_requested" || pr.latestReviewState === "changes_requested")
  );
}

export function prAttentionReasons(pr: PrAttentionReasonSource): string[] {
  const hasReviewStageFeedback = prHasReviewStageFeedback(pr);
  const reasons = pr.attentionFlags
    .filter(
      (flag) =>
        !(
          flag === "review_requested_no_response" &&
          (prHasPreReviewBlocker(pr) || prReviewEvidencePending(pr) || hasReviewStageFeedback)
        ) &&
        !(flag === "requested_changes" && !hasReviewStageFeedback)
    )
    .map((flag) => attentionFlagLabels[flag] ?? flag.replaceAll("_", " "));

  if (prReviewEvidencePending(pr)) {
    reasons.push(prDetailSyncPendingReason);
  }

  if (hasReviewStageFeedback && !reasons.includes(attentionFlagLabels.requested_changes)) {
    reasons.push(attentionFlagLabels.requested_changes);
  }
  if (pr.ciState && ["failure", "failed", "error", "timed_out", "action_required", "cancelled"].includes(pr.ciState)) {
    reasons.push(attentionFlagLabels.ci_failed);
  }
  if (pr.mergeStateStatus === "dirty") {
    reasons.push(attentionFlagLabels.merge_conflict);
  }
  if (pr.testingState === "test_changes_requested") {
    reasons.push("Issue testing changes requested");
  }

  return orderedPrAttentionReasons(reasons);
}

interface TeamPrBlockerSnapshot {
  ciFailed: number;
  requestedChanges: number;
  conflicts: number;
  idle: number;
}

function teamPrBlockerSnapshot(prs: PendingPrView[]): TeamPrBlockerSnapshot {
  return {
    ciFailed: prs.filter((pr) => pr.ciState !== null && failedCiStates.has(pr.ciState)).length,
    requestedChanges: prs.filter(prHasReviewStageFeedback).length,
    conflicts: prs.filter((pr) => pr.mergeStateStatus === "dirty").length,
    idle: prs.filter((pr) => pr.attentionFlags.includes("no_human_action_24h")).length
  };
}

function teamPrBlockerDetail(snapshot: TeamPrBlockerSnapshot): string {
  const parts = [
    snapshot.ciFailed > 0 ? `${snapshot.ciFailed} CI` : null,
    snapshot.requestedChanges > 0 ? `${snapshot.requestedChanges} changes` : null,
    snapshot.conflicts > 0 ? `${snapshot.conflicts} conflicts` : null,
    snapshot.idle > 0 ? `${snapshot.idle} idle` : null
  ].filter((part): part is string => part !== null);
  return parts.length === 0 ? "no blockers" : parts.slice(0, 3).join(" | ");
}

function criticalIssueNoHumanAction(issue: Pick<CriticalIssueView, "lastHumanActionAt">, nowIso: string): boolean {
  if (!issue.lastHumanActionAt) {
    return false;
  }
  const timestamp = Date.parse(issue.lastHumanActionAt);
  const now = Date.parse(nowIso);
  if (!Number.isFinite(timestamp) || !Number.isFinite(now)) {
    return false;
  }
  return now - timestamp >= 24 * 60 * 60 * 1000;
}

function hasWebhookSecretWarning(profileWarnings: DashboardSummary["profileWarnings"]): boolean {
  return profileWarnings.some((warning) => warning.key === "webhook:secret_unconfigured");
}

function webhookTrustDetail(data: DashboardSummary): string {
  const webhooks = data.webhooks;
  const failures = webhooks.failedDeliveries + webhooks.normalizationFailedDeliveries;
  if (failures > 0) {
    return `${failures} webhook failed`;
  }
  if (webhooks.staleProcessingDeliveries > 0) {
    return `${webhooks.staleProcessingDeliveries} webhook stale`;
  }
  if (webhooks.pendingDeliveries > 0) {
    return `${webhooks.pendingDeliveries} webhook pending`;
  }
  if (hasWebhookSecretWarning(data.profileWarnings)) {
    return "polling only";
  }
  if (webhooks.processedDeliveries > 0) {
    return "webhook receiving";
  }
  if (webhooks.lastConnectivityProbeAt) {
    return "webhook connected";
  }
  return "webhook waiting";
}

export function testingTurnoverHealthSummary(input: {
  testing: Pick<
    TestingSummary,
    | "queueIssues"
    | "staleQueueIssues"
    | "averageIssueQueueAgeHours"
    | "issueTransitionEvents"
    | "handoffToCloseSamples"
    | "averageHandoffToCloseHours"
  >;
  partialIssueTransitions: number;
}): TestingTurnoverHealthSummary {
  const { testing, partialIssueTransitions } = input;
  const wait = diagnosticDuration(testing.averageIssueQueueAgeHours);
  const close = diagnosticDuration(testing.averageHandoffToCloseHours);
  const sampleEvidence =
    testing.handoffToCloseSamples > 0
      ? `${testing.handoffToCloseSamples} close samples`
      : `${testing.issueTransitionEvents} transition events, no close samples`;
  const dataGapText =
    partialIssueTransitions > 0
      ? `${partialIssueTransitions} timeline gaps can make turnover partial`
      : "timeline evidence complete for visible transitions";

  if (testing.staleQueueIssues > 0) {
    const waitingLabel =
      testing.staleQueueIssues === 1
        ? "1 issue testing item is waiting too long"
        : `${testing.staleQueueIssues} issue testing items are waiting too long`;
    return {
      title: waitingLabel,
      detail: `${testing.queueIssues} in issue testing | avg wait ${wait} | testing-to-close ${close}`,
      evidence: `${sampleEvidence} | ${dataGapText}`,
      tone: "critical"
    };
  }
  if (testing.averageHandoffToCloseHours !== null && testing.averageHandoffToCloseHours >= 48) {
    return {
      title: "Testing close cycle is slow",
      detail: `${testing.handoffToCloseSamples} closed issue samples average ${close}; current wait ${wait}`,
      evidence: dataGapText,
      tone: "attention"
    };
  }
  if (testing.handoffToCloseSamples === 0) {
    return {
      title:
        testing.queueIssues > 0
          ? "Testing queue is active, close efficiency is not proven"
          : "No testing close history yet",
      detail:
        testing.queueIssues > 0
          ? `${testing.queueIssues} in issue testing | avg wait ${wait}; wait for issue close samples before judging turnover`
          : "No visible queue or testing-to-close samples in cache.",
      evidence: dataGapText,
      tone: testing.queueIssues > 0 || partialIssueTransitions > 0 ? "attention" : "normal"
    };
  }
  if (partialIssueTransitions > 0) {
    return {
      title: "Testing turnover has partial timeline evidence",
      detail: `${testing.queueIssues} in issue testing | avg wait ${wait} | testing-to-close ${close}`,
      evidence: dataGapText,
      tone: "attention"
    };
  }
  if (testing.queueIssues > 0) {
    return {
      title: "Testing queue is moving from cached evidence",
      detail: `${testing.queueIssues} in issue testing | avg wait ${wait} | testing-to-close ${close}`,
      evidence: sampleEvidence,
      tone: "normal"
    };
  }
  return {
    title: "Testing queue is clear",
    detail: `testing-to-close ${close} from ${testing.handoffToCloseSamples} closed issue samples`,
    evidence: dataGapText,
    tone: "normal"
  };
}

export function teamOperatingSignals(input: {
  data: DashboardSummary;
  flowSummary: Pick<FlowEfficiencySummary, "averageActiveIssueAgeHours" | "averagePendingPrAgeHours"> | null;
  triageSnapshot?: TeamTriageSnapshot;
}): TeamOperatingSignal[] {
  const { data, flowSummary } = input;
  const triage = input.triageSnapshot ?? teamTriageSnapshot(data);
  const sMinusOneIssues = data.criticalIssues.filter((issue) => issue.severity === "severity/s-1").length;
  const staleActiveIssues = data.criticalIssues.filter(
    (issue) => issue.criticalAgeHours !== null && issue.criticalAgeHours >= 72
  );
  const idleActiveIssues = data.criticalIssues.filter((issue) =>
    criticalIssueNoHumanAction(issue, data.sync.generatedAt)
  );
  const issuesWithoutPr = data.criticalIssues.filter((issue) => issue.linkedPullRequests.length === 0);
  const triageHeavy = triage.needsTriageIssues > data.counts.criticalIssues && data.counts.criticalIssues <= 1;
  const prBlockers = teamPrBlockerSnapshot(data.pendingPrs);
  const dataRiskCount = data.sync.staleObjects + data.sync.partialObjects;
  const webhookFailures = data.webhooks.failedDeliveries + data.webhooks.normalizationFailedDeliveries;
  const webhookDeliveryRiskCount =
    webhookFailures + data.webhooks.staleProcessingDeliveries + data.webhooks.pendingDeliveries;
  const webhookSetupRiskCount =
    webhookDeliveryRiskCount === 0 &&
    (hasWebhookSecretWarning(data.profileWarnings) ||
      (!data.webhooks.lastReceivedAt &&
        !data.webhooks.lastConnectivityProbeAt &&
        data.webhooks.processedDeliveries === 0))
      ? 1
      : 0;
  const trustRiskCount = dataRiskCount + webhookDeliveryRiskCount + webhookSetupRiskCount;
  const webhookNeedsAttention = webhookDeliveryRiskCount > 0 || webhookSetupRiskCount > 0;
  const dataRiskTone =
    data.sync.worker.status === "failed" ||
    data.sync.worker.status === "offline" ||
    webhookFailures > 0 ||
    data.webhooks.staleProcessingDeliveries > 0
      ? "critical"
      : dataRiskCount > 0 ||
          data.sync.worker.status === "stale" ||
          data.webhooks.pendingDeliveries > 0 ||
          webhookSetupRiskCount > 0
        ? "attention"
        : "good";
  const testingCloseText =
    data.testing.averageHandoffToCloseHours === null
      ? `${data.testing.handoffToCloseSamples} close samples`
      : `close ${diagnosticDuration(data.testing.averageHandoffToCloseHours)} (${data.testing.handoffToCloseSamples})`;

  return [
    {
      key: "issue_flow",
      label: "Issue flow",
      value: data.counts.criticalIssues,
      detail: `${idleActiveIssues.length} idle | ${staleActiveIssues.length} >3d | ${issuesWithoutPr.length} no PR | ${
        triage.needsTriageIssues
      } triage | avg ${diagnosticDuration(flowSummary?.averageActiveIssueAgeHours ?? null)}`,
      tone:
        sMinusOneIssues > 0 || idleActiveIssues.length > 0 || staleActiveIssues.length > 0 || issuesWithoutPr.length > 0
          ? "critical"
          : triageHeavy || data.counts.criticalIssues > 0 || triage.needsTriageIssues > 0
            ? "attention"
            : "good",
      target:
        idleActiveIssues.length > 0
          ? "critical_no_action"
          : issuesWithoutPr.length > 0
            ? "critical_without_pr"
            : data.counts.criticalIssues > 0
              ? "critical_issues"
              : triage.needsTriageIssues > 0
                ? "triage"
                : "critical_issues"
    },
    {
      key: "pr_flow",
      label: "PR flow",
      value: data.counts.attentionPrs,
      detail: `${data.counts.pendingPrs} pending | ${teamPrBlockerDetail(prBlockers)} | avg ${diagnosticDuration(
        flowSummary?.averagePendingPrAgeHours ?? null
      )}`,
      tone: data.counts.attentionPrs > 0 ? "attention" : "good",
      target: data.counts.attentionPrs > 0 ? "pr_attention" : "all_prs"
    },
    {
      key: "testing_flow",
      label: "Issue testing",
      value: data.testing.queueIssues,
      detail: `${data.testing.staleQueueIssues} >24h | avg wait ${diagnosticDuration(
        data.testing.averageIssueQueueAgeHours
      )} | ${testingCloseText}`,
      tone: data.testing.staleQueueIssues > 0 ? "critical" : data.testing.queueIssues > 0 ? "attention" : "good",
      target: data.testing.staleQueueIssues > 0 ? "testing_stale" : "testing"
    },
    {
      key: "data_trust",
      label: "Data trust",
      value: trustRiskCount,
      detail: `${data.sync.staleObjects} stale | ${data.sync.partialObjects} incomplete | ${webhookTrustDetail(
        data
      )} | ${data.sync.worker.status}`,
      tone: dataRiskTone,
      target: webhookNeedsAttention ? "webhooks" : "health"
    }
  ];
}

export function testingStateBusinessLabel(state: TestingFlowState): string {
  if (state === "testing") {
    return "issue testing";
  }
  if (state === "test_changes_requested") {
    return "tester feedback";
  }
  if (state === "test_passed") {
    return "issue testing passed";
  }
  if (state === "closed_or_merged") {
    return "linked work closed";
  }
  return "not in issue testing";
}

export function testingStateHelpText(state: TestingFlowState): string {
  if (state === "testing") {
    return "A linked issue is assigned to the configured test team or has the configured issue testing label. PR reviewer or assignee does not start issue testing.";
  }
  if (state === "test_changes_requested") {
    return "Testing feedback is visible on the linked issue; the owner should respond before the issue leaves testing.";
  }
  if (state === "test_passed") {
    return "Cached linked-issue evidence says testing passed.";
  }
  if (state === "closed_or_merged") {
    return "The linked issue or PR is closed or merged in cached evidence.";
  }
  return "No issue-scoped testing signal is visible. PR reviewer or assignee alone does not mean testing.";
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
  const commentEvidenceReason =
    issue.lifecycleState === "deferred" ? deferredCommentEvidenceReason(issue.commentEvidence.state) : null;
  const reasons = [
    issue.lifecycleState === "needs-triage" ? "Waiting triage decision" : null,
    issue.lifecycleState === "deferred" ? "Deferred follow-up" : null,
    commentEvidenceReason,
    issue.severity ? issue.severity : null,
    !issue.isComplete ? "Incomplete cache evidence" : null
  ].filter((reason): reason is string => reason !== null);

  if (reasons.length > 0) {
    return reasons;
  }
  return issue.labels.slice(0, 3);
}

function deferredCommentEvidenceReason(state: PersonalIssueView["commentEvidence"]["state"]): string {
  if (state === "complete") {
    return "Defer comments checked";
  }
  if (state === "error") {
    return "Defer comment sync failed";
  }
  return "Defer comments pending";
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

  for (const issue of person.testingIssues) {
    if (visibleIssueNumbers.has(issue.number)) {
      continue;
    }
    const prs = issue.linkedPullRequests.map((pr) => testingIssuePrDraft(issue, pr)).sort(sortGanttPrDrafts);
    for (const pr of prs) {
      prNumbersShownInIssueRows.add(pr.number);
    }
    visibleIssueNumbers.add(issue.number);
    drafts.push({
      id: `issue:${issue.number}`,
      kind: "issue",
      title: `Issue #${issue.number}`,
      priority: testingIssuePriority(issue),
      tone: testingIssueGanttTone(issue),
      issue: testingIssueDraft(issue),
      prs,
      linkedIssueNumbers: [issue.number]
    });
  }

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

export function observedOwnerThreads(issues: CriticalIssueView[], prs: PendingPrView[]): ObservedOwnerThread[] {
  const prByNumber = new Map(prs.map((pr) => [pr.number, pr]));
  const shownPrNumbers = new Set<number>();
  const threads: ObservedOwnerThread[] = [...issues]
    .sort((left, right) => issuePriority(right) - issuePriority(left))
    .map((issue) => {
      const relatedPrs = new Map<number, PendingPrView>();
      for (const linkedPr of issue.linkedPullRequests) {
        const pr = prByNumber.get(linkedPr.number);
        if (pr) {
          relatedPrs.set(pr.number, pr);
        }
      }
      for (const pr of prs) {
        if (pr.linkedIssueNumbers.includes(issue.number)) {
          relatedPrs.set(pr.number, pr);
        }
      }
      const threadPrs = sortObservedOwnerPrs(Array.from(relatedPrs.values()));
      for (const pr of threadPrs) {
        shownPrNumbers.add(pr.number);
      }
      const blockers = threadPrs.some((pr) => pr.attentionFlags.length > 0);

      return {
        id: `issue:${issue.number}`,
        title: `Issue #${issue.number}`,
        issue,
        prs: threadPrs,
        linkedIssueNumbers: [issue.number],
        tone: issue.severity === "severity/s-1" || blockers ? "critical" : "attention",
        durationHours: issue.criticalAgeHours,
        needsLink: threadPrs.length === 0
      };
    });

  const otherPrs = sortObservedOwnerPrs(prs.filter((pr) => !shownPrNumbers.has(pr.number)));
  if (otherPrs.length > 0) {
    threads.push({
      id: "other-prs",
      title: "Other PR work",
      issue: null,
      prs: otherPrs,
      linkedIssueNumbers: uniqueNumbers(otherPrs.flatMap((pr) => pr.linkedIssueNumbers)),
      tone: otherPrs.some((pr) => pr.attentionFlags.length > 0) ? "attention" : "normal",
      durationHours: Math.max(...otherPrs.map((pr) => pr.ageHours)),
      needsLink: otherPrs.some((pr) => pr.linkedIssueNumbers.length === 0)
    });
  }

  return threads;
}

export function criticalOwnerFlowSummaries(
  threads: ObservedOwnerThread[],
  testingIssues: TestingIssueQueueView[] = []
): CriticalOwnerFlowSummary[] {
  const testingIssueByNumber = new Map(testingIssues.map((issue) => [issue.number, issue]));
  const byOwner = new Map<
    string,
    CriticalOwnerFlowSummary & { criticalAgeTotal: number; criticalAgeSamples: number }
  >();

  for (const thread of threads) {
    if (!thread.issue) {
      continue;
    }

    const issue = thread.issue;
    const key = issue.ownerLogin ? `owner:${issue.ownerLogin}` : "unowned";
    const existing =
      byOwner.get(key) ??
      ({
        key,
        ownerLogin: issue.ownerLogin,
        ownerLabel: issue.ownerLogin ?? "Unowned",
        ownerScope: issue.ownerScope,
        activeIssues: 0,
        sMinusOneIssues: 0,
        sZeroIssues: 0,
        noVisiblePrIssues: 0,
        issuesWithPrBlockers: 0,
        blockedPrs: 0,
        testingIssues: 0,
        staleTestingIssues: 0,
        maxCriticalAgeHours: null,
        averageCriticalAgeHours: null,
        aiLabels: [],
        tone: "normal",
        criticalAgeTotal: 0,
        criticalAgeSamples: 0
      } satisfies CriticalOwnerFlowSummary & { criticalAgeTotal: number; criticalAgeSamples: number });

    const prs = observedOwnerThreadPullRequests(thread);
    const blockedPrNumbers = new Set<number>(
      prs.filter((pr) => prAttentionReasons(pr as PendingPrView).length > 0).map((pr) => pr.number)
    );
    const testingIssue = testingIssueByNumber.get(issue.number) ?? null;

    existing.activeIssues += 1;
    existing.sMinusOneIssues += issue.severity === "severity/s-1" ? 1 : 0;
    existing.sZeroIssues += issue.severity === "severity/s0" ? 1 : 0;
    existing.noVisiblePrIssues += thread.needsLink ? 1 : 0;
    existing.issuesWithPrBlockers += blockedPrNumbers.size > 0 ? 1 : 0;
    existing.blockedPrs += blockedPrNumbers.size;
    existing.testingIssues += testingIssue ? 1 : 0;
    existing.staleTestingIssues +=
      testingIssue && ((testingIssue.queueAgeHours ?? 0) >= 24 || testingIssue.syncError) ? 1 : 0;
    existing.aiLabels = uniqueStrings([...existing.aiLabels, effectiveAiEffortLabel(issue.aiEffortLabel)]);

    if (issue.criticalAgeHours !== null && Number.isFinite(issue.criticalAgeHours)) {
      existing.criticalAgeTotal += issue.criticalAgeHours;
      existing.criticalAgeSamples += 1;
      existing.maxCriticalAgeHours =
        existing.maxCriticalAgeHours === null
          ? issue.criticalAgeHours
          : Math.max(existing.maxCriticalAgeHours, issue.criticalAgeHours);
      existing.averageCriticalAgeHours = Math.round(existing.criticalAgeTotal / existing.criticalAgeSamples);
    }

    existing.tone =
      existing.sMinusOneIssues > 0 || existing.noVisiblePrIssues > 0 || existing.issuesWithPrBlockers > 0
        ? "critical"
        : existing.staleTestingIssues > 0 || existing.testingIssues > 0
          ? "attention"
          : "normal";

    byOwner.set(key, existing);
  }

  return [...byOwner.values()]
    .map(({ criticalAgeTotal: _criticalAgeTotal, criticalAgeSamples: _criticalAgeSamples, ...summary }) => summary)
    .sort(
      (left, right) =>
        criticalOwnerFlowToneRank(right.tone) - criticalOwnerFlowToneRank(left.tone) ||
        right.sMinusOneIssues - left.sMinusOneIssues ||
        right.noVisiblePrIssues - left.noVisiblePrIssues ||
        right.issuesWithPrBlockers - left.issuesWithPrBlockers ||
        right.staleTestingIssues - left.staleTestingIssues ||
        (right.maxCriticalAgeHours ?? -1) - (left.maxCriticalAgeHours ?? -1) ||
        right.activeIssues - left.activeIssues ||
        left.ownerLabel.localeCompare(right.ownerLabel)
    );
}

export function teamCriticalFlowEfficiency(
  threads: ObservedOwnerThread[],
  testingIssues: TestingIssueQueueView[] = []
): TeamCriticalFlowEfficiency {
  const activeThreads = threads.filter((thread) => thread.issue !== null);
  const testingIssueByNumber = new Map(testingIssues.map((issue) => [issue.number, issue]));
  const firstPrLeadTimes: number[] = [];
  const testingLeadTimes: number[] = [];
  const blockedPrNumbers = new Set<number>();
  let issuesWithPr = 0;
  let issuesInTesting = 0;
  let testingCachePendingIssues = 0;

  for (const thread of activeThreads) {
    const issue = thread.issue;
    if (!issue) {
      continue;
    }
    const prs = observedOwnerThreadPullRequests(thread);
    if (prs.length > 0) {
      issuesWithPr += 1;
    }
    for (const pr of prs) {
      if (prAttentionReasons(pr as PendingPrView).length > 0) {
        blockedPrNumbers.add(pr.number);
      }
    }
    const criticalAgeHours = issue.criticalAgeHours;
    if (criticalAgeHours !== null && prs.length > 0) {
      firstPrLeadTimes.push(Math.min(...prs.map((pr) => Math.max(0, criticalAgeHours - pr.ageHours))));
    }

    const testingIssue = testingIssueByNumber.get(issue.number) ?? null;
    if (testingIssue) {
      issuesInTesting += 1;
      if (criticalAgeHours !== null && testingIssue.queueAgeHours !== null) {
        testingLeadTimes.push(Math.max(0, criticalAgeHours - testingIssue.queueAgeHours));
      } else {
        testingCachePendingIssues += 1;
      }
    }
  }

  return {
    activeIssues: activeThreads.length,
    issuesWithPr,
    issuesWithoutPr: Math.max(0, activeThreads.length - issuesWithPr),
    issuesInTesting,
    blockedPrs: blockedPrNumbers.size,
    averageActiveToFirstPrHours: average(firstPrLeadTimes),
    averageActiveToTestingHours: average(testingLeadTimes),
    testingCachePendingIssues
  };
}

function criticalOwnerFlowToneRank(tone: CriticalOwnerFlowTone): number {
  if (tone === "critical") {
    return 3;
  }
  if (tone === "attention") {
    return 2;
  }
  return 1;
}

function observedOwnerThreadPullRequests(
  thread: ObservedOwnerThread
): Array<PendingPrView | CriticalIssueLinkedPullRequestView> {
  const byNumber = new Map<number, PendingPrView | CriticalIssueLinkedPullRequestView>();
  for (const pr of thread.issue?.linkedPullRequests ?? []) {
    byNumber.set(pr.number, pr);
  }
  for (const pr of thread.prs) {
    byNumber.set(pr.number, pr);
  }
  return [...byNumber.values()].sort(
    (left, right) =>
      right.attentionFlags.length - left.attentionFlags.length ||
      right.ageHours - left.ageHours ||
      left.number - right.number
  );
}

function sortObservedOwnerPrs(prs: PendingPrView[]): PendingPrView[] {
  return [...prs].sort(
    (left, right) =>
      right.attentionFlags.length - left.attentionFlags.length ||
      right.ageHours - left.ageHours ||
      left.number - right.number
  );
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

function testingIssueDraft(issue: TestingIssueQueueView): PersonalGanttIssueDraft {
  const durationHours = issue.queueAgeHours;
  return {
    number: issue.number,
    title: issue.title,
    htmlUrl: issue.htmlUrl,
    tone: testingIssueGanttTone(issue),
    severity: null,
    lifecycleState: null,
    aiEffortLabel: null,
    durationHours,
    durationKind: "testing_queue",
    durationEvidence: testingIssueQueueAgeEvidenceText(issue.queueAgeEvidence),
    reasons: testingIssueReasons(issue),
    isComplete: issue.isComplete,
    startAgeHours: Math.max(durationHours ?? 0, 0),
    endAgeHours: 0
  };
}

function testingIssueQueueAgeEvidenceText(evidence: TestingIssueQueueView["queueAgeEvidence"]): string {
  if (evidence === "issue_assignment_event") {
    return "GitHub issue assignment event";
  }
  if (evidence === "issue_label_event") {
    return "GitHub issue label event";
  }
  return "Issue cache timestamp";
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

function testingIssuePrDraft(
  issue: TestingIssueQueueView,
  pr: TestingIssueQueueView["linkedPullRequests"][number]
): PersonalGanttPrDraft {
  const reasons = testingIssueLinkedPrReasons(pr);
  return {
    number: pr.number,
    title: pr.title,
    htmlUrl: pr.htmlUrl,
    ownerLogin: pr.ownerLogin,
    state: "open",
    tone: reasons.length > 0 ? "attention" : "normal",
    reviewDecision: pr.reviewDecision,
    mergeStateStatus: pr.mergeStateStatus,
    ciState: pr.ciState,
    testingState: "testing",
    testingQueueAgeHours: issue.queueAgeHours,
    attentionFlags: pr.attentionFlags,
    linkedIssueNumbers: [issue.number],
    reasons,
    isShared: false,
    isComplete: pr.isComplete,
    startAgeHours: Math.max(pr.ageHours, 0),
    endAgeHours: 0
  };
}

function testingIssuePriority(issue: TestingIssueQueueView): number {
  return testingIssueGanttTone(issue) === "critical" ? 850 : 760;
}

function testingIssueGanttTone(issue: TestingIssueQueueView): PersonalGanttTone {
  if ((issue.queueAgeHours ?? 0) >= 24 || issue.syncError !== null) {
    return "critical";
  }
  if (!issue.isComplete || issue.linkedPullRequests.some((pr) => testingIssueLinkedPrReasons(pr).length > 0)) {
    return "attention";
  }
  return "normal";
}

function testingIssueReasons(issue: TestingIssueQueueView): string[] {
  return uniqueStrings(
    [
      "Issue testing",
      issue.queueAgeHours !== null && issue.queueAgeHours >= 24 ? "Issue testing wait over 24h" : null,
      issue.queueAgeEvidence === "issue_cache_timestamp" ? "Issue testing start from issue cache timestamp" : null,
      issue.testers.length > 0 ? `${issue.testers.length} tester${issue.testers.length === 1 ? "" : "s"}` : null,
      issue.testingSignals.some((signal) => signal.startsWith("issue_label:")) ? "Issue label testing signal" : null,
      issue.linkedPullRequests.length === 0 ? "No linked PR visible" : null,
      issue.syncError ? "Issue sync error" : null,
      !issue.isComplete ? "Incomplete cache evidence" : null
    ].filter((reason): reason is string => reason !== null)
  );
}

function testingIssueLinkedPrReasons(pr: TestingIssueQueueView["linkedPullRequests"][number]): string[] {
  const hasPreReviewBlocker =
    pr.mergeStateStatus === "dirty" || (pr.ciState !== null && failedCiStates.has(pr.ciState));
  const hasReviewStageFeedback = prHasReviewStageFeedback(pr);
  return orderedPrAttentionReasons(
    [
      ...pr.attentionFlags
        .filter(
          (flag) =>
            !(flag === "review_requested_no_response" && (hasPreReviewBlocker || hasReviewStageFeedback)) &&
            !(flag === "requested_changes" && !hasReviewStageFeedback)
        )
        .map((flag) => attentionFlagLabels[flag] ?? flag.replaceAll("_", " ")),
      hasReviewStageFeedback ? attentionFlagLabels.requested_changes : null,
      pr.ciState && failedCiStates.has(pr.ciState) ? attentionFlagLabels.ci_failed : null,
      pr.mergeStateStatus === "dirty" ? attentionFlagLabels.merge_conflict : null,
      !pr.isComplete ? "PR detail sync pending" : null
    ].filter((reason): reason is string => reason !== null)
  );
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
  const hasReviewStageFeedback = prHasReviewStageFeedback(pr);
  const reasons = pr.attentionFlags
    .filter(
      (flag) =>
        !(
          flag === "review_requested_no_response" &&
          (prHasPreReviewBlocker(pr) || prReviewEvidencePending(pr) || hasReviewStageFeedback)
        ) &&
        !(flag === "requested_changes" && !hasReviewStageFeedback)
    )
    .map((flag) => attentionFlagLabels[flag] ?? flag.replaceAll("_", " "));
  if (prReviewEvidencePending(pr)) {
    reasons.push(prDetailSyncPendingReason);
  }
  if (hasReviewStageFeedback) {
    reasons.push(attentionFlagLabels.requested_changes);
  }
  if (pr.ciState && failedCiStates.has(pr.ciState)) {
    reasons.push(attentionFlagLabels.ci_failed);
  }
  if (pr.mergeStateStatus === "dirty") {
    reasons.push(attentionFlagLabels.merge_conflict);
  }
  if (pr.testingState === "test_changes_requested") {
    reasons.push("Issue testing changes requested");
  }
  if (pr.testingQueueAgeHours !== null && pr.testingQueueAgeHours >= 24) {
    reasons.push("Issue testing wait over 24h");
  }
  return orderedPrAttentionReasons(reasons);
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
  const itemIndexById = new Map<string, number>();
  const add = (item: PersonalActivityItem): void => {
    const existingIndex = itemIndexById.get(item.id);
    if (existingIndex !== undefined) {
      const existing = items[existingIndex];
      items[existingIndex] = mergePersonalActivityItem(existing, item);
      return;
    }
    itemIndexById.set(item.id, items.length);
    items.push(item);
  };

  for (const issue of person.activeCriticalIssues) {
    add(activityFromIssue(issue, "Active s-1/s0", "critical", 1_000 + severityPriority(issue.severity)));
  }
  for (const pr of person.attentionPrs) {
    add(activityFromPullRequest(pr, "PR attention", "attention", 900, prAttentionReasons(pr)));
  }
  for (const issue of person.testingIssues) {
    add(activityFromTestingIssue(issue));
  }
  for (const pr of person.testingPrs) {
    add(
      activityFromPullRequest(pr, "Linked issue in testing", "attention", 780, [
        ...prAttentionReasons(pr),
        pr.testingQueueAgeHours !== null ? "Linked issue testing wait visible" : "Linked issue testing status visible"
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

function mergePersonalActivityItem(
  existing: PersonalActivityItem,
  duplicate: PersonalActivityItem
): PersonalActivityItem {
  return {
    ...existing,
    ageHours: Math.max(existing.ageHours, duplicate.ageHours),
    linkedIssueNumbers: uniqueNumbers([...existing.linkedIssueNumbers, ...duplicate.linkedIssueNumbers]),
    linkedPullRequestNumbers: uniqueNumbers([
      ...existing.linkedPullRequestNumbers,
      ...duplicate.linkedPullRequestNumbers
    ]),
    reasons: uniqueStrings([...existing.reasons, ...duplicate.reasons, duplicatePhaseReason(duplicate.phase)]),
    isComplete: existing.isComplete && duplicate.isComplete
  };
}

function duplicatePhaseReason(phase: string): string {
  return `Also ${phase.charAt(0).toLowerCase()}${phase.slice(1)}`;
}

export function personalActivityHasBlockingSignal(item: PersonalActivityItem): boolean {
  if (item.objectType === "issue") {
    return (
      (item.tone === "critical" && (item.linkedPullRequestNumbers.length === 0 || !item.isComplete)) ||
      item.durationKind === "testing_queue"
    );
  }
  const reasons = item.reasons.map((reason) => reason.toLowerCase());
  return (
    reasons.some(
      (reason) =>
        reason.includes("ci failed") ||
        reason.includes("changes requested") ||
        reason.includes("merge conflict") ||
        reason.includes("no human action") ||
        reason.includes("testing") ||
        reason.includes("test wait")
    ) ||
    prHasReviewStageFeedback(item) ||
    item.mergeStateStatus === "dirty" ||
    item.testingState === "test_changes_requested" ||
    item.testingQueueAgeHours !== null
  );
}

export function personalActivityNeedsLink(item: PersonalActivityItem): boolean {
  if (item.objectType === "issue") {
    return (
      (item.tone === "critical" && item.linkedPullRequestNumbers.length === 0) ||
      (item.durationKind === "testing_queue" && item.linkedPullRequestNumbers.length === 0)
    );
  }
  return item.objectType === "pull_request" && item.linkedIssueNumbers.length === 0;
}

export function personalActionQueueItemsForFilter(
  items: PersonalActivityItem[],
  filter: PersonalActionQueueFilter
): PersonalActivityItem[] {
  if (filter === "critical") {
    return items.filter((item) => item.tone === "critical");
  }
  if (filter === "pr_blockers") {
    return items.filter((item) => item.objectType === "pull_request" && personalActivityHasBlockingSignal(item));
  }
  if (filter === "issues") {
    return items.filter((item) => item.objectType === "issue");
  }
  if (filter === "testing") {
    return items.filter((item) => item.durationKind === "testing_queue" || item.testingQueueAgeHours !== null);
  }
  if (filter === "prs") {
    return items.filter((item) => item.objectType === "pull_request");
  }
  if (filter === "needs_link") {
    return items.filter(personalActivityNeedsLink);
  }
  return items;
}

export function personalActionQueueCounts(items: PersonalActivityItem[]): PersonalActionQueueCounts {
  return {
    all: items.length,
    critical: personalActionQueueItemsForFilter(items, "critical").length,
    pr_blockers: personalActionQueueItemsForFilter(items, "pr_blockers").length,
    issues: personalActionQueueItemsForFilter(items, "issues").length,
    testing: personalActionQueueItemsForFilter(items, "testing").length,
    prs: personalActionQueueItemsForFilter(items, "prs").length,
    needs_link: personalActionQueueItemsForFilter(items, "needs_link").length
  };
}

export function personalActivityNextAction(item: PersonalActivityItem): string {
  if (item.objectType === "issue") {
    if (item.durationKind === "testing_queue") {
      if (item.linkedPullRequestNumbers.length === 0) {
        return "Link the tested PR";
      }
      if ((item.testingQueueAgeHours ?? 0) >= 24) {
        return "Check issue testing status";
      }
      return "Track issue testing result";
    }
    if (item.lifecycleState === "needs-triage") {
      return "Decide s-1/s0 or defer";
    }
    if (item.lifecycleState === "deferred") {
      const deferredEvidence = item.reasons.find((reason) => reason.startsWith("Defer comment"));
      if (deferredEvidence?.includes("failed")) {
        return "Fix comment sync";
      }
      if (deferredEvidence?.includes("pending")) {
        return "Backfill issue comments";
      }
      return "Review defer reason";
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
  if (reasons.some((reason) => reason.includes("merge conflict"))) {
    return "Resolve merge conflict";
  }
  if (reasons.some((reason) => reason.includes("ci failed"))) {
    return "Fix failing CI";
  }
  if (reasons.some((reason) => reason.includes("changes requested"))) {
    return "Address requested changes";
  }
  if (reasons.some((reason) => reason.includes("pr detail sync pending"))) {
    return "Refresh PR evidence";
  }
  if (item.testingState === "test_changes_requested") {
    return "Respond to test feedback";
  }
  if (item.testingQueueAgeHours !== null || ["testing", "test_changes_requested"].includes(item.testingState ?? "")) {
    return "Check linked issue testing status";
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
  if (item.lifecycleState === "deferred") {
    const deferredEvidence = item.reasons.find((reason) => reason.startsWith("Defer comment"));
    if (deferredEvidence) {
      return deferredEvidence;
    }
  }
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
    return input.durationKind === "critical_active" ? "s-1/s0 unknown" : "unknown";
  }
  if (input.durationKind === "critical_active") {
    return `s-1/s0 ${durationHoursText(input.durationHours)}`;
  }
  if (input.durationKind === "pr_age") {
    return `PR ${durationHoursText(input.durationHours)}`;
  }
  if (input.durationKind === "testing_queue") {
    return `issue testing ${durationHoursText(input.durationHours)}`;
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
  if (row.issue.durationKind === "testing_queue") {
    if (row.prs.length === 0) {
      return "Link the tested PR";
    }
    if ((row.issue.durationHours ?? 0) >= 24) {
      return "Check issue testing status";
    }
    return "Track issue testing result";
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
    return "Check linked issue testing status";
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
  if (
    row.issue.durationKind !== "testing_queue" &&
    row.prs.some((pr) => pr.testingQueueAgeHours !== null && pr.testingQueueAgeHours >= 24)
  ) {
    warnings.push("linked issue testing wait over 24h");
  }
  if (row.issue.durationKind === "testing_queue" && (row.issue.durationHours ?? 0) >= 24) {
    warnings.push("issue testing wait over 24h");
  }
  if (row.prs.some((pr) => pr.linkedIssueNumbers.length === 0)) {
    warnings.push("PR issue link missing");
  }
  return uniqueStrings(warnings);
}

export function flowThreadStatusCounts(row: PersonalGanttRow): FlowThreadStatusCounts {
  return {
    prs: row.prs.length,
    blockedPrs: row.prs.filter((pr) => pr.tone === "attention" || pr.reasons.length > 0).length,
    testingIssues: row.issue.durationKind === "testing_queue" ? 1 : 0,
    testingPrs: row.prs.filter((pr) => pr.testingQueueAgeHours !== null || pr.testingState !== "not_ready").length,
    sharedPrs: row.prs.filter((pr) => pr.isShared).length,
    unlinkedPrs: row.prs.filter((pr) => pr.linkedIssueNumbers.length === 0).length
  };
}

export function personalFlowThreadMatchesFilter(row: PersonalGanttRow, filter: PersonalFlowThreadFilter): boolean {
  if (filter === "all") {
    return true;
  }
  const counts = flowThreadStatusCounts(row);
  if (filter === "critical") {
    return row.tone === "critical";
  }
  if (filter === "blocked") {
    return counts.blockedPrs > 0 || flowThreadDurationWarnings(row).length > 0;
  }
  if (filter === "testing") {
    return counts.testingIssues > 0 || counts.testingPrs > 0;
  }
  if (filter === "needs_link") {
    return (row.kind === "issue" && row.prs.length === 0) || counts.unlinkedPrs > 0;
  }
  return counts.sharedPrs > 0;
}

export function personalFlowThreadCounts(rows: PersonalGanttRow[]): PersonalFlowThreadCounts {
  return {
    all: rows.length,
    critical: rows.filter((row) => personalFlowThreadMatchesFilter(row, "critical")).length,
    blocked: rows.filter((row) => personalFlowThreadMatchesFilter(row, "blocked")).length,
    testing: rows.filter((row) => personalFlowThreadMatchesFilter(row, "testing")).length,
    needs_link: rows.filter((row) => personalFlowThreadMatchesFilter(row, "needs_link")).length,
    shared: rows.filter((row) => personalFlowThreadMatchesFilter(row, "shared")).length
  };
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
    ownerScope: criticalIssue ? issue.ownerScope : null,
    ownerReason: criticalIssue ? issue.ownerReason : null,
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

function activityFromTestingIssue(issue: TestingIssueQueueView): PersonalActivityItem {
  const reasons = testingIssueReasons(issue);
  const linkedPullRequestNumbers = issue.linkedPullRequests.map((pr) => pr.number);
  return {
    id: `testing_issue:${issue.number}`,
    objectType: "issue",
    number: issue.number,
    title: issue.title,
    htmlUrl: issue.htmlUrl,
    ownerLogin: issue.testers[0] ?? null,
    ownerScope: null,
    ownerReason: null,
    phase: "Issue in test",
    tone: testingIssueGanttTone(issue) === "critical" ? "critical" : "attention",
    priority: testingIssuePriority(issue),
    ageHours: issue.queueAgeHours ?? 0,
    durationHours: issue.queueAgeHours,
    durationKind: "testing_queue",
    durationEvidence: testingIssueQueueAgeEvidenceText(issue.queueAgeEvidence),
    lastHumanActionAt: null,
    testingQueueAgeHours: issue.queueAgeHours,
    severity: null,
    lifecycleState: null,
    reviewDecision: null,
    ciState: null,
    mergeStateStatus: null,
    testingState: "testing",
    linkedIssueNumbers: [],
    linkedPullRequestNumbers,
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
    ownerScope: null,
    ownerReason: null,
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

function diagnosticDuration(value: number | null): string {
  return value === null ? "unknown" : durationHoursText(value);
}

function percentDiagnostic(value: number | null): string {
  return value === null ? "n/a" : `${value}%`;
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

function comparePrCriticalIssueContext(left: PrCriticalIssueContext, right: PrCriticalIssueContext): number {
  const severityDelta = severityPriority(right.severity) - severityPriority(left.severity);
  if (severityDelta !== 0) {
    return severityDelta;
  }
  const blockerDelta = right.blockerCount - left.blockerCount;
  if (blockerDelta !== 0) {
    return blockerDelta;
  }
  const ageDelta = (right.criticalAgeHours ?? -1) - (left.criticalAgeHours ?? -1);
  if (ageDelta !== 0) {
    return ageDelta;
  }
  return left.number - right.number;
}

function isTestingQueuePullRequest(pr: FlowEfficiencyPullRequest): boolean {
  return pr.testingQueueAgeHours !== null || ["testing", "test_changes_requested"].includes(pr.testingState);
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

function average(values: Array<number | null | undefined>): number | null {
  const finiteValues = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (finiteValues.length === 0) {
    return null;
  }
  const total = finiteValues.reduce((sum, value) => sum + value, 0);
  return Math.round((total / finiteValues.length) * 10) / 10;
}
