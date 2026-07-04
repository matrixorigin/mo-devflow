import type {
  AggregatedMetricPoint,
  AiDriftSignal,
  AiDriftSignalView,
  AnalyticsSummary,
  AttentionSeverity,
  CacheObjectEvidenceView,
  CriticalIssueBlockerView,
  CriticalIssueView,
  CriticalIssueLinkedPullRequestView,
  CriticalIssueOwnerScope,
  CriticalOwnerCoverageView,
  DailyMetricPoint,
  DashboardVisibility,
  DashboardSummary,
  NormalizedIssue,
  NormalizedIssueComment,
  NormalizedIssueTimelineEvent,
  NormalizedPullRequest,
  NotificationTraceView,
  PendingPrView,
  PersonalActionView,
  PersonalIssueView,
  PersonalPullRequestView,
  PersonSummary,
  ProfileActionSuggestion,
  ProfileConfigurationWarning,
  ProfileSetupCapability,
  ProfileSetupPlan,
  RepoProfile,
  SyncHealth,
  SyncHealthLayer,
  SyncHealthStatus,
  TestingIssueTransitionView,
  TestingIssueQueueView,
  TestingSummary,
  TestingTransitionView,
  WorkerHealth,
  WorkflowViolation,
  WorkflowViolationView,
  WriteActionExecutionView
} from "@mo-devflow/shared";
import { extractLinkedIssueNumbers, parseJsonArray, parseJsonRecord, syncHealthLayers } from "@mo-devflow/shared";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { createHash } from "node:crypto";
import { activeCacheStaleSummarySql } from "./cacheHealthSql";
import { fromSqlDate, getPool, nowSql, sqlDate } from "./client";
import { getJobQueueHealth } from "./jobs";
import { getNotificationHealth, notificationRecipientScope } from "./notifications";
import { addDaysToDateKey, calendarDayRangeInTimezone, dateKeyInTimezone, previousCalendarDayRange } from "./time";
import { dashboardVisibilityFilter, visibleClassesForDashboard, type DashboardViewer } from "./visibility";
import { getWebhookIngestionHealth } from "./webhooks";
import { getWorkerHealth } from "./workerHealth";
import { listWriteActionExecutionsForDashboard } from "./writeActions";

export { extractLinkedIssueNumbers } from "@mo-devflow/shared";
export { calendarDayRangeInTimezone, dateKeyInTimezone, previousCalendarDayRange } from "./time";
export { dashboardVisibilityFilter, visibleClassesForDashboard, type DashboardViewer } from "./visibility";

interface RowData extends RowDataPacket {
  [key: string]: unknown;
}

export interface PullRequestTestingTransitionEvent {
  repoId: number;
  prNumber: number;
  fromState: NormalizedPullRequest["testingState"];
  toState: NormalizedPullRequest["testingState"];
  testingTesters: string[];
  testingSignals: string[];
  occurredAt: string;
  sourceCompleteness: "complete_cache" | "partial_cache";
  sourceAuthType: NormalizedPullRequest["sourceAuthType"];
  sourceUserId: number | null;
  visibilityClass: NormalizedPullRequest["visibilityClass"];
  dedupeKey: string;
}

export interface PullRequestTestingTransitionEventView extends PullRequestTestingTransitionEvent {
  id: number;
  createdAt: string;
}

export interface IssueCommentBackfillCandidate {
  issueNumber: number;
  objectType: "issue" | "pull_request";
  visibilityClass: NormalizedIssue["visibilityClass"];
  sourceUpdatedAt: string;
  lastCommentSyncedAt: string | null;
}

export interface IssueTimelineBackfillCandidate {
  issueNumber: number;
  visibilityClass: NormalizedIssue["visibilityClass"];
  sourceUpdatedAt: string;
  lastTimelineSyncedAt: string | null;
}

type IssueTimelineBackfillCandidateRow = Record<string, unknown>;

function stringify(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asNumber(value: unknown): number {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "bigint") {
    return Number(value);
  }
  if (typeof value === "string") {
    return Number(value);
  }
  return 0;
}

function asBoolean(value: unknown): boolean {
  return asNumber(value) === 1;
}

function severityRankSql(column: string, severities: readonly string[]): string {
  return `CASE ${column} ${severities.map((_, index) => `WHEN ? THEN ${index}`).join(" ")} ELSE ${
    severities.length
  } END`;
}

function mergeUnique(left: string[], right: string[]): string[] {
  return Array.from(new Set([...left, ...right]));
}

function uniqueIssueNumbers(values: number[]): number[] {
  return Array.from(new Set(values.filter((value) => Number.isInteger(value) && value > 0))).sort(
    (left, right) => left - right
  );
}

function parseJsonNumberArray(value: unknown): number[] {
  if (typeof value !== "string" || value.length === 0) {
    return [];
  }
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return uniqueIssueNumbers(parsed.map((item) => (typeof item === "number" ? item : Number(item))));
  } catch {
    return [];
  }
}

export function pullRequestWithPreservedInsight(input: {
  current: NormalizedPullRequest;
  previous: Record<string, unknown> | null | undefined;
}): NormalizedPullRequest {
  if (input.current.state !== "open" || input.current.detailSyncedAt || input.current.detailError) {
    return input.current;
  }
  const previousDetailSyncedAt = fromSqlDate(input.previous?.detail_synced_at);
  if (!previousDetailSyncedAt || !asBoolean(input.previous?.is_complete)) {
    return input.current;
  }
  const previousDetailError = input.previous?.detail_error ? asString(input.previous.detail_error) : null;
  return {
    ...input.current,
    lastHumanActionAt: fromSqlDate(input.previous?.last_human_action_at) ?? input.current.lastHumanActionAt,
    reviewDecision: input.previous?.review_decision ? asString(input.previous.review_decision) : null,
    mergeStateStatus: input.previous?.merge_state_status ? asString(input.previous.merge_state_status) : null,
    ciState: input.previous?.ci_state ? asString(input.previous.ci_state) : null,
    latestReviewState: input.previous?.latest_review_state ? asString(input.previous.latest_review_state) : null,
    latestReviewSubmittedAt: fromSqlDate(input.previous?.latest_review_submitted_at),
    latestCommitAt: fromSqlDate(input.previous?.latest_commit_at),
    detailSyncedAt: previousDetailSyncedAt,
    detailError: previousDetailError,
    attentionFlags: mergeUnique(
      input.current.attentionFlags,
      parseJsonArray(asString(input.previous?.attention_flags_json))
    ),
    linkedIssueNumbers: uniqueIssueNumbers([
      ...input.current.linkedIssueNumbers,
      ...parseJsonNumberArray(input.previous?.linked_issue_numbers_json)
    ]),
    isComplete: !previousDetailError
  };
}

function testingTransitionOccurredAt(pr: NormalizedPullRequest): string {
  if (pr.testingState === "closed_or_merged") {
    return pr.mergedAt ?? pr.closedAt ?? pr.updatedAt;
  }
  if (pr.testingState === "test_passed" || pr.testingState === "test_changes_requested") {
    return pr.latestReviewSubmittedAt ?? pr.lastHumanActionAt;
  }
  return pr.lastHumanActionAt || pr.updatedAt;
}

function hasConfirmedTestingEvidence(pr: NormalizedPullRequest): boolean {
  return pr.testingTesters.length > 0 || pr.testingSignals.some((signal) => signal !== "closed_or_merged");
}

export function pullRequestTestingTransitionForUpsert(input: {
  repoId: number;
  previousTestingState: NormalizedPullRequest["testingState"] | null;
  hasExistingTestingEvents?: boolean;
  pr: NormalizedPullRequest;
}): PullRequestTestingTransitionEvent | null {
  const firstObservedTestingState =
    input.previousTestingState === input.pr.testingState &&
    !input.hasExistingTestingEvents &&
    input.pr.testingState !== "not_ready" &&
    hasConfirmedTestingEvidence(input.pr);
  const fromState = firstObservedTestingState ? "not_ready" : (input.previousTestingState ?? "not_ready");
  const toState = input.pr.testingState;
  if (fromState === toState) {
    return null;
  }
  if (!input.previousTestingState && toState === "not_ready") {
    return null;
  }
  if (!input.previousTestingState && !hasConfirmedTestingEvidence(input.pr)) {
    return null;
  }
  const occurredAt = testingTransitionOccurredAt(input.pr);
  return {
    repoId: input.repoId,
    prNumber: input.pr.number,
    fromState,
    toState,
    testingTesters: input.pr.testingTesters,
    testingSignals: input.pr.testingSignals,
    occurredAt,
    sourceCompleteness: input.pr.isComplete ? "complete_cache" : "partial_cache",
    sourceAuthType: input.pr.sourceAuthType,
    sourceUserId: input.pr.sourceUserId,
    visibilityClass: input.pr.visibilityClass,
    dedupeKey: `${input.repoId}:pr:${input.pr.number}:testing:${fromState}:${toState}:${occurredAt}`
  };
}

export function testingTransitionViewFromRow(row: Record<string, unknown>): TestingTransitionView {
  return {
    id: asNumber(row.id),
    prNumber: asNumber(row.pr_number),
    fromState: asString(row.from_state) as TestingTransitionView["fromState"],
    toState: asString(row.to_state) as TestingTransitionView["toState"],
    testingTesters: parseJsonArray(asString(row.testing_testers_json)),
    testingSignals: parseJsonArray(asString(row.testing_signals_json)),
    occurredAt: fromSqlDate(row.occurred_at) ?? new Date().toISOString(),
    sourceCompleteness: asString(row.source_completeness) === "complete_cache" ? "complete_cache" : "partial_cache"
  };
}

export function testingTransitionBelongsToProfile(profile: RepoProfile, transition: TestingTransitionView): boolean {
  return transition.testingSignals.some((signal) => testingSignalBelongsToProfile(profile, signal));
}

export function testingTransitionsForProfile(
  profile: RepoProfile,
  transitions: TestingTransitionView[]
): TestingTransitionView[] {
  return transitions.filter((transition) => testingTransitionBelongsToProfile(profile, transition));
}

export function recentTestingTransitionsForProfile(
  profile: RepoProfile,
  transitions: TestingTransitionView[],
  limit = 12
): TestingTransitionView[] {
  return testingTransitionsForProfile(profile, transitions)
    .sort((left, right) => {
      const occurredDelta = new Date(right.occurredAt).getTime() - new Date(left.occurredAt).getTime();
      if (occurredDelta !== 0) {
        return occurredDelta;
      }
      return right.id - left.id;
    })
    .slice(0, limit);
}

export function testingIssueTransitionsFromQueueIssues(
  issues: TestingIssueQueueView[],
  limit = 12
): TestingIssueTransitionView[] {
  return issues
    .map((issue) => {
      const testers = uniqueValues(issue.testers);
      return {
        id: -issue.number,
        issueNumber: issue.number,
        fromState: "not_ready" as const,
        toState: "testing" as const,
        testingTesters: testers,
        testingSignals: testers.map((tester) => `issue_assignee:#${issue.number}:${tester}`),
        occurredAt: issue.queueStartedAt ?? issue.lastSyncedAt,
        sourceCompleteness:
          issue.queueAgeEvidence === "issue_assignment_event" ? ("complete_cache" as const) : ("partial_cache" as const)
      };
    })
    .sort((left, right) => {
      const occurredDelta = new Date(right.occurredAt).getTime() - new Date(left.occurredAt).getTime();
      if (occurredDelta !== 0) {
        return occurredDelta;
      }
      return right.id - left.id;
    })
    .slice(0, limit);
}

function testingSignalBelongsToProfile(profile: RepoProfile, signal: string): boolean {
  const issueAssignee = signal.match(/^issue_assignee:#\d+:(.+)$/);
  return Boolean(issueAssignee && normalizedLoginSet(profile.people.testers).has(normalizedLogin(issueAssignee[1])));
}

type TestingTurnoverMetrics = Pick<
  TestingSummary,
  | "requestToPassSamples"
  | "passToCloseSamples"
  | "closedWithoutPassSignalSamples"
  | "averageRequestToPassHours"
  | "averagePassToCloseHours"
>;

function emptyTestingTurnoverMetrics(): TestingTurnoverMetrics {
  return {
    requestToPassSamples: 0,
    passToCloseSamples: 0,
    closedWithoutPassSignalSamples: 0,
    averageRequestToPassHours: null,
    averagePassToCloseHours: null
  };
}

function transitionHoursBetween(start: string | null, end: string | null): number | null {
  if (!start || !end) {
    return null;
  }
  const startTime = new Date(start).getTime();
  const endTime = new Date(end).getTime();
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime < startTime) {
    return null;
  }
  return Math.round(((endTime - startTime) / 3_600_000) * 10) / 10;
}

function roundedAverage(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10;
}

function turnoverDurationsForPullRequest(transitions: TestingTransitionView[]): {
  requestToPassHours: number[];
  passToCloseHours: number[];
  closedWithoutPassSignalSamples: number;
} {
  const ordered = [...transitions].sort((left, right) => {
    const timeOrder = new Date(left.occurredAt).getTime() - new Date(right.occurredAt).getTime();
    return timeOrder === 0 ? left.id - right.id : timeOrder;
  });
  const requestToPassHours: number[] = [];
  const passToCloseHours: number[] = [];
  let closedWithoutPassSignalSamples = 0;
  let requestedAt: string | null = null;
  let passedAt: string | null = null;
  for (const transition of ordered) {
    if (!requestedAt && ["test_requested", "testing", "test_changes_requested"].includes(transition.toState)) {
      requestedAt = transition.occurredAt;
    }
    if (!passedAt && transition.toState === "test_passed") {
      passedAt = transition.occurredAt;
    }
    if (transition.toState === "closed_or_merged") {
      const passToClose = transitionHoursBetween(passedAt, transition.occurredAt);
      if (passToClose !== null) {
        passToCloseHours.push(passToClose);
      } else if (
        !passedAt &&
        (requestedAt !== null || ["test_requested", "testing", "test_changes_requested"].includes(transition.fromState))
      ) {
        closedWithoutPassSignalSamples += 1;
      }
    }
  }
  const requestToPass = transitionHoursBetween(requestedAt, passedAt);
  if (requestToPass !== null) {
    requestToPassHours.push(requestToPass);
  }
  return { requestToPassHours, passToCloseHours, closedWithoutPassSignalSamples };
}

function metricsFromDurations(
  requestToPassHours: number[],
  passToCloseHours: number[],
  closedWithoutPassSignalSamples: number
): TestingTurnoverMetrics {
  return {
    requestToPassSamples: requestToPassHours.length,
    passToCloseSamples: passToCloseHours.length,
    closedWithoutPassSignalSamples,
    averageRequestToPassHours: roundedAverage(requestToPassHours),
    averagePassToCloseHours: roundedAverage(passToCloseHours)
  };
}

function transitionsByPullRequest(transitions: TestingTransitionView[]): Map<number, TestingTransitionView[]> {
  const byPullRequest = new Map<number, TestingTransitionView[]>();
  for (const transition of transitions) {
    const entries = byPullRequest.get(transition.prNumber) ?? [];
    entries.push(transition);
    byPullRequest.set(transition.prNumber, entries);
  }
  return byPullRequest;
}

export function testingTurnoverMetricsFromTransitions(transitions: TestingTransitionView[]): TestingTurnoverMetrics {
  const requestToPassHours: number[] = [];
  const passToCloseHours: number[] = [];
  let closedWithoutPassSignalSamples = 0;
  for (const entries of transitionsByPullRequest(transitions).values()) {
    const durations = turnoverDurationsForPullRequest(entries);
    requestToPassHours.push(...durations.requestToPassHours);
    passToCloseHours.push(...durations.passToCloseHours);
    closedWithoutPassSignalSamples += durations.closedWithoutPassSignalSamples;
  }
  return metricsFromDurations(requestToPassHours, passToCloseHours, closedWithoutPassSignalSamples);
}

export function testingTurnoverMetricsByTesterFromTransitions(
  transitions: TestingTransitionView[]
): Map<string, TestingTurnoverMetrics> {
  const requestToPassByTester = new Map<string, number[]>();
  const passToCloseByTester = new Map<string, number[]>();
  const closedWithoutPassByTester = new Map<string, number>();

  for (const entries of transitionsByPullRequest(transitions).values()) {
    const testers = Array.from(new Set(entries.flatMap((transition) => transition.testingTesters))).sort();
    const durations = turnoverDurationsForPullRequest(entries);
    for (const tester of testers) {
      requestToPassByTester.set(tester, [
        ...(requestToPassByTester.get(tester) ?? []),
        ...durations.requestToPassHours
      ]);
      passToCloseByTester.set(tester, [...(passToCloseByTester.get(tester) ?? []), ...durations.passToCloseHours]);
      closedWithoutPassByTester.set(
        tester,
        (closedWithoutPassByTester.get(tester) ?? 0) + durations.closedWithoutPassSignalSamples
      );
    }
  }

  const result = new Map<string, TestingTurnoverMetrics>();
  for (const tester of new Set([
    ...requestToPassByTester.keys(),
    ...passToCloseByTester.keys(),
    ...closedWithoutPassByTester.keys()
  ])) {
    result.set(
      tester,
      metricsFromDurations(
        requestToPassByTester.get(tester) ?? [],
        passToCloseByTester.get(tester) ?? [],
        closedWithoutPassByTester.get(tester) ?? 0
      )
    );
  }
  return result;
}

function isDuplicateError(error: unknown): boolean {
  const err = error as { code?: string; errno?: number; message?: string };
  return err.code === "ER_DUP_ENTRY" || err.errno === 1062 || (err.message ?? "").includes("Duplicate entry");
}

export function cacheStaleHoursFromEnv(env: Record<string, string | undefined> = process.env): number {
  const parsed = Number(env.MO_DEVFLOW_CACHE_STALE_HOURS ?? "6");
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 6;
  }
  return Math.max(0.25, parsed);
}

export function buildSyncHealthSummary(input: {
  rows: Array<Record<string, unknown>>;
  expectedLayers: readonly SyncHealthLayer[];
}): SyncHealth[] {
  const rowsByLayer = new Map(input.rows.map((row) => [asString(row.sync_layer), row]));

  return input.expectedLayers.map((layer) => {
    const row = rowsByLayer.get(layer);
    if (!row) {
      return {
        layer,
        status: "not_started",
        lastSuccessfulAt: null,
        lastAttemptedAt: null,
        lastFailedAt: null,
        lastFailureMessage: null,
        errorMessage: "Sync layer has not recorded a run yet.",
        rateLimitRemaining: null,
        skipped: false,
        skipReason: null
      };
    }
    const raw = parseJsonRecord<Record<string, unknown>>(asString(row.raw_json), {});
    const skipped = raw.skipped === true;
    const skipReason = typeof raw.reason === "string" ? raw.reason : null;

    return {
      layer,
      status: asString(row.status) as SyncHealthStatus,
      lastSuccessfulAt: fromSqlDate(row.last_successful_at),
      lastAttemptedAt: fromSqlDate(row.started_at),
      lastFailedAt: fromSqlDate(row.last_failed_at),
      lastFailureMessage: row.last_failure_message ? asString(row.last_failure_message) : null,
      errorMessage: row.error_message ? asString(row.error_message) : null,
      rateLimitRemaining:
        row.rate_limit_remaining === null || row.rate_limit_remaining === undefined
          ? null
          : asNumber(row.rate_limit_remaining),
      skipped,
      skipReason
    };
  });
}

export function isPersonalNeedsTriageIssue(
  input: {
    lifecycleState: string;
    severity: string | null;
  },
  criticalLabels: string[]
): boolean {
  return input.lifecycleState === "needs-triage" && !criticalLabels.includes(input.severity ?? "");
}

function normalizedLogin(login: string): string {
  return login.trim().toLowerCase();
}

function normalizedLoginSet(logins: string[]): Set<string> {
  return new Set(logins.map(normalizedLogin).filter(Boolean));
}

function workflowSkippedFromSet(login: string | null, skippedLogins: Set<string>): boolean {
  return Boolean(login && skippedLogins.has(normalizedLogin(login)));
}

function criticalIssueOwnerScopeFromSet(
  ownerLogin: string | null,
  watchedLogins: Set<string>
): CriticalIssueOwnerScope {
  if (!ownerLogin) {
    return "unowned";
  }
  const normalizedOwner = normalizedLogin(ownerLogin);
  if (!normalizedOwner) {
    return "unowned";
  }
  return watchedLogins.has(normalizedOwner) ? "watched" : "non_watched";
}

export function criticalIssueOwnerScope(ownerLogin: string | null, watchedUsers: string[]): CriticalIssueOwnerScope {
  return criticalIssueOwnerScopeFromSet(ownerLogin, normalizedLoginSet(watchedUsers));
}

export function criticalIssueOwnershipCounts(
  criticalIssues: Array<{ ownerLogin: string | null; workflowSkipped?: boolean }>,
  watchedUsers: string[]
): { unownedCriticalIssues: number; nonWatchedCriticalIssues: number; skippedCriticalIssues: number } {
  const watchedLogins = normalizedLoginSet(watchedUsers);
  return {
    unownedCriticalIssues: criticalIssues.filter(
      (issue) => criticalIssueOwnerScopeFromSet(issue.ownerLogin, watchedLogins) === "unowned"
    ).length,
    nonWatchedCriticalIssues: criticalIssues.filter(
      (issue) => criticalIssueOwnerScopeFromSet(issue.ownerLogin, watchedLogins) === "non_watched"
    ).length,
    skippedCriticalIssues: criticalIssues.filter((issue) => issue.workflowSkipped).length
  };
}

const criticalOwnerScopeRank: Record<CriticalIssueOwnerScope, number> = {
  unowned: 0,
  non_watched: 1,
  watched: 2
};

export interface NotificationEmployeeMappingCandidate {
  login: string;
  attentionItems: number;
  highestSeverity: AttentionSeverity;
}

export function criticalIssueOwnerCoverage(
  criticalIssues: Array<{
    ownerLogin: string | null;
    ownerScope: CriticalIssueOwnerScope;
    ageHours: number;
    workflowSkipped?: boolean;
  }>
): CriticalOwnerCoverageView[] {
  const owners = new Map<
    string,
    {
      ownerLogin: string | null;
      ownerScope: CriticalIssueOwnerScope;
      workflowSkipped: boolean;
      criticalIssues: number;
      totalAgeHours: number;
    }
  >();

  for (const issue of criticalIssues) {
    const ownerKey = issue.ownerLogin ? normalizedLogin(issue.ownerLogin) : "";
    const ownerScope = issue.ownerScope === "unowned" || !ownerKey ? "unowned" : issue.ownerScope;
    const key = ownerScope === "unowned" ? "unowned" : ownerKey;
    const existing = owners.get(key);
    if (existing) {
      existing.criticalIssues += 1;
      existing.totalAgeHours += issue.ageHours;
      existing.workflowSkipped = existing.workflowSkipped || Boolean(issue.workflowSkipped);
    } else {
      owners.set(key, {
        ownerLogin: ownerScope === "unowned" ? null : issue.ownerLogin,
        ownerScope,
        workflowSkipped: Boolean(issue.workflowSkipped),
        criticalIssues: 1,
        totalAgeHours: issue.ageHours
      });
    }
  }

  return Array.from(owners.values())
    .map((owner) => ({
      ownerLogin: owner.ownerLogin,
      ownerScope: owner.ownerScope,
      workflowSkipped: owner.workflowSkipped,
      criticalIssues: owner.criticalIssues,
      averageAgeHours:
        owner.criticalIssues === 0 ? null : Math.round((owner.totalAgeHours / owner.criticalIssues) * 10) / 10
    }))
    .sort((left, right) => {
      const scopeRank = criticalOwnerScopeRank[left.ownerScope] - criticalOwnerScopeRank[right.ownerScope];
      if (scopeRank !== 0) {
        return scopeRank;
      }
      if (right.criticalIssues !== left.criticalIssues) {
        return right.criticalIssues - left.criticalIssues;
      }
      if ((right.averageAgeHours ?? 0) !== (left.averageAgeHours ?? 0)) {
        return (right.averageAgeHours ?? 0) - (left.averageAgeHours ?? 0);
      }
      return (left.ownerLogin ?? "").localeCompare(right.ownerLogin ?? "");
    });
}

function hasTestingHandoffSignal(profile: RepoProfile): boolean {
  return profile.people.testers.length > 0;
}

const attentionSeverityRank: Record<AttentionSeverity, number> = {
  critical: 0,
  warning: 1,
  info: 2
};

function attentionSeverity(value: unknown): AttentionSeverity {
  const severity = asString(value);
  if (severity === "critical" || severity === "warning" || severity === "info") {
    return severity;
  }
  return "warning";
}

function employeeMappingLoginSet(profile: RepoProfile): Set<string> {
  return new Set(
    Object.entries(profile.notifications.employees)
      .filter(([, value]) => value.wecomUserId.trim().length > 0)
      .map(([login]) => normalizedLogin(login))
      .filter(Boolean)
  );
}

function employeePlaceholder(login: string): string {
  const key = normalizedLogin(login)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_");
  return `TODO_${key || "USER"}`;
}

export function notificationEmployeeMappingCandidates(
  profile: RepoProfile,
  attentionSources: Array<{ relatedLogin: string | null; severity: AttentionSeverity }>
): NotificationEmployeeMappingCandidate[] {
  const mappedEmployees = employeeMappingLoginSet(profile);
  const candidates = new Map<
    string,
    {
      login: string;
      attentionItems: number;
      highestSeverity: AttentionSeverity;
    }
  >();

  for (const source of attentionSources) {
    const loginKey = source.relatedLogin ? normalizedLogin(source.relatedLogin) : "";
    if (!loginKey || mappedEmployees.has(loginKey)) {
      continue;
    }

    const existing = candidates.get(loginKey);
    if (existing) {
      existing.attentionItems += 1;
      if (attentionSeverityRank[source.severity] < attentionSeverityRank[existing.highestSeverity]) {
        existing.highestSeverity = source.severity;
      }
    } else {
      candidates.set(loginKey, {
        login: source.relatedLogin as string,
        attentionItems: 1,
        highestSeverity: source.severity
      });
    }
  }

  return Array.from(candidates.values()).sort((left, right) => {
    const severityRank = attentionSeverityRank[left.highestSeverity] - attentionSeverityRank[right.highestSeverity];
    if (severityRank !== 0) {
      return severityRank;
    }
    if (right.attentionItems !== left.attentionItems) {
      return right.attentionItems - left.attentionItems;
    }
    return left.login.localeCompare(right.login);
  });
}

export function profileActionSuggestions(
  profile: RepoProfile,
  criticalOwnerCoverage: CriticalOwnerCoverageView[],
  notificationMappingCandidates: NotificationEmployeeMappingCandidate[]
): ProfileActionSuggestion[] {
  const suggestions: ProfileActionSuggestion[] = [];
  const watched = normalizedLoginSet(profile.people.watchedUsers);
  const skipped = normalizedLoginSet(profile.workflow.skipUsers);
  const candidateLogins = criticalOwnerCoverage
    .filter((owner) => owner.ownerScope === "non_watched" && owner.ownerLogin)
    .map((owner) => owner.ownerLogin as string)
    .filter((login) => !watched.has(normalizedLogin(login)) && !skipped.has(normalizedLogin(login)))
    .slice(0, 12);

  if (candidateLogins.length > 0) {
    suggestions.push({
      key: "profile:watched_users_candidates",
      severity: "warning",
      title: "Watched user candidates found",
      description: `${candidateLogins.length} owners outside people.watched_users currently own active s-1/s0 issues.`,
      action: "Review and add confirmed GitHub logins under people.watched_users in the active repo profile.",
      relatedLogins: candidateLogins,
      yamlSnippet: `people:\n  watched_users:\n${candidateLogins.map((login) => `    - ${login}`).join("\n")}`
    });
  }

  const hasNotificationRoutingIntent =
    profile.notifications.wecom.enabled || Boolean(profile.notifications.wecom.webhookUrlEnv);
  const notificationLogins = notificationMappingCandidates
    .map((candidate) => candidate.login)
    .filter((login) => !skipped.has(normalizedLogin(login)))
    .slice(0, 12);
  if (hasNotificationRoutingIntent && notificationLogins.length > 0) {
    suggestions.push({
      key: "profile:notification_employee_mapping_candidates",
      severity: profile.notifications.wecom.enabled ? "warning" : "info",
      title: "Notification employee mappings missing",
      description: `${notificationLogins.length} GitHub logins appear on active notification candidates without notifications.employees mappings; owner-routed alerts will use fallback recipient ${profile.notifications.routing.fallbackRecipient}.`,
      action:
        "Add confirmed enterprise WeChat user IDs under notifications.employees before relying on owner-routed alerts.",
      relatedLogins: notificationLogins,
      yamlSnippet: `notifications:\n  employees:\n${notificationLogins
        .map((login) => `    ${login}:\n      wecom_user_id: ${employeePlaceholder(login)}`)
        .join("\n")}`
    });
  }

  return suggestions;
}

function actionLogins(actions: ProfileActionSuggestion[], key: string): string[] {
  return actions.find((action) => action.key === key)?.relatedLogins ?? [];
}

function uniqueLogins(values: string[]): string[] {
  const seen = new Set<string>();
  const logins: string[] = [];
  for (const value of values) {
    const key = normalizedLogin(value);
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    logins.push(value);
  }
  return logins;
}

function yamlList(values: string[], indent: string): string[] {
  return values.map((value) => `${indent}- ${value}`);
}

export function profileSetupPlan(profile: RepoProfile, actions: ProfileActionSuggestion[]): ProfileSetupPlan {
  const watchedUsers = uniqueLogins(actionLogins(actions, "profile:watched_users_candidates"));
  const notificationLogins = uniqueLogins(actionLogins(actions, "profile:notification_employee_mapping_candidates"));
  const missingCapabilities: ProfileSetupCapability[] = [];
  const patchLines: string[] = [];

  if (watchedUsers.length > 0) {
    missingCapabilities.push("watched_users");
  }
  if (notificationLogins.length > 0) {
    missingCapabilities.push("notification_employees");
  }

  if (watchedUsers.length > 0) {
    patchLines.push("people:");
    if (watchedUsers.length > 0) {
      patchLines.push("  watched_users:", ...yamlList(watchedUsers, "    "));
    }
  }
  if (notificationLogins.length > 0) {
    patchLines.push("notifications:", "  employees:");
    for (const login of notificationLogins) {
      patchLines.push(`    ${login}:`, `      wecom_user_id: ${employeePlaceholder(login)}`);
    }
  }

  return {
    status: missingCapabilities.length > 0 ? "action_required" : "complete",
    missingCapabilities,
    candidateLogins: uniqueLogins([...watchedUsers, ...notificationLogins]),
    yamlPatch: patchLines.length > 0 ? patchLines.join("\n") : null
  };
}

export function profileConfigurationWarnings(input: {
  profile: RepoProfile;
  env: Record<string, string | undefined>;
}): ProfileConfigurationWarning[] {
  const { profile, env } = input;
  const warnings: ProfileConfigurationWarning[] = [];
  if (profile.people.watchedUsers.length === 0) {
    warnings.push({
      key: "profile:watched_users_empty",
      severity: "warning",
      title: "Watched users are not configured",
      description:
        "Personal action lists, per-person PR flow, and individual analytics are empty until people.watched_users is configured in the repository profile.",
      action: "Add GitHub logins under people.watched_users in the active repo profile."
    });
  }

  if (!hasTestingHandoffSignal(profile)) {
    warnings.push({
      key: "profile:testing_handoff_unconfigured",
      severity: "warning",
      title: "Testing handoff rules are not configured",
      description:
        "Testing queue and tester turnover views cannot reflect the real workflow until people.testers is configured. Issue assignees matching those testers are treated as sent to test.",
      action: "Configure people.testers for the repo workflow."
    });
  }

  if (!env.MO_DEVFLOW_GITHUB_WEBHOOK_SECRET?.trim()) {
    warnings.push({
      key: "webhook:secret_unconfigured",
      severity: "warning",
      title: "GitHub webhook secret is not configured",
      description: "GitHub webhook delivery ingest is disabled until MO_DEVFLOW_GITHUB_WEBHOOK_SECRET is configured.",
      action: "Set MO_DEVFLOW_GITHUB_WEBHOOK_SECRET to the same secret configured on the GitHub webhook."
    });
  }

  return warnings;
}

export async function upsertRepoProfile(profile: RepoProfile): Promise<number> {
  const pool = getPool();
  const now = nowSql();
  try {
    await pool.execute(
      `INSERT INTO repo_profiles(
        profile_key, owner, name, local_path, timezone, week_start, anonymous_read,
        critical_scope, config_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        profile.key,
        profile.repo.owner,
        profile.repo.name,
        profile.repo.localPath ?? null,
        profile.reporting.timezone,
        profile.reporting.weekStart,
        profile.access.anonymousRead ? 1 : 0,
        profile.access.criticalScope,
        stringify(profile.raw),
        now,
        now
      ]
    );
  } catch (error) {
    if (!isDuplicateError(error)) {
      throw error;
    }
    await pool.execute(
      `UPDATE repo_profiles
       SET owner = ?,
           name = ?,
           local_path = ?,
           timezone = ?,
           week_start = ?,
           anonymous_read = ?,
           critical_scope = ?,
           config_json = ?,
           updated_at = ?
       WHERE profile_key = ?`,
      [
        profile.repo.owner,
        profile.repo.name,
        profile.repo.localPath ?? null,
        profile.reporting.timezone,
        profile.reporting.weekStart,
        profile.access.anonymousRead ? 1 : 0,
        profile.access.criticalScope,
        stringify(profile.raw),
        now,
        profile.key
      ]
    );
  }
  const [rows] = await pool.execute<RowData[]>("SELECT id FROM repo_profiles WHERE profile_key = ?", [profile.key]);
  return asNumber(rows[0]?.id);
}

export async function getRepoId(profileKey: string): Promise<number | null> {
  const [rows] = await getPool().execute<RowData[]>("SELECT id FROM repo_profiles WHERE profile_key = ?", [profileKey]);
  return rows[0] ? asNumber(rows[0].id) : null;
}

export async function recordSyncRun(input: {
  repoId: number;
  syncLayer: SyncHealthLayer;
  status: "success" | "failed" | "partial" | "blocked";
  sourceAuthType: string;
  startedAt: string;
  finishedAt?: string;
  cursorValue?: string | null;
  errorMessage?: string | null;
  rateLimitRemaining?: number | null;
  raw?: unknown;
}): Promise<void> {
  await getPool().execute(
    `INSERT INTO sync_runs(
      repo_id, sync_layer, status, source_auth_type, started_at, finished_at,
      cursor_value, error_message, rate_limit_remaining, raw_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.repoId,
      input.syncLayer,
      input.status,
      input.sourceAuthType,
      sqlDate(input.startedAt),
      sqlDate(input.finishedAt ?? new Date().toISOString()),
      input.cursorValue ?? null,
      input.errorMessage ?? null,
      input.rateLimitRemaining ?? null,
      input.raw ? stringify(input.raw) : null
    ]
  );
}

export async function upsertIssue(repoId: number, issue: NormalizedIssue): Promise<void> {
  const now = nowSql();
  await getPool().execute("DELETE FROM issues WHERE repo_id = ? AND number = ?", [repoId, issue.number]);
  await getPool().execute(
    `INSERT INTO issues(
      repo_id, github_id, number, title, body, state, author_login, html_url,
      created_at, updated_at, closed_at, labels_json, assignees_json,
      owner_login, owner_reason, lifecycle_state, severity, ai_effort_label,
      is_pull_request, source_auth_type, source_user_id, visibility_class, is_complete,
      sync_error, raw_payload, last_synced_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      repoId,
      String(issue.githubId),
      issue.number,
      issue.title,
      issue.body,
      issue.state,
      issue.authorLogin,
      issue.htmlUrl,
      sqlDate(issue.createdAt),
      sqlDate(issue.updatedAt),
      sqlDate(issue.closedAt),
      stringify(issue.labels),
      stringify(issue.assignees),
      issue.ownerLogin,
      issue.ownerReason,
      issue.lifecycleState,
      issue.severity,
      issue.aiEffortLabel,
      issue.isPullRequest ? 1 : 0,
      issue.sourceAuthType,
      issue.sourceUserId,
      issue.visibilityClass,
      issue.isComplete ? 1 : 0,
      null,
      stringify(issue.rawPayload),
      now
    ]
  );
}

export async function replaceIssueComments(input: {
  repoId: number;
  issueNumber: number;
  comments: NormalizedIssueComment[];
  sourceAuthType: string;
  sourceUserId: number | null;
  visibilityClass: string;
  isComplete: boolean;
  syncError: string | null;
  raw: unknown;
  syncedAt?: string;
}): Promise<void> {
  const syncedAt = sqlDate(input.syncedAt ?? new Date().toISOString());
  await getPool().execute("DELETE FROM issue_comments WHERE repo_id = ? AND issue_number = ?", [
    input.repoId,
    input.issueNumber
  ]);
  for (const comment of input.comments) {
    await getPool().execute(
      `INSERT INTO issue_comments(
        repo_id, issue_number, github_id, author_login, body, html_url,
        created_at, updated_at, source_auth_type, source_user_id, visibility_class,
        raw_payload, last_synced_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.repoId,
        input.issueNumber,
        String(comment.githubId),
        comment.authorLogin,
        comment.body,
        comment.htmlUrl,
        sqlDate(comment.createdAt),
        sqlDate(comment.updatedAt),
        comment.sourceAuthType,
        comment.sourceUserId,
        comment.visibilityClass,
        stringify(comment.rawPayload),
        syncedAt
      ]
    );
  }
  await getPool().execute("DELETE FROM issue_comment_syncs WHERE repo_id = ? AND issue_number = ?", [
    input.repoId,
    input.issueNumber
  ]);
  await getPool().execute(
    `INSERT INTO issue_comment_syncs(
      repo_id, issue_number, source_auth_type, source_user_id, visibility_class,
      is_complete, sync_error, raw_json, last_synced_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.repoId,
      input.issueNumber,
      input.sourceAuthType,
      input.sourceUserId,
      input.visibilityClass,
      input.isComplete ? 1 : 0,
      input.syncError,
      stringify(input.raw),
      syncedAt
    ]
  );
}

export async function replaceIssueTimelineEvents(input: {
  repoId: number;
  issueNumber: number;
  events: NormalizedIssueTimelineEvent[];
  sourceAuthType: string;
  sourceUserId: number | null;
  visibilityClass: string;
  isComplete: boolean;
  syncError: string | null;
  raw: unknown;
  syncedAt?: string;
}): Promise<void> {
  const syncedAt = sqlDate(input.syncedAt ?? new Date().toISOString());
  await getPool().execute("DELETE FROM issue_timeline_events WHERE repo_id = ? AND issue_number = ?", [
    input.repoId,
    input.issueNumber
  ]);
  for (const event of input.events) {
    await getPool().execute(
      `INSERT INTO issue_timeline_events(
        repo_id, issue_number, github_id, event_type, label_name, assignee_login, actor_login,
        occurred_at, source_auth_type, source_user_id, visibility_class,
        raw_payload, last_synced_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.repoId,
        input.issueNumber,
        event.githubId,
        event.eventType,
        event.labelName,
        event.assigneeLogin,
        event.actorLogin,
        sqlDate(event.occurredAt),
        event.sourceAuthType,
        event.sourceUserId,
        event.visibilityClass,
        stringify(event.rawPayload),
        syncedAt
      ]
    );
  }
  await getPool().execute("DELETE FROM issue_timeline_syncs WHERE repo_id = ? AND issue_number = ?", [
    input.repoId,
    input.issueNumber
  ]);
  await getPool().execute(
    `INSERT INTO issue_timeline_syncs(
      repo_id, issue_number, source_auth_type, source_user_id, visibility_class,
      is_complete, sync_error, raw_json, last_synced_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.repoId,
      input.issueNumber,
      input.sourceAuthType,
      input.sourceUserId,
      input.visibilityClass,
      input.isComplete ? 1 : 0,
      input.syncError,
      stringify(input.raw),
      syncedAt
    ]
  );
}

export async function upsertIssueTimelineEvent(repoId: number, event: NormalizedIssueTimelineEvent): Promise<void> {
  try {
    await getPool().execute(
      `INSERT INTO issue_timeline_events(
        repo_id, issue_number, github_id, event_type, label_name, assignee_login, actor_login,
        occurred_at, source_auth_type, source_user_id, visibility_class,
        raw_payload, last_synced_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        repoId,
        event.issueNumber,
        event.githubId,
        event.eventType,
        event.labelName,
        event.assigneeLogin,
        event.actorLogin,
        sqlDate(event.occurredAt),
        event.sourceAuthType,
        event.sourceUserId,
        event.visibilityClass,
        stringify(event.rawPayload),
        nowSql()
      ]
    );
  } catch (error) {
    if (!isDuplicateError(error)) {
      throw error;
    }
  }
}

export async function listCachedIssuesForRules(repoId: number): Promise<NormalizedIssue[]> {
  const [rows] = await getPool().execute<RowData[]>(
    `SELECT *
     FROM issues
     WHERE repo_id = ? AND state = 'open' AND is_pull_request = 0`,
    [repoId]
  );
  const issueNumbers = rows.map((row) => asNumber(row.number));
  const commentEvidence = await issueCommentEvidenceByIssueNumber(repoId, issueNumbers);

  return rows.map((row) => ({
    githubId: asNumber(row.github_id),
    number: asNumber(row.number),
    title: asString(row.title),
    body: asString(row.body),
    state: "open",
    authorLogin: asString(row.author_login),
    htmlUrl: asString(row.html_url),
    createdAt: fromSqlDate(row.created_at) ?? new Date().toISOString(),
    updatedAt: fromSqlDate(row.updated_at) ?? new Date().toISOString(),
    closedAt: fromSqlDate(row.closed_at),
    labels: parseJsonArray(asString(row.labels_json)),
    assignees: parseJsonArray(asString(row.assignees_json)),
    ownerLogin: row.owner_login ? asString(row.owner_login) : null,
    ownerReason: row.owner_reason ? asString(row.owner_reason) : null,
    lifecycleState: asString(row.lifecycle_state) as NormalizedIssue["lifecycleState"],
    severity: row.severity ? asString(row.severity) : null,
    aiEffortLabel: row.ai_effort_label ? asString(row.ai_effort_label) : "ai-easy",
    isPullRequest: false,
    sourceAuthType: asString(row.source_auth_type) as NormalizedIssue["sourceAuthType"],
    sourceUserId: row.source_user_id === null || row.source_user_id === undefined ? null : asNumber(row.source_user_id),
    visibilityClass: asString(row.visibility_class) as NormalizedIssue["visibilityClass"],
    isComplete: asNumber(row.is_complete) === 1,
    commentEvidence: commentEvidence.get(asNumber(row.number)),
    rawPayload: parseJsonRecord(asString(row.raw_payload), {})
  }));
}

async function issueCommentEvidenceByIssueNumber(
  repoId: number,
  issueNumbers: number[]
): Promise<Map<number, NonNullable<NormalizedIssue["commentEvidence"]>>> {
  const uniqueIssueNumbers = Array.from(new Set(issueNumbers));
  const result = new Map<number, NonNullable<NormalizedIssue["commentEvidence"]>>();
  if (uniqueIssueNumbers.length === 0) {
    return result;
  }

  const placeholders = uniqueIssueNumbers.map(() => "?").join(", ");
  const [syncRows] = await getPool().execute<RowData[]>(
    `SELECT issue_number, is_complete, sync_error, last_synced_at
     FROM issue_comment_syncs
     WHERE repo_id = ? AND issue_number IN (${placeholders})`,
    [repoId, ...uniqueIssueNumbers]
  );
  const [commentRows] = await getPool().execute<RowData[]>(
    `SELECT issue_number, author_login, body, created_at, updated_at
     FROM issue_comments
     WHERE repo_id = ? AND issue_number IN (${placeholders})
     ORDER BY issue_number ASC, created_at ASC, id ASC`,
    [repoId, ...uniqueIssueNumbers]
  );

  const commentsByIssueNumber = new Map<number, NonNullable<NormalizedIssue["commentEvidence"]>["comments"]>();
  for (const row of commentRows) {
    const issueNumber = asNumber(row.issue_number);
    const comments = commentsByIssueNumber.get(issueNumber) ?? [];
    comments.push({
      authorLogin: asString(row.author_login),
      body: asString(row.body),
      createdAt: fromSqlDate(row.created_at) ?? new Date(0).toISOString(),
      updatedAt: fromSqlDate(row.updated_at) ?? new Date(0).toISOString()
    });
    commentsByIssueNumber.set(issueNumber, comments);
  }

  for (const row of syncRows) {
    const issueNumber = asNumber(row.issue_number);
    result.set(issueNumber, {
      isComplete: asBoolean(row.is_complete),
      lastSyncedAt: fromSqlDate(row.last_synced_at),
      syncError: row.sync_error ? asString(row.sync_error) : null,
      comments: commentsByIssueNumber.get(issueNumber) ?? []
    });
  }

  return result;
}

export async function listCachedPullRequestsForRules(repoId: number): Promise<NormalizedPullRequest[]> {
  const [rows] = await getPool().execute<RowData[]>(
    `SELECT *
     FROM pull_requests
     WHERE repo_id = ? AND state = 'open'`,
    [repoId]
  );

  return rows.map((row) => ({
    githubId: asNumber(row.github_id),
    number: asNumber(row.number),
    title: asString(row.title),
    state: "open",
    authorLogin: asString(row.author_login),
    ownerLogin: asString(row.owner_login),
    htmlUrl: asString(row.html_url),
    createdAt: fromSqlDate(row.created_at) ?? new Date().toISOString(),
    updatedAt: fromSqlDate(row.updated_at) ?? new Date().toISOString(),
    closedAt: fromSqlDate(row.closed_at),
    mergedAt: fromSqlDate(row.merged_at),
    draft: asBoolean(row.draft),
    headRef: asString(row.head_ref),
    baseRef: asString(row.base_ref),
    labels: parseJsonArray(asString(row.labels_json)),
    assignees: parseJsonArray(asString(row.assignees_json)),
    requestedReviewers: parseJsonArray(asString(row.requested_reviewers_json)),
    ageHours: asNumber(row.age_hours),
    lastHumanActionAt: fromSqlDate(row.last_human_action_at) ?? new Date().toISOString(),
    lastSystemActionAt: fromSqlDate(row.last_system_action_at),
    reviewDecision: row.review_decision ? asString(row.review_decision) : null,
    mergeStateStatus: row.merge_state_status ? asString(row.merge_state_status) : null,
    ciState: row.ci_state ? asString(row.ci_state) : null,
    latestReviewState: row.latest_review_state ? asString(row.latest_review_state) : null,
    latestReviewSubmittedAt: fromSqlDate(row.latest_review_submitted_at),
    latestCommitAt: fromSqlDate(row.latest_commit_at),
    detailSyncedAt: fromSqlDate(row.detail_synced_at),
    detailError: row.detail_error ? asString(row.detail_error) : null,
    testingState: row.testing_state
      ? (asString(row.testing_state) as NormalizedPullRequest["testingState"])
      : "not_ready",
    testingTesters: parseJsonArray(asString(row.testing_testers_json)),
    testingSignals: parseJsonArray(asString(row.testing_signals_json)),
    testingQueueAgeHours:
      row.testing_queue_age_hours === null || row.testing_queue_age_hours === undefined
        ? null
        : asNumber(row.testing_queue_age_hours),
    attentionFlags: parseJsonArray(asString(row.attention_flags_json)),
    linkedIssueNumbers: linkedIssueNumbersForPullRequestRow(row),
    sourceAuthType: asString(row.source_auth_type) as NormalizedPullRequest["sourceAuthType"],
    sourceUserId: row.source_user_id === null || row.source_user_id === undefined ? null : asNumber(row.source_user_id),
    visibilityClass: asString(row.visibility_class) as NormalizedPullRequest["visibilityClass"],
    isComplete: asBoolean(row.is_complete),
    rawPayload: parseJsonRecord(asString(row.raw_payload), {})
  }));
}

export async function upsertPullRequest(repoId: number, pr: NormalizedPullRequest): Promise<NormalizedPullRequest> {
  const now = nowSql();
  let next = pr;
  const [rows] = await getPool().execute<RowData[]>(
    `SELECT last_human_action_at, review_decision, merge_state_status, ci_state,
            latest_review_state, latest_review_submitted_at, latest_commit_at,
            detail_synced_at, detail_error, attention_flags_json, linked_issue_numbers_json,
            testing_state, is_complete
     FROM pull_requests
     WHERE repo_id = ? AND number = ?`,
    [repoId, pr.number]
  );
  const previous = rows[0];
  let hasExistingTestingEvents = false;
  if (previous) {
    const [testingEventRows] = await getPool().execute<RowData[]>(
      `SELECT id
       FROM pr_testing_events
       WHERE repo_id = ? AND pr_number = ?
       LIMIT 1`,
      [repoId, pr.number]
    );
    hasExistingTestingEvents = testingEventRows.length > 0;
  }
  next = pullRequestWithPreservedInsight({ current: pr, previous });
  const testingTransition = pullRequestTestingTransitionForUpsert({
    repoId,
    previousTestingState: previous?.testing_state
      ? (asString(previous.testing_state) as NormalizedPullRequest["testingState"])
      : null,
    hasExistingTestingEvents,
    pr: next
  });
  await getPool().execute("DELETE FROM pull_requests WHERE repo_id = ? AND number = ?", [repoId, pr.number]);
  await getPool().execute(
    `INSERT INTO pull_requests(
      repo_id, github_id, number, title, state, author_login, owner_login, html_url,
      created_at, updated_at, closed_at, merged_at, draft, head_ref, base_ref,
      labels_json, assignees_json, requested_reviewers_json, age_hours, last_human_action_at,
      last_system_action_at, review_decision, merge_state_status, ci_state,
      latest_review_state, latest_review_submitted_at, latest_commit_at,
      detail_synced_at, detail_error, testing_state, testing_testers_json,
      testing_signals_json, testing_queue_age_hours, attention_flags_json,
      linked_issue_numbers_json, source_auth_type, source_user_id, visibility_class,
      is_complete, sync_error, raw_payload, last_synced_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      repoId,
      String(next.githubId),
      next.number,
      next.title,
      next.state,
      next.authorLogin,
      next.ownerLogin,
      next.htmlUrl,
      sqlDate(next.createdAt),
      sqlDate(next.updatedAt),
      sqlDate(next.closedAt),
      sqlDate(next.mergedAt),
      next.draft ? 1 : 0,
      next.headRef,
      next.baseRef,
      stringify(next.labels),
      stringify(next.assignees),
      stringify(next.requestedReviewers),
      next.ageHours,
      sqlDate(next.lastHumanActionAt),
      sqlDate(next.lastSystemActionAt),
      next.reviewDecision,
      next.mergeStateStatus,
      next.ciState,
      next.latestReviewState,
      sqlDate(next.latestReviewSubmittedAt),
      sqlDate(next.latestCommitAt),
      sqlDate(next.detailSyncedAt),
      next.detailError,
      next.testingState,
      stringify(next.testingTesters),
      stringify(next.testingSignals),
      next.testingQueueAgeHours,
      stringify(next.attentionFlags),
      stringify(next.linkedIssueNumbers),
      next.sourceAuthType,
      next.sourceUserId,
      next.visibilityClass,
      next.isComplete ? 1 : 0,
      null,
      stringify(next.rawPayload),
      now
    ]
  );
  if (testingTransition) {
    await recordPullRequestTestingTransitionEvent(testingTransition);
  }
  return next;
}

async function recordPullRequestTestingTransitionEvent(event: PullRequestTestingTransitionEvent): Promise<void> {
  try {
    await getPool().execute(
      `INSERT INTO pr_testing_events(
        repo_id, pr_number, from_state, to_state, testing_testers_json,
        testing_signals_json, occurred_at, source_completeness, source_auth_type,
        source_user_id, visibility_class, dedupe_key, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        event.repoId,
        event.prNumber,
        event.fromState,
        event.toState,
        stringify(event.testingTesters),
        stringify(event.testingSignals),
        sqlDate(event.occurredAt),
        event.sourceCompleteness,
        event.sourceAuthType,
        event.sourceUserId,
        event.visibilityClass,
        event.dedupeKey,
        nowSql()
      ]
    );
  } catch (error) {
    if (!isDuplicateError(error)) {
      throw error;
    }
  }
}

export async function listPullRequestTestingTransitionEvents(input: {
  repoId: number;
  prNumber?: number;
  limit?: number;
}): Promise<PullRequestTestingTransitionEventView[]> {
  const limit = Math.max(1, Math.min(200, Math.floor(input.limit ?? 50)));
  const prFilter = input.prNumber ? "AND pr_number = ?" : "";
  const [rows] = await getPool().execute<RowData[]>(
    `SELECT *
     FROM pr_testing_events
     WHERE repo_id = ? ${prFilter}
     ORDER BY occurred_at DESC, id DESC
     LIMIT ?`,
    input.prNumber ? [input.repoId, input.prNumber, limit] : [input.repoId, limit]
  );
  return rows.map((row) => ({
    ...testingTransitionViewFromRow(row),
    repoId: asNumber(row.repo_id),
    sourceAuthType: asString(row.source_auth_type) as NormalizedPullRequest["sourceAuthType"],
    sourceUserId: row.source_user_id === null || row.source_user_id === undefined ? null : asNumber(row.source_user_id),
    visibilityClass: asString(row.visibility_class) as NormalizedPullRequest["visibilityClass"],
    dedupeKey: asString(row.dedupe_key),
    createdAt: fromSqlDate(row.created_at) ?? new Date().toISOString()
  }));
}

export async function listPullRequestNumbersForDetailBackfill(repoId: number, limit: number): Promise<number[]> {
  if (limit <= 0) {
    return [];
  }
  const [rows] = await getPool().execute<RowData[]>(
    `SELECT number
     FROM pull_requests
     WHERE repo_id = ?
       AND state = 'open'
       AND (is_complete = 0 OR detail_synced_at IS NULL OR detail_error IS NOT NULL)
     ORDER BY CASE WHEN detail_synced_at IS NULL THEN 0 ELSE 1 END ASC,
              updated_at DESC,
              number DESC
     LIMIT ?`,
    [repoId, Math.floor(limit)]
  );
  return rows.map((row) => asNumber(row.number));
}

export async function listIssueCommentBackfillCandidates(
  repoId: number,
  input: { criticalLabels: string[]; includePullRequests: boolean; limit: number }
): Promise<IssueCommentBackfillCandidate[]> {
  if (input.limit <= 0) {
    return [];
  }
  const criticalLabels = input.criticalLabels.length > 0 ? input.criticalLabels : ["__mo_devflow_no_critical_label__"];
  const criticalPlaceholders = criticalLabels.map(() => "?").join(", ");
  const issueSelect = `
    SELECT i.number AS issue_number,
           'issue' AS object_type,
           i.visibility_class,
           i.updated_at AS source_updated_at,
           s.last_synced_at AS comment_synced_at
    FROM issues i
    LEFT JOIN issue_comment_syncs s
      ON s.repo_id = i.repo_id AND s.issue_number = i.number
    WHERE i.repo_id = ?
      AND i.state = 'open'
      AND i.is_pull_request = 0
      AND (i.lifecycle_state = 'deferred' OR i.severity IN (${criticalPlaceholders}))
      AND (
        s.issue_number IS NULL
        OR s.is_complete = 0
        OR s.sync_error IS NOT NULL
        OR s.last_synced_at < i.updated_at
      )`;
  const pullRequestSelect = `
    SELECT p.number AS issue_number,
           'pull_request' AS object_type,
           p.visibility_class,
           p.updated_at AS source_updated_at,
           s.last_synced_at AS comment_synced_at
    FROM pull_requests p
    LEFT JOIN issue_comment_syncs s
      ON s.repo_id = p.repo_id AND s.issue_number = p.number
    WHERE p.repo_id = ?
      AND p.state = 'open'
      AND (
        s.issue_number IS NULL
        OR s.is_complete = 0
        OR s.sync_error IS NOT NULL
        OR s.last_synced_at < p.updated_at
      )`;
  const selects = input.includePullRequests ? [issueSelect, pullRequestSelect] : [issueSelect];
  const params = input.includePullRequests
    ? [repoId, ...criticalLabels, repoId, Math.floor(input.limit)]
    : [repoId, ...criticalLabels, Math.floor(input.limit)];
  const [rows] = await getPool().execute<RowData[]>(
    `SELECT *
     FROM (${selects.join(" UNION ALL ")}) comment_candidates
     ORDER BY CASE WHEN comment_synced_at IS NULL THEN 0 ELSE 1 END ASC,
              source_updated_at DESC,
              issue_number DESC
     LIMIT ?`,
    params
  );
  return rows.map((row) => ({
    issueNumber: asNumber(row.issue_number),
    objectType: asString(row.object_type) === "pull_request" ? "pull_request" : "issue",
    visibilityClass: asString(row.visibility_class) as NormalizedIssue["visibilityClass"],
    sourceUpdatedAt: fromSqlDate(row.source_updated_at) ?? new Date(0).toISOString(),
    lastCommentSyncedAt: fromSqlDate(row.comment_synced_at)
  }));
}

export function issueTimelineBackfillCandidatesFromRows(
  rows: IssueTimelineBackfillCandidateRow[],
  input: { criticalLabels: string[]; testerLogins?: string[]; limit: number }
): IssueTimelineBackfillCandidate[] {
  if (input.limit <= 0) {
    return [];
  }
  const criticalLabels = new Set(input.criticalLabels);
  const testerLogins = normalizedLoginSet(input.testerLogins ?? []);
  return rows
    .map((row) => {
      const assigneeLogins = parseJsonArray(asString(row.assignees_json)).map(normalizedLogin);
      const isTestingIssue = assigneeLogins.some((login) => testerLogins.has(login));
      const isCriticalIssue = criticalLabels.has(asString(row.severity));
      if (!isCriticalIssue && !isTestingIssue) {
        return null;
      }
      return {
        candidate: {
          issueNumber: asNumber(row.issue_number),
          visibilityClass: asString(row.visibility_class) as NormalizedIssue["visibilityClass"],
          sourceUpdatedAt: fromSqlDate(row.source_updated_at) ?? new Date(0).toISOString(),
          lastTimelineSyncedAt: fromSqlDate(row.timeline_synced_at)
        },
        isTestingIssue,
        isCriticalIssue
      };
    })
    .filter(
      (
        row
      ): row is {
        candidate: IssueTimelineBackfillCandidate;
        isTestingIssue: boolean;
        isCriticalIssue: boolean;
      } => row !== null
    )
    .sort((left, right) => {
      const missingSyncDelta =
        Number(left.candidate.lastTimelineSyncedAt !== null) - Number(right.candidate.lastTimelineSyncedAt !== null);
      if (missingSyncDelta !== 0) {
        return missingSyncDelta;
      }
      const testingDelta = Number(right.isTestingIssue) - Number(left.isTestingIssue);
      if (testingDelta !== 0) {
        return testingDelta;
      }
      const criticalDelta = Number(right.isCriticalIssue) - Number(left.isCriticalIssue);
      if (criticalDelta !== 0) {
        return criticalDelta;
      }
      const updatedDelta =
        new Date(right.candidate.sourceUpdatedAt).getTime() - new Date(left.candidate.sourceUpdatedAt).getTime();
      if (updatedDelta !== 0) {
        return updatedDelta;
      }
      return right.candidate.issueNumber - left.candidate.issueNumber;
    })
    .slice(0, Math.floor(input.limit))
    .map((row) => row.candidate);
}

export async function listIssueTimelineBackfillCandidates(
  repoId: number,
  input: { criticalLabels: string[]; testerLogins?: string[]; limit: number }
): Promise<IssueTimelineBackfillCandidate[]> {
  if (input.limit <= 0) {
    return [];
  }
  const criticalLabels = input.criticalLabels.length > 0 ? input.criticalLabels : ["__mo_devflow_no_critical_label__"];
  const testerLogins = Array.from(normalizedLoginSet(input.testerLogins ?? []));
  const testerClauses = testerLogins.map(() => "LOWER(i.assignees_json) LIKE ?");
  const candidateScopeSql = [`i.severity IN (${criticalLabels.map(() => "?").join(", ")})`, ...testerClauses].join(
    " OR "
  );
  const candidateScopeParams = [...criticalLabels, ...testerLogins.map((login) => `%"${login}"%`)];
  const fetchLimit = Math.max(Math.floor(input.limit) * 8, Math.floor(input.limit));
  const [rows] = await getPool().execute<RowData[]>(
    `SELECT i.number AS issue_number,
            i.visibility_class,
            i.updated_at AS source_updated_at,
            s.last_synced_at AS timeline_synced_at,
            i.severity,
            i.assignees_json
     FROM issues i
     LEFT JOIN issue_timeline_syncs s
       ON s.repo_id = i.repo_id AND s.issue_number = i.number
     WHERE i.repo_id = ?
       AND i.state = 'open'
       AND i.is_pull_request = 0
       AND (${candidateScopeSql})
       AND (
         s.issue_number IS NULL
         OR s.is_complete = 0
         OR s.sync_error IS NOT NULL
         OR s.last_synced_at < i.updated_at
       )
     ORDER BY CASE WHEN s.last_synced_at IS NULL THEN 0 ELSE 1 END ASC,
              i.updated_at DESC,
              i.number DESC
     LIMIT ?`,
    [repoId, ...candidateScopeParams, fetchLimit]
  );
  return issueTimelineBackfillCandidatesFromRows(rows, input);
}

export async function upsertAttentionItem(input: {
  repoId: number;
  objectType: string;
  objectNumber?: number | null;
  ruleKey: string;
  severity: string;
  relatedLogin?: string | null;
  targetRecipient?: string | null;
  dedupeKey: string;
  evidenceSummary: string;
  dashboardUrl: string;
}): Promise<void> {
  const now = nowSql();
  try {
    await getPool().execute(
      `INSERT INTO attention_items(
        repo_id, object_type, object_number, rule_key, severity, related_login,
        target_recipient, dedupe_key, first_detected_at, last_detected_at,
        resolved_at, evidence_summary, dashboard_url, notification_state
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, 'not_sent')`,
      [
        input.repoId,
        input.objectType,
        input.objectNumber ?? null,
        input.ruleKey,
        input.severity,
        input.relatedLogin ?? null,
        input.targetRecipient ?? null,
        input.dedupeKey,
        now,
        now,
        input.evidenceSummary,
        input.dashboardUrl
      ]
    );
  } catch (error) {
    if (!isDuplicateError(error)) {
      throw error;
    }
    await getPool().execute(
      `UPDATE attention_items
       SET severity = ?,
           related_login = ?,
           target_recipient = ?,
           last_detected_at = ?,
           resolved_at = NULL,
           evidence_summary = ?,
           dashboard_url = ?
       WHERE dedupe_key = ?`,
      [
        input.severity,
        input.relatedLogin ?? null,
        input.targetRecipient ?? null,
        now,
        input.evidenceSummary,
        input.dashboardUrl,
        input.dedupeKey
      ]
    );
  }
}

export const issueAttentionRuleKeys = ["critical_no_human_action"] as const;
export const pullRequestAttentionRuleKeys = [
  "no_human_action_24h",
  "review_requested_no_response",
  "requested_changes",
  "ci_failed",
  "merge_conflict",
  "testing_stalled"
] as const;
export const snapshotManagedAttentionRuleKeys = [...issueAttentionRuleKeys, ...pullRequestAttentionRuleKeys] as const;

export interface AttentionResolutionRow {
  objectType: string;
  objectNumber: number | null;
  ruleKey: string;
  dedupeKey: string;
}

export function attentionItemsToResolve(input: {
  rows: AttentionResolutionRow[];
  activeDedupeKeys: ReadonlySet<string>;
  managedRuleKeys: readonly string[];
  objectType?: string;
  objectNumber?: number;
}): string[] {
  const managedRuleKeys = new Set(input.managedRuleKeys);
  return input.rows
    .filter((row) => managedRuleKeys.has(row.ruleKey))
    .filter((row) => !input.activeDedupeKeys.has(row.dedupeKey))
    .filter((row) => !input.objectType || row.objectType === input.objectType)
    .filter((row) => input.objectNumber === undefined || row.objectNumber === input.objectNumber)
    .map((row) => row.dedupeKey);
}

export async function resolveStaleAttentionItems(input: {
  repoId: number;
  activeDedupeKeys: Iterable<string>;
  managedRuleKeys: readonly string[];
  objectType?: string;
  objectNumber?: number;
}): Promise<number> {
  const managedRuleKeys = Array.from(new Set(input.managedRuleKeys));
  if (managedRuleKeys.length === 0) {
    return 0;
  }
  const activeDedupeKeys = Array.from(new Set(input.activeDedupeKeys));
  const params: Array<string | number> = [nowSql(), input.repoId, ...managedRuleKeys];
  let sql = `UPDATE attention_items
             SET resolved_at = ?
             WHERE repo_id = ?
               AND resolved_at IS NULL
               AND rule_key IN (${managedRuleKeys.map(() => "?").join(", ")})`;
  if (input.objectType) {
    sql += " AND object_type = ?";
    params.push(input.objectType);
  }
  if (input.objectNumber !== undefined) {
    sql += " AND object_number = ?";
    params.push(input.objectNumber);
  }
  if (activeDedupeKeys.length > 0) {
    sql += ` AND dedupe_key NOT IN (${activeDedupeKeys.map(() => "?").join(", ")})`;
    params.push(...activeDedupeKeys);
  }
  const [result] = await getPool().execute(sql, params);
  return Number((result as ResultSetHeader).affectedRows ?? 0);
}

function workflowViolationDedupeKey(repoId: number, violation: WorkflowViolation): string {
  return `${repoId}:${violation.objectType}:${violation.objectNumber}:${violation.ruleKey}`;
}

function aiDriftDedupeKey(repoId: number, signal: AiDriftSignal): string {
  return `${repoId}:${signal.objectType}:${signal.objectNumber}:${signal.ruleKey}`;
}

export async function replaceWorkflowViolations(repoId: number, violations: WorkflowViolation[]): Promise<void> {
  const now = nowSql();
  const activeDedupeKeys = violations.map((violation) => workflowViolationDedupeKey(repoId, violation));

  for (let index = 0; index < violations.length; index += 1) {
    const violation = violations[index]!;
    const dedupeKey = activeDedupeKeys[index]!;
    try {
      await getPool().execute(
        `INSERT INTO workflow_violations(
          repo_id, object_type, object_number, title, html_url, rule_key, severity,
          related_login, dedupe_key, first_detected_at, last_detected_at,
          resolved_at, evidence_summary, suggested_action, fixable
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
        [
          repoId,
          violation.objectType,
          violation.objectNumber,
          violation.title,
          violation.htmlUrl,
          violation.ruleKey,
          violation.severity,
          violation.relatedLogin,
          dedupeKey,
          now,
          now,
          violation.evidenceSummary,
          violation.suggestedAction,
          violation.fixable ? 1 : 0
        ]
      );
    } catch (error) {
      if (!isDuplicateError(error)) {
        throw error;
      }
      await getPool().execute(
        `UPDATE workflow_violations
         SET title = ?,
             html_url = ?,
             severity = ?,
             related_login = ?,
             last_detected_at = ?,
             resolved_at = NULL,
             evidence_summary = ?,
             suggested_action = ?,
             fixable = ?
         WHERE dedupe_key = ?`,
        [
          violation.title,
          violation.htmlUrl,
          violation.severity,
          violation.relatedLogin,
          now,
          violation.evidenceSummary,
          violation.suggestedAction,
          violation.fixable ? 1 : 0,
          dedupeKey
        ]
      );
    }
  }

  if (activeDedupeKeys.length === 0) {
    await getPool().execute(
      "UPDATE workflow_violations SET resolved_at = ? WHERE repo_id = ? AND resolved_at IS NULL",
      [now, repoId]
    );
    return;
  }

  await getPool().execute(
    `UPDATE workflow_violations
     SET resolved_at = ?
     WHERE repo_id = ?
       AND resolved_at IS NULL
       AND dedupe_key NOT IN (${activeDedupeKeys.map(() => "?").join(", ")})`,
    [now, repoId, ...activeDedupeKeys]
  );
}

export async function replaceAiDriftSignals(repoId: number, signals: AiDriftSignal[]): Promise<void> {
  const now = nowSql();
  const activeDedupeKeys = signals.map((signal) => aiDriftDedupeKey(repoId, signal));

  for (let index = 0; index < signals.length; index += 1) {
    const signal = signals[index]!;
    const dedupeKey = activeDedupeKeys[index]!;
    try {
      await getPool().execute(
        `INSERT INTO ai_drift_signals(
          repo_id, object_type, object_number, title, html_url, rule_key, severity,
          owner_login, ai_effort_label, expected_hours, actual_hours, dedupe_key,
          first_detected_at, last_detected_at, resolved_at, evidence_summary,
          suggested_action, source_completeness
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
        [
          repoId,
          signal.objectType,
          signal.objectNumber,
          signal.title,
          signal.htmlUrl,
          signal.ruleKey,
          signal.severity,
          signal.ownerLogin,
          signal.aiEffortLabel,
          signal.expectedHours,
          signal.actualHours,
          dedupeKey,
          now,
          now,
          signal.evidenceSummary,
          signal.suggestedAction,
          signal.sourceCompleteness
        ]
      );
    } catch (error) {
      if (!isDuplicateError(error)) {
        throw error;
      }
      await getPool().execute(
        `UPDATE ai_drift_signals
         SET title = ?,
             html_url = ?,
             severity = ?,
             owner_login = ?,
             ai_effort_label = ?,
             expected_hours = ?,
             actual_hours = ?,
             last_detected_at = ?,
             resolved_at = NULL,
             evidence_summary = ?,
             suggested_action = ?,
             source_completeness = ?
         WHERE dedupe_key = ?`,
        [
          signal.title,
          signal.htmlUrl,
          signal.severity,
          signal.ownerLogin,
          signal.aiEffortLabel,
          signal.expectedHours,
          signal.actualHours,
          now,
          signal.evidenceSummary,
          signal.suggestedAction,
          signal.sourceCompleteness,
          dedupeKey
        ]
      );
    }
  }

  if (activeDedupeKeys.length === 0) {
    await getPool().execute("UPDATE ai_drift_signals SET resolved_at = ? WHERE repo_id = ? AND resolved_at IS NULL", [
      now,
      repoId
    ]);
    return;
  }

  await getPool().execute(
    `UPDATE ai_drift_signals
     SET resolved_at = ?
     WHERE repo_id = ?
       AND resolved_at IS NULL
       AND dedupe_key NOT IN (${activeDedupeKeys.map(() => "?").join(", ")})`,
    [now, repoId, ...activeDedupeKeys]
  );
}

export async function runWithJobLease<T>(
  jobKey: string,
  jobType: string,
  handler: () => Promise<T>,
  options: {
    leaseSeconds?: number;
    nextRunAt?: string;
  } = {}
): Promise<T | null> {
  const pool = getPool();
  const now = nowSql();
  const leaseOwner = `${process.pid}-${Math.random().toString(16).slice(2)}`;
  const leaseExpiresAt = sqlDate(new Date(Date.now() + (options.leaseSeconds ?? 600) * 1000)) ?? now;
  try {
    await pool.execute(
      `INSERT INTO jobs(
        job_key, job_type, status, attempts, next_run_at, lease_owner,
        lease_expires_at, last_error, payload_json, created_at, updated_at
      ) VALUES (?, ?, 'pending', 0, ?, NULL, NULL, NULL, NULL, ?, ?)`,
      [jobKey, jobType, now, now, now]
    );
  } catch (error) {
    if (!isDuplicateError(error)) {
      throw error;
    }
  }
  const [result] = await pool.execute(
    `UPDATE jobs
     SET status = 'running',
         lease_owner = ?,
         lease_expires_at = ?,
         attempts = attempts + 1,
         updated_at = ?
     WHERE job_key = ?
       AND (lease_expires_at IS NULL OR lease_expires_at < ? OR status IN ('pending', 'failed', 'complete'))`,
    [leaseOwner, leaseExpiresAt, now, jobKey, now]
  );
  const changedRows = Number((result as ResultSetHeader).affectedRows ?? 0);
  if (changedRows === 0) {
    return null;
  }
  try {
    const value = await handler();
    await pool.execute(
      `UPDATE jobs
       SET status = 'complete',
           lease_owner = NULL,
           lease_expires_at = NULL,
           last_error = NULL,
           next_run_at = ?,
           updated_at = ?
       WHERE job_key = ? AND lease_owner = ?`,
      [sqlDate(options.nextRunAt ?? new Date().toISOString()), nowSql(), jobKey, leaseOwner]
    );
    return value;
  } catch (error) {
    await pool.execute(
      `UPDATE jobs
       SET status = 'failed',
           lease_owner = NULL,
           lease_expires_at = NULL,
           last_error = ?,
           updated_at = UTC_TIMESTAMP()
       WHERE job_key = ? AND lease_owner = ?`,
      [error instanceof Error ? error.message : String(error), jobKey, leaseOwner]
    );
    throw error;
  }
}

function inRange(value: unknown, start: Date, end: Date): boolean {
  const iso = fromSqlDate(value);
  if (!iso) {
    return false;
  }
  const time = new Date(iso).getTime();
  return time >= start.getTime() && time < end.getTime();
}

function issueAgeHours(row: RowData): number {
  return Math.max(
    0,
    Math.round(((Date.now() - new Date(fromSqlDate(row.created_at) ?? new Date()).getTime()) / 3_600_000) * 10) / 10
  );
}

function hoursSince(value: string | null): number | null {
  if (!value) {
    return null;
  }
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) {
    return null;
  }
  return Math.max(0, Math.round(((Date.now() - timestamp) / 3_600_000) * 10) / 10);
}

function cacheObjectEvidenceFromRow(row: RowData, staleCutoff: string): CacheObjectEvidenceView {
  const lastSyncedAt = fromSqlDate(row.last_synced_at) ?? new Date(0).toISOString();
  const sourceUpdatedAt = fromSqlDate(row.source_updated_at) ?? lastSyncedAt;
  const staleCutoffAt = new Date(fromSqlDate(staleCutoff) ?? staleCutoff).getTime();
  const isStale = new Date(lastSyncedAt).getTime() < staleCutoffAt;
  const isPartial = !asBoolean(row.is_complete);
  const reason: CacheObjectEvidenceView["reason"] =
    isStale && isPartial ? "stale_and_partial" : isStale ? "stale" : "partial";

  return {
    objectType: asString(row.object_type) === "pull_request" ? "pull_request" : "issue",
    number: asNumber(row.number),
    title: asString(row.title),
    htmlUrl: asString(row.html_url),
    ownerLogin: row.owner_login ? asString(row.owner_login) : null,
    state: asString(row.state) === "closed" ? "closed" : "open",
    visibilityClass: asString(row.visibility_class) as CacheObjectEvidenceView["visibilityClass"],
    sourceAuthType: asString(row.source_auth_type) as CacheObjectEvidenceView["sourceAuthType"],
    lastSyncedAt,
    sourceUpdatedAt,
    cacheAgeHours: hoursSince(lastSyncedAt) ?? 0,
    isComplete: !isPartial,
    syncError: row.sync_error ? asString(row.sync_error) : null,
    reason
  };
}

async function criticalStartedAtByIssueNumber(
  repoId: number,
  currentSeverityByIssueNumber: Map<number, string>,
  visibilitySql: string,
  visibilityParams: number[]
): Promise<Map<number, string>> {
  if (currentSeverityByIssueNumber.size === 0) {
    return new Map();
  }
  const [rows] = await getPool().execute<RowData[]>(
    `SELECT issue_number, event_type, label_name, occurred_at
     FROM issue_timeline_events e
     WHERE repo_id = ?
       AND event_type IN ('labeled', 'unlabeled')
       AND ${visibilitySql}
     ORDER BY occurred_at ASC, id ASC
     LIMIT 5000`,
    [repoId, ...visibilityParams]
  );
  const startedAtByIssueNumber = new Map<number, string>();
  for (const row of rows) {
    const issueNumber = asNumber(row.issue_number);
    const currentSeverity = currentSeverityByIssueNumber.get(issueNumber);
    const labelName = row.label_name ? asString(row.label_name) : null;
    if (!currentSeverity || labelName !== currentSeverity) {
      continue;
    }
    const occurredAt = fromSqlDate(row.occurred_at);
    if (!occurredAt) {
      continue;
    }
    if (asString(row.event_type) === "labeled") {
      startedAtByIssueNumber.set(issueNumber, occurredAt);
    } else if (asString(row.event_type) === "unlabeled") {
      startedAtByIssueNumber.delete(issueNumber);
    }
  }
  return startedAtByIssueNumber;
}

function linkedIssueNumbersForPullRequestRow(row: RowData): number[] {
  const rawPayload = parseJsonRecord<Record<string, unknown>>(asString(row.raw_payload), {});
  const body = typeof rawPayload.body === "string" ? rawPayload.body : "";
  return uniqueIssueNumbers([
    ...parseJsonNumberArray(row.linked_issue_numbers_json),
    ...extractLinkedIssueNumbers(`${asString(row.title)}\n${body}`)
  ]);
}

interface TestingIssueContext {
  issueNumber: number;
  testers: string[];
  signals: string[];
  queueAgeHours: number | null;
  queueStartedAt: string | null;
  queueAgeEvidence: TestingIssueQueueView["queueAgeEvidence"];
}

function uniqueValues(values: string[]): string[] {
  return Array.from(new Set(values.filter((value) => value.length > 0)));
}

function testingIssueContextsByNumber(profile: RepoProfile, rows: RowData[]): Map<number, TestingIssueContext> {
  const testerLogins = normalizedLoginSet(profile.people.testers);
  const contexts = new Map<number, TestingIssueContext>();
  if (testerLogins.size === 0) {
    return contexts;
  }

  for (const row of rows) {
    if (asString(row.state) !== "open" || asNumber(row.is_pull_request) === 1) {
      continue;
    }
    const testers = parseJsonArray(asString(row.assignees_json)).filter((login) =>
      testerLogins.has(normalizedLogin(login))
    );
    if (testers.length === 0) {
      continue;
    }
    const issueNumber = asNumber(row.number);
    const queueStartedAt = fromSqlDate(row.updated_at) ?? fromSqlDate(row.created_at);
    contexts.set(issueNumber, {
      issueNumber,
      testers: uniqueValues(testers),
      signals: uniqueValues(testers.map((tester) => `issue_assignee:#${issueNumber}:${tester}`)),
      queueAgeHours: hoursSince(queueStartedAt),
      queueStartedAt,
      queueAgeEvidence: "issue_cache_timestamp"
    });
  }

  return contexts;
}

async function testingAssignmentStartedAtByIssueNumber(
  repoId: number,
  contexts: Map<number, TestingIssueContext>,
  visibilitySql: string,
  visibilityParams: number[]
): Promise<Map<number, string>> {
  if (contexts.size === 0) {
    return new Map();
  }
  const [rows] = await getPool().execute<RowData[]>(
    `SELECT issue_number, event_type, assignee_login, occurred_at
     FROM issue_timeline_events e
     WHERE repo_id = ?
       AND event_type IN ('assigned', 'unassigned')
       AND ${visibilitySql}
     ORDER BY occurred_at ASC, id ASC
     LIMIT 10000`,
    [repoId, ...visibilityParams]
  );
  const activeAssignments = new Map<number, Map<string, string>>();
  for (const row of rows) {
    const issueNumber = asNumber(row.issue_number);
    const context = contexts.get(issueNumber);
    if (!context) {
      continue;
    }
    const assignee = row.assignee_login ? asString(row.assignee_login) : "";
    if (!context.testers.some((tester) => normalizedLogin(tester) === normalizedLogin(assignee))) {
      continue;
    }
    const occurredAt = fromSqlDate(row.occurred_at);
    if (!occurredAt) {
      continue;
    }
    const assignments = activeAssignments.get(issueNumber) ?? new Map<string, string>();
    if (asString(row.event_type) === "assigned") {
      assignments.set(normalizedLogin(assignee), occurredAt);
    } else {
      assignments.delete(normalizedLogin(assignee));
    }
    activeAssignments.set(issueNumber, assignments);
  }
  const startedAtByIssueNumber = new Map<number, string>();
  for (const [issueNumber, assignments] of activeAssignments.entries()) {
    const activeStarts = Array.from(assignments.values()).sort();
    if (activeStarts.length > 0) {
      startedAtByIssueNumber.set(issueNumber, activeStarts[0]);
    }
  }
  return startedAtByIssueNumber;
}

function testingIssueContextsWithAssignmentEvidence(
  contexts: Map<number, TestingIssueContext>,
  assignmentStartedAtByIssueNumber: Map<number, string>
): Map<number, TestingIssueContext> {
  const next = new Map<number, TestingIssueContext>();
  for (const [issueNumber, context] of contexts.entries()) {
    const assignmentStartedAt = assignmentStartedAtByIssueNumber.get(issueNumber);
    next.set(
      issueNumber,
      assignmentStartedAt
        ? {
            ...context,
            queueAgeHours: hoursSince(assignmentStartedAt),
            queueStartedAt: assignmentStartedAt,
            queueAgeEvidence: "issue_assignment_event"
          }
        : context
    );
  }
  return next;
}

function testingIssueContextForLinkedIssues(
  linkedIssueNumbers: number[],
  contexts: Map<number, TestingIssueContext>
): TestingIssueContext | null {
  const matches = linkedIssueNumbers
    .map((issueNumber) => contexts.get(issueNumber))
    .filter(Boolean) as TestingIssueContext[];
  if (matches.length === 0) {
    return null;
  }
  const queueAges = matches
    .map((context) => context.queueAgeHours)
    .filter((value): value is number => value !== null && Number.isFinite(value));
  const queueStartedAtValues = matches
    .map((context) => context.queueStartedAt)
    .filter((value): value is string => value !== null);
  return {
    issueNumber: matches[0].issueNumber,
    testers: uniqueValues(matches.flatMap((context) => context.testers)),
    signals: uniqueValues(matches.flatMap((context) => context.signals)),
    queueAgeHours: queueAges.length === 0 ? null : Math.max(...queueAges),
    queueStartedAt: queueStartedAtValues.length === 0 ? null : queueStartedAtValues.sort()[0],
    queueAgeEvidence: matches.some((context) => context.queueAgeEvidence === "issue_assignment_event")
      ? "issue_assignment_event"
      : "issue_cache_timestamp"
  };
}

function averageHours(values: Array<number | null>): number | null {
  const valid = values.filter((value): value is number => value !== null && Number.isFinite(value) && value > 0);
  return valid.length === 0
    ? null
    : Math.round((valid.reduce((sum, value) => sum + value, 0) / valid.length) * 10) / 10;
}

function testingIssueQueueViews(
  issueRows: RowData[],
  contexts: Map<number, TestingIssueContext>,
  pullRequests: PersonalPullRequestView[]
): TestingIssueQueueView[] {
  const linkedPrsByIssue = new Map<number, TestingIssueQueueView["linkedPullRequests"]>();
  for (const pr of pullRequests) {
    if (pr.state !== "open") {
      continue;
    }
    for (const issueNumber of pr.linkedIssueNumbers) {
      const linkedPrs = linkedPrsByIssue.get(issueNumber) ?? [];
      linkedPrs.push({
        number: pr.number,
        title: pr.title,
        htmlUrl: pr.htmlUrl,
        ownerLogin: pr.ownerLogin,
        ageHours: pr.ageHours,
        reviewDecision: pr.reviewDecision,
        mergeStateStatus: pr.mergeStateStatus,
        ciState: pr.ciState,
        attentionFlags: pr.attentionFlags,
        isComplete: pr.isComplete
      });
      linkedPrsByIssue.set(issueNumber, linkedPrs);
    }
  }

  return issueRows
    .map((row) => {
      const issueNumber = asNumber(row.number);
      const context = contexts.get(issueNumber);
      if (!context) {
        return null;
      }
      const linkedPullRequests = [...(linkedPrsByIssue.get(issueNumber) ?? [])].sort(
        (left, right) =>
          right.attentionFlags.length - left.attentionFlags.length ||
          right.ageHours - left.ageHours ||
          left.number - right.number
      );
      return {
        number: issueNumber,
        title: asString(row.title),
        htmlUrl: asString(row.html_url),
        testers: context.testers,
        queueAgeHours: context.queueAgeHours,
        queueStartedAt: context.queueStartedAt,
        queueAgeEvidence: context.queueAgeEvidence,
        linkedPullRequests,
        isComplete: asBoolean(row.is_complete),
        syncError: row.sync_error ? asString(row.sync_error) : null,
        lastSyncedAt: fromSqlDate(row.last_synced_at) ?? new Date().toISOString()
      } satisfies TestingIssueQueueView;
    })
    .filter((issue): issue is TestingIssueQueueView => issue !== null)
    .sort((left, right) => (right.queueAgeHours ?? 0) - (left.queueAgeHours ?? 0) || left.number - right.number);
}

function testingAttentionFlags(flags: string[], context: TestingIssueContext | null, thresholdHours: number): string[] {
  const next = flags.filter((flag) => flag !== "testing_stalled");
  if (
    context?.queueAgeHours !== null &&
    context?.queueAgeHours !== undefined &&
    context.queueAgeHours >= thresholdHours
  ) {
    next.push("testing_stalled");
  }
  return uniqueValues(next);
}

function applyIssueTestingContextToPendingPrView<T extends PendingPrView | PersonalPullRequestView>(
  profile: RepoProfile,
  pr: T,
  contexts: Map<number, TestingIssueContext>
): T {
  if ("state" in pr && pr.state === "closed") {
    return {
      ...pr,
      testingState: "closed_or_merged",
      testingTesters: [],
      testingSignals: [],
      testingQueueAgeHours: null,
      attentionFlags: testingAttentionFlags(pr.attentionFlags, null, profile.thresholds.prNoActionAttentionHours)
    };
  }
  const context = testingIssueContextForLinkedIssues(pr.linkedIssueNumbers, contexts);
  if (!context) {
    return {
      ...pr,
      testingState: "not_ready",
      testingTesters: [],
      testingSignals: [],
      testingQueueAgeHours: null,
      attentionFlags: testingAttentionFlags(pr.attentionFlags, null, profile.thresholds.prNoActionAttentionHours)
    };
  }
  return {
    ...pr,
    testingState: "testing",
    testingTesters: context.testers,
    testingSignals: context.signals,
    testingQueueAgeHours: context.queueAgeHours,
    attentionFlags: testingAttentionFlags(pr.attentionFlags, context, profile.thresholds.prNoActionAttentionHours)
  };
}

function applyIssueTestingContextToLinkedPrView(
  profile: RepoProfile,
  pr: CriticalIssueLinkedPullRequestView,
  contexts: Map<number, TestingIssueContext>
): CriticalIssueLinkedPullRequestView {
  if (pr.state === "closed") {
    return {
      ...pr,
      testingState: "closed_or_merged",
      testingTesters: [],
      testingQueueAgeHours: null,
      attentionFlags: testingAttentionFlags(pr.attentionFlags, null, profile.thresholds.prNoActionAttentionHours)
    };
  }
  const context = testingIssueContextForLinkedIssues(pr.linkedIssueNumbers, contexts);
  if (!context) {
    return {
      ...pr,
      testingState: "not_ready",
      testingTesters: [],
      testingQueueAgeHours: null,
      attentionFlags: testingAttentionFlags(pr.attentionFlags, null, profile.thresholds.prNoActionAttentionHours)
    };
  }
  return {
    ...pr,
    testingState: "testing",
    testingTesters: context.testers,
    testingQueueAgeHours: context.queueAgeHours,
    attentionFlags: testingAttentionFlags(pr.attentionFlags, context, profile.thresholds.prNoActionAttentionHours)
  };
}

function toCriticalIssueLinkedPullRequestView(row: RowData): CriticalIssueLinkedPullRequestView {
  return {
    number: asNumber(row.number),
    title: asString(row.title),
    htmlUrl: asString(row.html_url),
    state: asString(row.state) === "closed" ? "closed" : "open",
    ownerLogin: asString(row.owner_login),
    ageHours: asNumber(row.age_hours),
    lastHumanActionAt: fromSqlDate(row.last_human_action_at) ?? new Date().toISOString(),
    reviewDecision: row.review_decision ? asString(row.review_decision) : null,
    mergeStateStatus: row.merge_state_status ? asString(row.merge_state_status) : null,
    ciState: row.ci_state ? asString(row.ci_state) : null,
    testingState: row.testing_state
      ? (asString(row.testing_state) as CriticalIssueLinkedPullRequestView["testingState"])
      : "not_ready",
    testingTesters: parseJsonArray(asString(row.testing_testers_json)),
    testingQueueAgeHours:
      row.testing_queue_age_hours === null || row.testing_queue_age_hours === undefined
        ? null
        : asNumber(row.testing_queue_age_hours),
    attentionFlags: parseJsonArray(asString(row.attention_flags_json)),
    linkedIssueNumbers: linkedIssueNumbersForPullRequestRow(row),
    isComplete: asNumber(row.is_complete) === 1
  };
}

function linkedPullRequestsByIssueNumber(
  rows: RowData[],
  issueNumbers: Set<number>,
  profile: RepoProfile,
  testingIssueContexts: Map<number, TestingIssueContext>
): Map<number, CriticalIssueLinkedPullRequestView[]> {
  const linked = new Map<number, CriticalIssueLinkedPullRequestView[]>();
  for (const row of rows) {
    const matchedNumbers = linkedIssueNumbersForPullRequestRow(row).filter((number) => issueNumbers.has(number));
    if (matchedNumbers.length === 0) {
      continue;
    }
    const view = applyIssueTestingContextToLinkedPrView(
      profile,
      toCriticalIssueLinkedPullRequestView(row),
      testingIssueContexts
    );
    for (const issueNumber of matchedNumbers) {
      const existing = linked.get(issueNumber) ?? [];
      if (!existing.some((pr) => pr.number === view.number)) {
        existing.push(view);
      }
      linked.set(issueNumber, existing.slice(0, 8));
    }
  }
  return linked;
}

function blockerForPrFlag(pr: CriticalIssueLinkedPullRequestView, flag: string): CriticalIssueBlockerView {
  const message = (value: string): string =>
    pr.isComplete ? value : `${value} Partial PR evidence until detail backfill completes.`;
  if (flag === "merge_conflict") {
    return {
      key: `pr:${pr.number}:merge_conflict`,
      severity: "critical",
      message: message(`PR #${pr.number} has a merge conflict.`),
      relatedPrNumber: pr.number
    };
  }
  if (flag === "ci_failed") {
    return {
      key: `pr:${pr.number}:ci_failed`,
      severity: "warning",
      message: message(`PR #${pr.number} has failing CI.`),
      relatedPrNumber: pr.number
    };
  }
  if (flag === "requested_changes") {
    return {
      key: `pr:${pr.number}:requested_changes`,
      severity: "warning",
      message: message(`PR #${pr.number} has unresolved requested changes.`),
      relatedPrNumber: pr.number
    };
  }
  if (flag === "review_requested_no_response") {
    return {
      key: `pr:${pr.number}:review_requested_no_response`,
      severity: "warning",
      message: message(`PR #${pr.number} has a stale review request without reviewer response.`),
      relatedPrNumber: pr.number
    };
  }
  if (flag === "no_human_action_24h") {
    return {
      key: `pr:${pr.number}:no_human_action_24h`,
      severity: "warning",
      message: message(`PR #${pr.number} has no recent human action.`),
      relatedPrNumber: pr.number
    };
  }
  if (flag === "testing_stalled") {
    return {
      key: `pr:${pr.number}:testing_stalled`,
      severity: "warning",
      message: message(`PR #${pr.number} is stalled in testing handoff.`),
      relatedPrNumber: pr.number
    };
  }
  return {
    key: `pr:${pr.number}:${flag}`,
    severity: "warning",
    message: message(`PR #${pr.number} needs attention: ${flag}.`),
    relatedPrNumber: pr.number
  };
}

export function criticalIssueBlockersFromCache(input: {
  ownerLogin: string | null;
  aiEffortLabel: string | null;
  isComplete: boolean;
  syncError: string | null;
  linkedPullRequests: CriticalIssueLinkedPullRequestView[];
}): CriticalIssueBlockerView[] {
  const blockers: CriticalIssueBlockerView[] = [];
  if (!input.ownerLogin) {
    blockers.push({
      key: "issue:unowned",
      severity: "critical",
      message: "Active s-1/s0 issue has no owner in cache.",
      relatedPrNumber: null
    });
  }
  if (input.syncError) {
    blockers.push({
      key: "issue:sync_error",
      severity: "warning",
      message: "Issue sync has an error; cache evidence may be stale.",
      relatedPrNumber: null
    });
  }
  if (!input.isComplete) {
    blockers.push({
      key: "issue:partial_cache",
      severity: "info",
      message: "Issue evidence is partial until detail backfill completes.",
      relatedPrNumber: null
    });
  }
  if (input.linkedPullRequests.length === 0) {
    blockers.push({
      key: "issue:no_linked_pr_in_cache",
      severity: "info",
      message: "No linked PR is visible in cache.",
      relatedPrNumber: null
    });
  }
  for (const pr of input.linkedPullRequests) {
    for (const flag of pr.attentionFlags) {
      blockers.push(blockerForPrFlag(pr, flag));
    }
  }
  return blockers.slice(0, 12);
}

function criticalIssueLastHumanAction(input: {
  row: RowData;
  commentEvidence?: NonNullable<NormalizedIssue["commentEvidence"]>;
}): Pick<CriticalIssueView, "lastHumanActionAt" | "lastHumanActionEvidence"> {
  if (input.commentEvidence?.isComplete) {
    const latestHumanCommentAt = input.commentEvidence.comments
      .filter((comment) => !isBotLogin(comment.authorLogin))
      .map((comment) => comment.updatedAt || comment.createdAt)
      .sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0];
    return {
      lastHumanActionAt: latestHumanCommentAt ?? fromSqlDate(input.row.created_at),
      lastHumanActionEvidence: "complete_cache"
    };
  }
  return {
    lastHumanActionAt: fromSqlDate(input.row.updated_at) ?? fromSqlDate(input.row.created_at),
    lastHumanActionEvidence: "partial_cache"
  };
}

function isBotLogin(login: string): boolean {
  const normalized = login.toLowerCase();
  return normalized.endsWith("[bot]") || normalized.includes("bot");
}

function toCriticalIssueView(
  row: RowData,
  linkedPullRequests: CriticalIssueLinkedPullRequestView[] = [],
  watchedUsers: string[] = [],
  skipUsers: string[] = [],
  commentEvidence?: NonNullable<NormalizedIssue["commentEvidence"]>,
  criticalStartedAt: string | null = null
): CriticalIssueView {
  const ownerLogin = row.owner_login ? asString(row.owner_login) : null;
  const skippedLogins = normalizedLoginSet(skipUsers);
  const aiEffortLabel = row.ai_effort_label ? asString(row.ai_effort_label) : "ai-easy";
  const syncError = row.sync_error ? asString(row.sync_error) : null;
  const isComplete = asNumber(row.is_complete) === 1;
  const lastHumanAction = criticalIssueLastHumanAction({ row, commentEvidence });
  return {
    number: asNumber(row.number),
    title: asString(row.title),
    htmlUrl: asString(row.html_url),
    severity: row.severity ? asString(row.severity) : null,
    ownerLogin,
    ownerScope: criticalIssueOwnerScope(ownerLogin, watchedUsers),
    ownerReason: row.owner_reason ? asString(row.owner_reason) : null,
    workflowSkipped: workflowSkippedFromSet(ownerLogin, skippedLogins),
    lifecycleState: asString(row.lifecycle_state) as CriticalIssueView["lifecycleState"],
    aiEffortLabel,
    ageHours: issueAgeHours(row),
    criticalStartedAt,
    criticalAgeHours: hoursSince(criticalStartedAt),
    criticalAgeEvidence: criticalStartedAt ? "issue_timeline_event" : "missing_timeline",
    lastHumanActionAt: lastHumanAction.lastHumanActionAt,
    lastHumanActionEvidence: lastHumanAction.lastHumanActionEvidence,
    sourceUpdatedAt: fromSqlDate(row.updated_at) ?? new Date().toISOString(),
    lastSyncedAt: fromSqlDate(row.last_synced_at) ?? new Date().toISOString(),
    syncError,
    isComplete,
    labels: parseJsonArray(asString(row.labels_json)),
    linkedPullRequests,
    blockers: criticalIssueBlockersFromCache({
      ownerLogin,
      aiEffortLabel,
      isComplete,
      syncError,
      linkedPullRequests
    })
  };
}

function toPersonalIssueView(row: RowData): PersonalIssueView {
  return {
    number: asNumber(row.number),
    title: asString(row.title),
    htmlUrl: asString(row.html_url),
    severity: row.severity ? asString(row.severity) : null,
    lifecycleState: asString(row.lifecycle_state) as PersonalIssueView["lifecycleState"],
    ageHours: issueAgeHours(row),
    lastSyncedAt: fromSqlDate(row.last_synced_at) ?? new Date().toISOString(),
    isComplete: asNumber(row.is_complete) === 1,
    labels: parseJsonArray(asString(row.labels_json))
  };
}

function toPendingPrView(row: RowData): PendingPrView {
  return {
    number: asNumber(row.number),
    title: asString(row.title),
    htmlUrl: asString(row.html_url),
    ownerLogin: asString(row.owner_login),
    draft: asNumber(row.draft) === 1,
    ageHours: asNumber(row.age_hours),
    lastHumanActionAt: fromSqlDate(row.last_human_action_at) ?? new Date().toISOString(),
    reviewDecision: row.review_decision ? asString(row.review_decision) : null,
    mergeStateStatus: row.merge_state_status ? asString(row.merge_state_status) : null,
    ciState: row.ci_state ? asString(row.ci_state) : null,
    latestReviewState: row.latest_review_state ? asString(row.latest_review_state) : null,
    latestReviewSubmittedAt: fromSqlDate(row.latest_review_submitted_at),
    latestCommitAt: fromSqlDate(row.latest_commit_at),
    detailSyncedAt: fromSqlDate(row.detail_synced_at),
    detailError: row.detail_error ? asString(row.detail_error) : null,
    testingState: row.testing_state ? (asString(row.testing_state) as PendingPrView["testingState"]) : "not_ready",
    testingTesters: parseJsonArray(asString(row.testing_testers_json)),
    testingSignals: parseJsonArray(asString(row.testing_signals_json)),
    testingQueueAgeHours:
      row.testing_queue_age_hours === null || row.testing_queue_age_hours === undefined
        ? null
        : asNumber(row.testing_queue_age_hours),
    attentionFlags: parseJsonArray(asString(row.attention_flags_json)),
    linkedIssueNumbers: linkedIssueNumbersForPullRequestRow(row),
    isComplete: asNumber(row.is_complete) === 1
  };
}

function toPersonalPullRequestView(row: RowData): PersonalPullRequestView {
  return {
    ...toPendingPrView(row),
    state: asString(row.state) === "closed" ? "closed" : "open",
    createdAt: fromSqlDate(row.created_at) ?? new Date().toISOString(),
    mergedAt: fromSqlDate(row.merged_at)
  };
}

function notificationTraceFromRow(profile: RepoProfile, row: RowData): NotificationTraceView {
  return {
    status: row.notification_status ? (asString(row.notification_status) as NotificationTraceView["status"]) : null,
    recipientScope: row.notification_recipient ? notificationRecipientScope(profile, row.notification_recipient) : null,
    attemptedAt: fromSqlDate(row.notification_attempted_at),
    acknowledgedAt: fromSqlDate(row.notification_acknowledged_at),
    acknowledgedBy: row.notification_acknowledged_by ? asString(row.notification_acknowledged_by) : null
  };
}

function recentDateKeys(days: number, timezone: string): string[] {
  const keys: string[] = [];
  const now = Date.now();
  for (let offset = Math.max(days, 1) - 1; offset >= 0; offset -= 1) {
    const key = dateKeyInTimezone(new Date(now - offset * 24 * 60 * 60 * 1000).toISOString(), timezone);
    if (key) {
      keys.push(key);
    }
  }
  return Array.from(new Set(keys)).slice(-days);
}

function newMetricPoint(date: string, scopeType: "team" | "person", scopeKey: string): DailyMetricPoint {
  return {
    date,
    scopeType,
    scopeKey,
    prsCreated: 0,
    prsMerged: 0,
    issuesOpened: 0,
    issuesClosed: 0,
    issuesDeferred: 0,
    workflowViolationsDetected: 0,
    activeCriticalIssues: 0,
    averageActiveCriticalIssueAgeHours: null,
    needsTriageIssues: 0,
    averageNeedsTriageIssueAgeHours: null,
    deferredIssues: 0,
    averageDeferredIssueAgeHours: null,
    pendingPrs: 0,
    averagePendingPrAgeHours: null,
    attentionPrs: 0,
    ciFailedPrs: 0,
    requestedChangePrs: 0,
    reviewWaitingPrs: 0,
    mergeConflictPrs: 0,
    testingQueuePrs: 0,
    averageTestingQueueAgeHours: null,
    sourceCompleteness: "partial_cache",
    generatedAt: new Date().toISOString()
  };
}

function metricKey(date: string, scopeType: "team" | "person", scopeKey: string): string {
  return `${date}:${scopeType}:${scopeKey}`;
}

function bumpMetric(
  metrics: Map<string, DailyMetricPoint>,
  dateKeys: Set<string>,
  date: string | null,
  scopeType: "team" | "person",
  scopeKey: string,
  field: keyof Pick<
    DailyMetricPoint,
    "prsCreated" | "prsMerged" | "issuesOpened" | "issuesClosed" | "issuesDeferred" | "workflowViolationsDetected"
  >
): void {
  if (!date || !dateKeys.has(date)) {
    return;
  }
  const key = metricKey(date, scopeType, scopeKey);
  const point = metrics.get(key);
  if (point) {
    point[field] += 1;
  }
}

function metricSnapshotAt(dateKey: string, timezone: string): Date {
  const { end } = calendarDayRangeInTimezone(dateKey, timezone);
  const now = new Date();
  return end.getTime() > now.getTime() ? now : end;
}

function isOpenAt(row: RowData, asOf: Date): boolean {
  const createdAt = fromSqlDate(row.created_at);
  if (!createdAt || new Date(createdAt).getTime() >= asOf.getTime()) {
    return false;
  }
  const closedAt = fromSqlDate(row.closed_at);
  return !closedAt || new Date(closedAt).getTime() >= asOf.getTime();
}

function isPendingPullRequestAt(row: RowData, asOf: Date): boolean {
  const createdAt = fromSqlDate(row.created_at);
  if (!createdAt || new Date(createdAt).getTime() >= asOf.getTime()) {
    return false;
  }
  const finishedAt = fromSqlDate(row.merged_at) ?? fromSqlDate(row.closed_at);
  return !finishedAt || new Date(finishedAt).getTime() >= asOf.getTime();
}

function ageHoursAt(row: RowData, asOf: Date): number | null {
  const createdAt = fromSqlDate(row.created_at);
  if (!createdAt) {
    return null;
  }
  return Math.max(0, Math.round(((asOf.getTime() - new Date(createdAt).getTime()) / 3_600_000) * 10) / 10);
}

function averageOrNull(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10;
}

function isTestingQueueState(value: string): boolean {
  return ["dev_done", "test_requested", "testing", "test_changes_requested"].includes(value);
}

const failedCiStates = new Set(["failure", "failed", "error", "timed_out", "action_required", "cancelled"]);

function normalizedRowState(row: RowData, key: string): string {
  return asString(row[key]).toLowerCase();
}

function prHasReviewWaitingSignal(row: RowData, attentionFlags: string[]): boolean {
  if (attentionFlags.includes("review_requested_no_response")) {
    return true;
  }
  return (
    parseJsonArray(asString(row.requested_reviewers_json)).length > 0 &&
    !normalizedRowState(row, "review_decision") &&
    !normalizedRowState(row, "latest_review_state") &&
    !fromSqlDate(row.latest_review_submitted_at)
  );
}

function copyMetricSnapshot(target: DailyMetricPoint, source: DailyMetricPoint): void {
  target.activeCriticalIssues = source.activeCriticalIssues;
  target.averageActiveCriticalIssueAgeHours = source.averageActiveCriticalIssueAgeHours;
  target.needsTriageIssues = source.needsTriageIssues;
  target.averageNeedsTriageIssueAgeHours = source.averageNeedsTriageIssueAgeHours;
  target.deferredIssues = source.deferredIssues;
  target.averageDeferredIssueAgeHours = source.averageDeferredIssueAgeHours;
  target.pendingPrs = source.pendingPrs;
  target.averagePendingPrAgeHours = source.averagePendingPrAgeHours;
  target.attentionPrs = source.attentionPrs;
  target.ciFailedPrs = source.ciFailedPrs;
  target.requestedChangePrs = source.requestedChangePrs;
  target.reviewWaitingPrs = source.reviewWaitingPrs;
  target.mergeConflictPrs = source.mergeConflictPrs;
  target.testingQueuePrs = source.testingQueuePrs;
  target.averageTestingQueueAgeHours = source.averageTestingQueueAgeHours;
}

function applyBacklogSnapshotMetrics(input: {
  metrics: Map<string, DailyMetricPoint>;
  dateKeys: string[];
  profile: RepoProfile;
  issueRows: RowData[];
  prRows: RowData[];
}): void {
  const people = input.profile.people.watchedUsers;
  const criticalLabels = input.profile.labels.critical;
  const currentDate = dateKeyInTimezone(new Date(), input.profile.reporting.timezone);

  for (const date of input.dateKeys) {
    const asOf = metricSnapshotAt(date, input.profile.reporting.timezone);
    const points = [input.metrics.get(metricKey(date, "team", "all"))].filter(
      (point): point is DailyMetricPoint => point !== undefined
    );
    for (const login of people) {
      const point = input.metrics.get(metricKey(date, "person", login));
      if (point) {
        points.push(point);
      }
    }

    for (const point of points) {
      const activeCriticalAges: number[] = [];
      const needsTriageAges: number[] = [];
      const deferredAges: number[] = [];
      const pendingPrAges: number[] = [];
      const testingQueueAges: number[] = [];

      for (const row of input.issueRows) {
        const owner = row.owner_login ? asString(row.owner_login) : "";
        if (point.scopeType === "person" && owner !== point.scopeKey) {
          continue;
        }
        if (!isOpenAt(row, asOf)) {
          continue;
        }
        const lifecycleState = asString(row.lifecycle_state);
        const severity = row.severity ? asString(row.severity) : null;
        const ageHours = ageHoursAt(row, asOf);
        if (ageHours === null) {
          continue;
        }
        if (severity && criticalLabels.includes(severity)) {
          point.activeCriticalIssues += 1;
          activeCriticalAges.push(ageHours);
        }
        if (isPersonalNeedsTriageIssue({ lifecycleState, severity }, criticalLabels)) {
          point.needsTriageIssues += 1;
          needsTriageAges.push(ageHours);
        }
        if (lifecycleState === "deferred") {
          point.deferredIssues += 1;
          deferredAges.push(ageHours);
        }
      }

      for (const row of input.prRows) {
        const owner = asString(row.owner_login);
        if (point.scopeType === "person" && owner !== point.scopeKey) {
          continue;
        }
        if (!isPendingPullRequestAt(row, asOf)) {
          continue;
        }
        const ageHours = ageHoursAt(row, asOf);
        if (ageHours === null) {
          continue;
        }
        point.pendingPrs += 1;
        pendingPrAges.push(ageHours);
        const attentionFlags = parseJsonArray(asString(row.attention_flags_json));
        if (attentionFlags.length > 0) {
          point.attentionPrs += 1;
        }
        if (attentionFlags.includes("ci_failed") || failedCiStates.has(normalizedRowState(row, "ci_state"))) {
          point.ciFailedPrs += 1;
        }
        if (
          attentionFlags.includes("requested_changes") ||
          normalizedRowState(row, "review_decision") === "changes_requested" ||
          normalizedRowState(row, "latest_review_state") === "changes_requested"
        ) {
          point.requestedChangePrs += 1;
        }
        if (prHasReviewWaitingSignal(row, attentionFlags)) {
          point.reviewWaitingPrs += 1;
        }
        if (attentionFlags.includes("merge_conflict") || normalizedRowState(row, "merge_state_status") === "dirty") {
          point.mergeConflictPrs += 1;
        }
        if (isTestingQueueState(asString(row.testing_state))) {
          point.testingQueuePrs += 1;
          const currentQueueAge =
            row.testing_queue_age_hours === null || row.testing_queue_age_hours === undefined
              ? null
              : asNumber(row.testing_queue_age_hours);
          if (currentQueueAge !== null && date === currentDate) {
            testingQueueAges.push(currentQueueAge);
          }
        }
      }

      point.averageActiveCriticalIssueAgeHours = averageOrNull(activeCriticalAges);
      point.averageNeedsTriageIssueAgeHours = averageOrNull(needsTriageAges);
      point.averageDeferredIssueAgeHours = averageOrNull(deferredAges);
      point.averagePendingPrAgeHours = averageOrNull(pendingPrAges);
      point.averageTestingQueueAgeHours = averageOrNull(testingQueueAges);
    }
  }
}

function utcDateFromKey(dateKey: string): Date {
  return new Date(`${dateKey}T00:00:00.000Z`);
}

function dateKeyFromUtcDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function addMonthsToDateKey(dateKey: string, months: number): string {
  const value = utcDateFromKey(dateKey);
  value.setUTCMonth(value.getUTCMonth() + months);
  return dateKeyFromUtcDate(value);
}

function weekStartDateKey(dateKey: string, weekStart: RepoProfile["reporting"]["weekStart"]): string {
  const value = utcDateFromKey(dateKey);
  const day = value.getUTCDay();
  const offset = weekStart === "Monday" ? (day === 0 ? 6 : day - 1) : day;
  value.setUTCDate(value.getUTCDate() - offset);
  return dateKeyFromUtcDate(value);
}

function monthStartDateKey(dateKey: string): string {
  return `${dateKey.slice(0, 7)}-01`;
}

function metricPeriodBounds(
  dateKey: string,
  period: AggregatedMetricPoint["period"],
  weekStart: RepoProfile["reporting"]["weekStart"]
): { start: string; end: string; label: string } {
  const start = period === "week" ? weekStartDateKey(dateKey, weekStart) : monthStartDateKey(dateKey);
  const end = period === "week" ? addDaysToDateKey(start, 7) : addMonthsToDateKey(start, 1);
  const label = period === "week" ? `${start.slice(5)}-${addDaysToDateKey(end, -1).slice(5)}` : start.slice(0, 7);
  return { start, end, label };
}

function latestIso(left: string, right: string): string {
  return new Date(left).getTime() >= new Date(right).getTime() ? left : right;
}

function latestIsoOrNull(values: string[]): string | null {
  return values.reduce<string | null>((latest, value) => (latest ? latestIso(latest, value) : value), null);
}

export function aggregateMetricPoints(
  points: DailyMetricPoint[],
  period: AggregatedMetricPoint["period"],
  weekStart: RepoProfile["reporting"]["weekStart"]
): AggregatedMetricPoint[] {
  const aggregates = new Map<string, AggregatedMetricPoint>();

  for (const point of points) {
    const bounds = metricPeriodBounds(point.date, period, weekStart);
    const key = `${period}:${bounds.start}:${point.scopeType}:${point.scopeKey}`;
    const existing = aggregates.get(key);
    if (!existing) {
      aggregates.set(key, {
        ...point,
        date: bounds.start,
        period,
        periodStart: bounds.start,
        periodEnd: bounds.end,
        label: bounds.label
      });
      continue;
    }

    existing.prsCreated += point.prsCreated;
    existing.prsMerged += point.prsMerged;
    existing.issuesOpened += point.issuesOpened;
    existing.issuesClosed += point.issuesClosed;
    existing.issuesDeferred += point.issuesDeferred;
    existing.workflowViolationsDetected += point.workflowViolationsDetected;
    copyMetricSnapshot(existing, point);
    existing.generatedAt = latestIso(existing.generatedAt, point.generatedAt);
    existing.sourceCompleteness =
      existing.sourceCompleteness === "complete_cache" && point.sourceCompleteness === "complete_cache"
        ? "complete_cache"
        : "partial_cache";
  }

  return Array.from(aggregates.values()).sort((left, right) => {
    const dateOrder = left.periodStart.localeCompare(right.periodStart);
    if (dateOrder !== 0) {
      return dateOrder;
    }
    const scopeOrder = left.scopeType.localeCompare(right.scopeType);
    if (scopeOrder !== 0) {
      return scopeOrder;
    }
    return left.scopeKey.localeCompare(right.scopeKey);
  });
}

export async function recomputeDailyMetricsFromCache(repoId: number, profile: RepoProfile, days = 30): Promise<number> {
  const pool = getPool();
  const keys = recentDateKeys(days, profile.reporting.timezone);
  const keySet = new Set(keys);
  const metrics = new Map<string, DailyMetricPoint>();
  const people = profile.people.watchedUsers;

  for (const date of keys) {
    const team = newMetricPoint(date, "team", "all");
    metrics.set(metricKey(date, "team", "all"), team);
    for (const login of people) {
      const person = newMetricPoint(date, "person", login);
      metrics.set(metricKey(date, "person", login), person);
    }
  }

  const [prRows] = await pool.execute<RowData[]>(
    `SELECT owner_login, created_at, closed_at, merged_at,
            requested_reviewers_json, review_decision, merge_state_status, ci_state,
            latest_review_state, latest_review_submitted_at,
            attention_flags_json, testing_state, testing_queue_age_hours
     FROM pull_requests
     WHERE repo_id = ?`,
    [repoId]
  );
  for (const row of prRows) {
    const owner = asString(row.owner_login);
    const createdDate = dateKeyInTimezone(row.created_at, profile.reporting.timezone);
    const mergedDate = dateKeyInTimezone(row.merged_at, profile.reporting.timezone);
    bumpMetric(metrics, keySet, createdDate, "team", "all", "prsCreated");
    bumpMetric(metrics, keySet, mergedDate, "team", "all", "prsMerged");
    if (people.includes(owner)) {
      bumpMetric(metrics, keySet, createdDate, "person", owner, "prsCreated");
      bumpMetric(metrics, keySet, mergedDate, "person", owner, "prsMerged");
    }
  }

  const [issueRows] = await pool.execute<RowData[]>(
    `SELECT owner_login, created_at, closed_at, lifecycle_state, severity
     FROM issues
     WHERE repo_id = ? AND is_pull_request = 0`,
    [repoId]
  );
  for (const row of issueRows) {
    const owner = row.owner_login ? asString(row.owner_login) : "";
    const createdDate = dateKeyInTimezone(row.created_at, profile.reporting.timezone);
    const closedDate = dateKeyInTimezone(row.closed_at, profile.reporting.timezone);
    bumpMetric(metrics, keySet, createdDate, "team", "all", "issuesOpened");
    bumpMetric(metrics, keySet, closedDate, "team", "all", "issuesClosed");
    if (row.lifecycle_state === "deferred") {
      bumpMetric(metrics, keySet, createdDate, "team", "all", "issuesDeferred");
    }
    if (people.includes(owner)) {
      bumpMetric(metrics, keySet, createdDate, "person", owner, "issuesOpened");
      bumpMetric(metrics, keySet, closedDate, "person", owner, "issuesClosed");
      if (row.lifecycle_state === "deferred") {
        bumpMetric(metrics, keySet, createdDate, "person", owner, "issuesDeferred");
      }
    }
  }

  const [violationRows] = await pool.execute<RowData[]>(
    `SELECT related_login, first_detected_at
     FROM workflow_violations
     WHERE repo_id = ? AND resolved_at IS NULL`,
    [repoId]
  );
  for (const row of violationRows) {
    const login = row.related_login ? asString(row.related_login) : "";
    const detectedDate = dateKeyInTimezone(row.first_detected_at, profile.reporting.timezone);
    bumpMetric(metrics, keySet, detectedDate, "team", "all", "workflowViolationsDetected");
    if (people.includes(login)) {
      bumpMetric(metrics, keySet, detectedDate, "person", login, "workflowViolationsDetected");
    }
  }

  applyBacklogSnapshotMetrics({ metrics, dateKeys: keys, profile, issueRows, prRows });

  const generatedAt = nowSql();
  await pool.execute("DELETE FROM daily_metrics WHERE repo_id = ?", [repoId]);
  for (const point of metrics.values()) {
    await pool.execute(
      `INSERT INTO daily_metrics(
        repo_id, metric_date, scope_type, scope_key, prs_created, prs_merged,
        issues_opened, issues_closed, issues_deferred, workflow_violations_detected,
        active_critical_issues, avg_active_critical_issue_age_hours,
        needs_triage_issues, avg_needs_triage_issue_age_hours,
        deferred_issues, avg_deferred_issue_age_hours,
        pending_prs, avg_pending_pr_age_hours, attention_prs,
        ci_failed_prs, requested_change_prs, review_waiting_prs, merge_conflict_prs,
        testing_queue_prs, avg_testing_queue_age_hours,
        source_completeness, generated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        repoId,
        point.date,
        point.scopeType,
        point.scopeKey,
        point.prsCreated,
        point.prsMerged,
        point.issuesOpened,
        point.issuesClosed,
        point.issuesDeferred,
        point.workflowViolationsDetected,
        point.activeCriticalIssues,
        point.averageActiveCriticalIssueAgeHours,
        point.needsTriageIssues,
        point.averageNeedsTriageIssueAgeHours,
        point.deferredIssues,
        point.averageDeferredIssueAgeHours,
        point.pendingPrs,
        point.averagePendingPrAgeHours,
        point.attentionPrs,
        point.ciFailedPrs,
        point.requestedChangePrs,
        point.reviewWaitingPrs,
        point.mergeConflictPrs,
        point.testingQueuePrs,
        point.averageTestingQueueAgeHours,
        point.sourceCompleteness,
        generatedAt
      ]
    );
  }

  return metrics.size;
}

export async function getDashboardDataVersion(repoId: number): Promise<string> {
  const [rows] = await getPool().execute<RowData[]>(
    `SELECT source_name, row_count, max_id, max_event_at, max_aux_at
     FROM (
       SELECT 'issues' AS source_name, COUNT(*) AS row_count, MAX(id) AS max_id,
              MAX(updated_at) AS max_event_at, MAX(last_synced_at) AS max_aux_at
       FROM issues WHERE repo_id = ?
       UNION ALL
       SELECT 'pull_requests' AS source_name, COUNT(*) AS row_count, MAX(id) AS max_id,
              MAX(updated_at) AS max_event_at, MAX(last_synced_at) AS max_aux_at
       FROM pull_requests WHERE repo_id = ?
       UNION ALL
       SELECT 'pr_testing_events' AS source_name, COUNT(*) AS row_count, MAX(id) AS max_id,
              MAX(occurred_at) AS max_event_at, MAX(created_at) AS max_aux_at
       FROM pr_testing_events WHERE repo_id = ?
       UNION ALL
       SELECT 'issue_comment_syncs' AS source_name, COUNT(*) AS row_count, MAX(id) AS max_id,
              MAX(last_synced_at) AS max_event_at, MAX(last_synced_at) AS max_aux_at
       FROM issue_comment_syncs WHERE repo_id = ?
       UNION ALL
       SELECT 'issue_comments' AS source_name, COUNT(*) AS row_count, MAX(id) AS max_id,
              MAX(updated_at) AS max_event_at, MAX(last_synced_at) AS max_aux_at
       FROM issue_comments WHERE repo_id = ?
       UNION ALL
       SELECT 'issue_timeline_events' AS source_name, COUNT(*) AS row_count, MAX(id) AS max_id,
              MAX(occurred_at) AS max_event_at, MAX(last_synced_at) AS max_aux_at
       FROM issue_timeline_events WHERE repo_id = ?
       UNION ALL
       SELECT 'issue_timeline_syncs' AS source_name, COUNT(*) AS row_count, MAX(id) AS max_id,
              MAX(last_synced_at) AS max_event_at, MAX(last_synced_at) AS max_aux_at
       FROM issue_timeline_syncs WHERE repo_id = ?
       UNION ALL
       SELECT 'sync_runs' AS source_name, COUNT(*) AS row_count, MAX(id) AS max_id,
              MAX(started_at) AS max_event_at, MAX(finished_at) AS max_aux_at
       FROM sync_runs WHERE repo_id = ?
       UNION ALL
       SELECT 'workflow_violations' AS source_name, COUNT(*) AS row_count, MAX(id) AS max_id,
              MAX(last_detected_at) AS max_event_at, MAX(resolved_at) AS max_aux_at
       FROM workflow_violations WHERE repo_id = ?
       UNION ALL
       SELECT 'ai_drift_signals' AS source_name, COUNT(*) AS row_count, MAX(id) AS max_id,
              MAX(last_detected_at) AS max_event_at, MAX(resolved_at) AS max_aux_at
       FROM ai_drift_signals WHERE repo_id = ?
       UNION ALL
       SELECT 'daily_metrics' AS source_name, COUNT(*) AS row_count, MAX(id) AS max_id,
              MAX(generated_at) AS max_event_at, MAX(generated_at) AS max_aux_at
       FROM daily_metrics WHERE repo_id = ?
       UNION ALL
       SELECT 'notification_deliveries' AS source_name, COUNT(*) AS row_count, MAX(id) AS max_id,
              MAX(attempted_at) AS max_event_at, MAX(attempted_at) AS max_aux_at
       FROM notification_deliveries WHERE repo_id = ?
       UNION ALL
       SELECT 'notification_acknowledgements' AS source_name, COUNT(*) AS row_count, MAX(id) AS max_id,
              MAX(acknowledged_at) AS max_event_at, MAX(acknowledged_at) AS max_aux_at
       FROM notification_acknowledgements WHERE repo_id = ?
       UNION ALL
       SELECT 'github_webhook_deliveries' AS source_name, COUNT(*) AS row_count, MAX(id) AS max_id,
              MAX(received_at) AS max_event_at, MAX(processed_at) AS max_aux_at
       FROM github_webhook_deliveries WHERE repo_id = ?
       UNION ALL
       SELECT 'write_action_executions' AS source_name, COUNT(*) AS row_count, MAX(id) AS max_id,
              MAX(started_at) AS max_event_at, MAX(finished_at) AS max_aux_at
       FROM write_action_executions WHERE repo_id = ?
       UNION ALL
       SELECT 'manual_refresh_requests' AS source_name, COUNT(*) AS row_count, MAX(id) AS max_id,
              MAX(created_at) AS max_event_at, MAX(created_at) AS max_aux_at
       FROM manual_refresh_requests WHERE repo_id = ?
       UNION ALL
       SELECT 'attention_items' AS source_name, COUNT(*) AS row_count, MAX(id) AS max_id,
              MAX(last_detected_at) AS max_event_at, MAX(resolved_at) AS max_aux_at
       FROM attention_items WHERE repo_id = ?
     ) version_sources
     ORDER BY source_name`,
    Array.from({ length: 17 }, () => repoId)
  );

  const normalized = rows.map((row) => ({
    source: asString(row.source_name),
    count: asNumber(row.row_count),
    maxId: asNumber(row.max_id),
    maxEventAt: fromSqlDate(row.max_event_at) ?? "",
    maxAuxAt: fromSqlDate(row.max_aux_at) ?? ""
  }));
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}

export async function getDashboardSummary(
  profile: RepoProfile,
  repoId: number,
  viewer: DashboardViewer = { authenticated: false, userId: null }
): Promise<DashboardSummary> {
  const pool = getPool();
  const visibleClasses = visibleClassesForDashboard(profile, viewer);
  const criticalVisibility = dashboardVisibilityFilter("i", profile, viewer);
  const prVisibility = dashboardVisibilityFilter("p", profile, viewer);
  const issueListVisibility = dashboardVisibilityFilter("i", profile, viewer);
  const allPrVisibility = dashboardVisibilityFilter("p", profile, viewer);
  const partialIssueVisibility = dashboardVisibilityFilter("i", profile, viewer);
  const partialPrVisibility = dashboardVisibilityFilter("p", profile, viewer);
  const staleIssueVisibility = dashboardVisibilityFilter("i", profile, viewer);
  const stalePrVisibility = dashboardVisibilityFilter("p", profile, viewer);
  const violationIssueVisibility = dashboardVisibilityFilter("i", profile, viewer);
  const violationPrVisibility = dashboardVisibilityFilter("p", profile, viewer);
  const attentionIssueVisibility = dashboardVisibilityFilter("i", profile, viewer);
  const attentionPrVisibility = dashboardVisibilityFilter("p", profile, viewer);
  const driftIssueVisibility = dashboardVisibilityFilter("i", profile, viewer);
  const driftPrVisibility = dashboardVisibilityFilter("p", profile, viewer);
  const personalIssueVisibility = dashboardVisibilityFilter("i", profile, viewer);
  const personalPrVisibility = dashboardVisibilityFilter("p", profile, viewer);
  const linkedPrVisibility = dashboardVisibilityFilter("p", profile, viewer);
  const timelineEventVisibility = dashboardVisibilityFilter("e", profile, viewer);
  const testingEventVisibility = dashboardVisibilityFilter("e", profile, viewer);
  const hiddenIssueVisibility = dashboardVisibilityFilter("i", profile, viewer);
  const hiddenPrVisibility = dashboardVisibilityFilter("p", profile, viewer);
  const { start, end } = previousCalendarDayRange(profile.reporting.timezone);
  const startSql = sqlDate(start) ?? "1970-01-01 00:00:00";
  const endSql = sqlDate(end) ?? "1970-01-01 00:00:00";
  const watchedUserPlaceholders = profile.people.watchedUsers.map(() => "?").join(", ");
  const hiddenIssueExpression = `SUM(CASE WHEN ${hiddenIssueVisibility.sql} THEN 0 ELSE 1 END)`;
  const hiddenPrExpression = `SUM(CASE WHEN ${hiddenPrVisibility.sql} THEN 0 ELSE 1 END)`;
  const staleThresholdHours = cacheStaleHoursFromEnv();
  const staleCutoff = sqlDate(new Date(Date.now() - staleThresholdHours * 3_600_000)) ?? "1970-01-01 00:00:00";
  const criticalSeverityRank = severityRankSql("i.severity", profile.labels.critical);
  const [criticalRows] = await pool.execute<RowData[]>(
    `SELECT * FROM issues i
     WHERE i.repo_id = ?
       AND i.state = 'open'
       AND i.severity IN (${profile.labels.critical.map(() => "?").join(", ")})
       AND ${criticalVisibility.sql}
     ORDER BY ${criticalSeverityRank}, i.updated_at ASC
     LIMIT 100`,
    [repoId, ...profile.labels.critical, ...criticalVisibility.params, ...profile.labels.critical]
  );
  const [prRows] = await pool.execute<RowData[]>(
    `SELECT * FROM pull_requests p
     WHERE p.repo_id = ? AND p.state = 'open'
       AND ${prVisibility.sql}
     ORDER BY updated_at ASC
     LIMIT 300`,
    [repoId, ...prVisibility.params]
  );
  const [issueRows] = await pool.execute<RowData[]>(
    `SELECT i.number, i.title, i.html_url, i.owner_login, i.lifecycle_state, i.severity, i.state, i.is_pull_request,
            i.assignees_json, i.created_at, i.updated_at, i.is_complete, i.sync_error, i.last_synced_at
     FROM issues i
     WHERE i.repo_id = ? AND ${issueListVisibility.sql}`,
    [repoId, ...issueListVisibility.params]
  );
  const [allPrRows] = await pool.execute<RowData[]>(
    `SELECT *
     FROM pull_requests p
     WHERE p.repo_id = ? AND ${allPrVisibility.sql}`,
    [repoId, ...allPrVisibility.params]
  );
  const [recentTestingEventRows] = await pool.execute<RowData[]>(
    `SELECT *
     FROM pr_testing_events e
     WHERE e.repo_id = ? AND ${testingEventVisibility.sql}
     ORDER BY e.occurred_at DESC, e.id DESC
     LIMIT 200`,
    [repoId, ...testingEventVisibility.params]
  );
  const [testingTurnoverRows] = await pool.execute<RowData[]>(
    `SELECT *
     FROM pr_testing_events e
     WHERE e.repo_id = ? AND ${testingEventVisibility.sql}
     ORDER BY e.pr_number ASC, e.occurred_at ASC, e.id ASC
     LIMIT 5000`,
    [repoId, ...testingEventVisibility.params]
  );
  const [syncRows] = await pool.execute<RowData[]>(
    `SELECT latest.sync_layer,
            latest.status,
            latest.started_at,
            latest.error_message,
            latest.rate_limit_remaining,
            latest.raw_json,
            summary.last_successful_at,
            failure.last_failed_at,
            failure.last_failure_message
     FROM sync_runs latest
     JOIN (
       SELECT sync_layer,
              MAX(id) AS latest_id,
              MAX(CASE WHEN status = 'success' THEN finished_at ELSE NULL END) AS last_successful_at
       FROM sync_runs
       WHERE repo_id = ?
       GROUP BY sync_layer
     ) summary ON summary.latest_id = latest.id
     LEFT JOIN (
       SELECT failed_latest.sync_layer,
              failed_latest.finished_at AS last_failed_at,
              failed_latest.error_message AS last_failure_message
       FROM sync_runs failed_latest
       JOIN (
         SELECT sync_layer,
                MAX(id) AS last_failed_id
         FROM sync_runs
         WHERE repo_id = ? AND status IN ('failed', 'blocked')
         GROUP BY sync_layer
       ) failed_summary ON failed_summary.last_failed_id = failed_latest.id
     ) failure ON failure.sync_layer = latest.sync_layer
     WHERE latest.repo_id = ?
     ORDER BY latest.id DESC
     LIMIT 20`,
    [repoId, repoId, repoId]
  );
  const [partialRows] = await pool.execute<RowData[]>(
    `SELECT
       SUM(CASE WHEN is_complete = 0 THEN 1 ELSE 0 END) AS partial_count
     FROM (
       SELECT i.is_complete FROM issues i WHERE i.repo_id = ? AND ${partialIssueVisibility.sql}
       UNION ALL
       SELECT p.is_complete FROM pull_requests p WHERE p.repo_id = ? AND ${partialPrVisibility.sql}
     ) t`,
    [repoId, ...partialIssueVisibility.params, repoId, ...partialPrVisibility.params]
  );
  const [staleRows] = await pool.execute<RowData[]>(
    activeCacheStaleSummarySql({
      staleCutoff,
      issueWhereSql: staleIssueVisibility.sql,
      pullRequestWhereSql: stalePrVisibility.sql
    }),
    [repoId, ...staleIssueVisibility.params, repoId, ...stalePrVisibility.params]
  );
  const [staleSampleRows] = await pool.execute<RowData[]>(
    `SELECT *
     FROM (
       SELECT 'issue' AS object_type,
              i.number,
              i.title,
              i.html_url,
              i.owner_login,
              i.state,
              i.visibility_class,
              i.source_auth_type,
              i.last_synced_at,
              i.updated_at AS source_updated_at,
              i.is_complete,
              i.sync_error
       FROM issues i
       WHERE i.repo_id = ?
         AND i.state = 'open'
         AND i.is_pull_request = 0
         AND i.last_synced_at < ?
         AND ${staleIssueVisibility.sql}
       UNION ALL
       SELECT 'pull_request' AS object_type,
              p.number,
              p.title,
              p.html_url,
              p.owner_login,
              p.state,
              p.visibility_class,
              p.source_auth_type,
              p.last_synced_at,
              p.updated_at AS source_updated_at,
              p.is_complete,
              p.sync_error
       FROM pull_requests p
       WHERE p.repo_id = ?
         AND p.state = 'open'
         AND p.last_synced_at < ?
         AND ${stalePrVisibility.sql}
     ) cache_samples
     ORDER BY last_synced_at ASC
     LIMIT 12`,
    [repoId, staleCutoff, ...staleIssueVisibility.params, repoId, staleCutoff, ...stalePrVisibility.params]
  );
  const [partialSampleRows] = await pool.execute<RowData[]>(
    `SELECT *
     FROM (
       SELECT 'issue' AS object_type,
              i.number,
              i.title,
              i.html_url,
              i.owner_login,
              i.state,
              i.visibility_class,
              i.source_auth_type,
              i.last_synced_at,
              i.updated_at AS source_updated_at,
              i.is_complete,
              i.sync_error
       FROM issues i
       WHERE i.repo_id = ?
         AND i.state = 'open'
         AND i.is_pull_request = 0
         AND i.is_complete = 0
         AND ${partialIssueVisibility.sql}
       UNION ALL
       SELECT 'pull_request' AS object_type,
              p.number,
              p.title,
              p.html_url,
              p.owner_login,
              p.state,
              p.visibility_class,
              p.source_auth_type,
              p.last_synced_at,
              p.updated_at AS source_updated_at,
              p.is_complete,
              p.sync_error
       FROM pull_requests p
       WHERE p.repo_id = ?
         AND p.state = 'open'
         AND p.is_complete = 0
         AND ${partialPrVisibility.sql}
     ) cache_samples
     ORDER BY last_synced_at ASC
     LIMIT 12`,
    [repoId, ...partialIssueVisibility.params, repoId, ...partialPrVisibility.params]
  );
  const [hiddenIssueRows] = await pool.execute<RowData[]>(
    `SELECT ${hiddenIssueExpression} AS hidden_issues FROM issues i WHERE i.repo_id = ?`,
    [...hiddenIssueVisibility.params, repoId]
  );
  const [hiddenPrRows] = await pool.execute<RowData[]>(
    `SELECT ${hiddenPrExpression} AS hidden_pull_requests FROM pull_requests p WHERE p.repo_id = ?`,
    [...hiddenPrVisibility.params, repoId]
  );
  const [violationRows] = await pool.execute<RowData[]>(
    `SELECT v.*,
            vnd.status AS notification_status,
            vnd.recipient AS notification_recipient,
            vnd.attempted_at AS notification_attempted_at,
            vna.acknowledged_at AS notification_acknowledged_at,
            vna.github_login AS notification_acknowledged_by
     FROM workflow_violations v
     LEFT JOIN (
       SELECT nd.*
       FROM notification_deliveries nd
       INNER JOIN (
         SELECT repo_id, source_type, source_id, MAX(id) AS latest_id
         FROM notification_deliveries
         WHERE source_type = 'workflow_violation'
         GROUP BY repo_id, source_type, source_id
       ) latest ON latest.latest_id = nd.id
     ) vnd ON vnd.repo_id = v.repo_id
       AND vnd.source_type = 'workflow_violation'
       AND vnd.source_id = v.id
     LEFT JOIN notification_acknowledgements vna ON vna.notification_delivery_id = vnd.id
     WHERE v.repo_id = ? AND v.resolved_at IS NULL
       AND (
         (v.object_type = 'issue' AND EXISTS (
           SELECT 1 FROM issues i
           WHERE i.repo_id = v.repo_id AND i.number = v.object_number AND ${violationIssueVisibility.sql}
         ))
         OR
         (v.object_type = 'pull_request' AND EXISTS (
           SELECT 1 FROM pull_requests p
           WHERE p.repo_id = v.repo_id AND p.number = v.object_number AND ${violationPrVisibility.sql}
         ))
       )
     ORDER BY
       CASE v.severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
       v.last_detected_at DESC
     LIMIT 100`,
    [repoId, ...violationIssueVisibility.params, ...violationPrVisibility.params]
  );
  const [attentionItemRows] = await pool.execute<RowData[]>(
    `SELECT a.related_login, a.severity
     FROM attention_items a
     WHERE a.repo_id = ? AND a.resolved_at IS NULL
       AND (
         a.object_number IS NULL
         OR
         (a.object_type = 'issue' AND EXISTS (
           SELECT 1 FROM issues i
           WHERE i.repo_id = a.repo_id AND i.number = a.object_number AND ${attentionIssueVisibility.sql}
         ))
         OR
         (a.object_type = 'pull_request' AND EXISTS (
           SELECT 1 FROM pull_requests p
           WHERE p.repo_id = a.repo_id AND p.number = a.object_number AND ${attentionPrVisibility.sql}
         ))
       )
     ORDER BY
       CASE a.severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
       a.last_detected_at DESC
     LIMIT 200`,
    [repoId, ...attentionIssueVisibility.params, ...attentionPrVisibility.params]
  );
  const [metricRows] = await pool.execute<RowData[]>(
    `SELECT *
     FROM daily_metrics
     WHERE repo_id = ?
     ORDER BY metric_date ASC, scope_type ASC, scope_key ASC`,
    [repoId]
  );
  const [driftRows] = await pool.execute<RowData[]>(
    `SELECT d.*,
            dnd.status AS notification_status,
            dnd.recipient AS notification_recipient,
            dnd.attempted_at AS notification_attempted_at,
            dna.acknowledged_at AS notification_acknowledged_at,
            dna.github_login AS notification_acknowledged_by
     FROM ai_drift_signals d
     LEFT JOIN (
       SELECT nd.*
       FROM notification_deliveries nd
       INNER JOIN (
         SELECT repo_id, source_type, source_id, MAX(id) AS latest_id
         FROM notification_deliveries
         WHERE source_type = 'ai_drift_signal'
         GROUP BY repo_id, source_type, source_id
       ) latest ON latest.latest_id = nd.id
     ) dnd ON dnd.repo_id = d.repo_id
       AND dnd.source_type = 'ai_drift_signal'
       AND dnd.source_id = d.id
     LEFT JOIN notification_acknowledgements dna ON dna.notification_delivery_id = dnd.id
     WHERE d.repo_id = ? AND d.resolved_at IS NULL
       AND (
         (d.object_type = 'issue' AND EXISTS (
           SELECT 1 FROM issues i
           WHERE i.repo_id = d.repo_id AND i.number = d.object_number AND ${driftIssueVisibility.sql}
         ))
         OR
         (d.object_type = 'pull_request' AND EXISTS (
           SELECT 1 FROM pull_requests p
           WHERE p.repo_id = d.repo_id AND p.number = d.object_number AND ${driftPrVisibility.sql}
         ))
       )
     ORDER BY
       CASE d.severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
       d.actual_hours DESC,
       d.last_detected_at DESC
     LIMIT 100`,
    [repoId, ...driftIssueVisibility.params, ...driftPrVisibility.params]
  );
  const [personalIssueRows] =
    profile.people.watchedUsers.length === 0
      ? [[] as RowData[]]
      : await pool.execute<RowData[]>(
          `SELECT *
           FROM issues i
           WHERE i.repo_id = ?
             AND i.state = 'open'
             AND i.owner_login IN (${watchedUserPlaceholders})
             AND (
               i.severity IN (${profile.labels.critical.map(() => "?").join(", ")})
               OR i.lifecycle_state IN ('needs-triage', 'deferred')
             )
             AND ${personalIssueVisibility.sql}
           ORDER BY
             CASE WHEN i.severity IS NULL THEN 1 ELSE 0 END,
             ${criticalSeverityRank},
             CASE i.lifecycle_state WHEN 'needs-triage' THEN 0 WHEN 'deferred' THEN 1 ELSE 2 END,
             i.updated_at ASC
           LIMIT 500`,
          [
            repoId,
            ...profile.people.watchedUsers,
            ...profile.labels.critical,
            ...personalIssueVisibility.params,
            ...profile.labels.critical
          ]
        );
  const [personalPrRows] =
    profile.people.watchedUsers.length === 0
      ? [[] as RowData[]]
      : await pool.execute<RowData[]>(
          `SELECT *
           FROM pull_requests p
           WHERE p.repo_id = ?
             AND p.owner_login IN (${watchedUserPlaceholders})
             AND (
               p.state = 'open'
               OR (p.created_at >= ? AND p.created_at < ?)
               OR (p.merged_at >= ? AND p.merged_at < ?)
             )
             AND ${personalPrVisibility.sql}
           ORDER BY p.updated_at DESC
           LIMIT 500`,
          [repoId, ...profile.people.watchedUsers, startSql, endSql, startSql, endSql, ...personalPrVisibility.params]
        );
  const criticalIssueNumbers = new Set([
    ...criticalRows.map((row) => asNumber(row.number)),
    ...personalIssueRows
      .filter((row) => profile.labels.critical.includes(asString(row.severity)))
      .map((row) => asNumber(row.number))
  ]);
  const criticalSeverityByIssueNumber = new Map<number, string>();
  for (const row of [...criticalRows, ...personalIssueRows]) {
    const issueNumber = asNumber(row.number);
    const severity = row.severity ? asString(row.severity) : null;
    if (issueNumber > 0 && severity && profile.labels.critical.includes(severity)) {
      criticalSeverityByIssueNumber.set(issueNumber, severity);
    }
  }
  const criticalStartedAtMap = await criticalStartedAtByIssueNumber(
    repoId,
    criticalSeverityByIssueNumber,
    timelineEventVisibility.sql,
    timelineEventVisibility.params
  );
  const [linkedPrCandidateRows] =
    criticalIssueNumbers.size === 0
      ? [[] as RowData[]]
      : await pool.execute<RowData[]>(
          `SELECT *
           FROM pull_requests p
           WHERE p.repo_id = ?
             AND ${linkedPrVisibility.sql}
           ORDER BY CASE WHEN p.state = 'open' THEN 0 ELSE 1 END, p.updated_at DESC
           LIMIT 500`,
          [repoId, ...linkedPrVisibility.params]
        );
  const baseTestingIssueContexts = testingIssueContextsByNumber(profile, issueRows);
  const testingAssignmentStartedAtMap = await testingAssignmentStartedAtByIssueNumber(
    repoId,
    baseTestingIssueContexts,
    timelineEventVisibility.sql,
    timelineEventVisibility.params
  );
  const testingIssueContexts = testingIssueContextsWithAssignmentEvidence(
    baseTestingIssueContexts,
    testingAssignmentStartedAtMap
  );
  const linkedPrsByIssueNumber = linkedPullRequestsByIssueNumber(
    linkedPrCandidateRows,
    criticalIssueNumbers,
    profile,
    testingIssueContexts
  );
  const criticalIssueCommentEvidence = await issueCommentEvidenceByIssueNumber(
    repoId,
    Array.from(criticalIssueNumbers)
  );
  const criticalIssues: CriticalIssueView[] = criticalRows.map((row) =>
    toCriticalIssueView(
      row,
      linkedPrsByIssueNumber.get(asNumber(row.number)) ?? [],
      profile.people.watchedUsers,
      profile.workflow.skipUsers,
      criticalIssueCommentEvidence.get(asNumber(row.number)),
      criticalStartedAtMap.get(asNumber(row.number)) ?? null
    )
  );
  const pendingPrs: PendingPrView[] = prRows.map((row) =>
    applyIssueTestingContextToPendingPrView(profile, toPendingPrView(row), testingIssueContexts)
  );
  const allPrViews = allPrRows.map((row) =>
    applyIssueTestingContextToPendingPrView(profile, toPersonalPullRequestView(row), testingIssueContexts)
  );
  const testingIssueViews = testingIssueQueueViews(issueRows, testingIssueContexts, allPrViews);

  const workflowViolations: WorkflowViolationView[] = violationRows.map((row) => ({
    objectType: asString(row.object_type) as WorkflowViolationView["objectType"],
    objectNumber: asNumber(row.object_number),
    title: asString(row.title),
    htmlUrl: asString(row.html_url),
    ruleKey: asString(row.rule_key),
    severity: asString(row.severity) as WorkflowViolationView["severity"],
    relatedLogin: row.related_login ? asString(row.related_login) : null,
    evidenceSummary: asString(row.evidence_summary),
    suggestedAction: asString(row.suggested_action),
    fixable: asNumber(row.fixable) === 1,
    firstDetectedAt: fromSqlDate(row.first_detected_at) ?? new Date().toISOString(),
    lastDetectedAt: fromSqlDate(row.last_detected_at) ?? new Date().toISOString(),
    notification: notificationTraceFromRow(profile, row)
  }));

  const aiDriftSignals: AiDriftSignalView[] = driftRows.map((row) => ({
    objectType: asString(row.object_type) as AiDriftSignalView["objectType"],
    objectNumber: asNumber(row.object_number),
    title: asString(row.title),
    htmlUrl: asString(row.html_url),
    ruleKey: asString(row.rule_key),
    severity: asString(row.severity) as AiDriftSignalView["severity"],
    ownerLogin: row.owner_login ? asString(row.owner_login) : null,
    aiEffortLabel: row.ai_effort_label ? asString(row.ai_effort_label) : "ai-easy",
    expectedHours:
      row.expected_hours === null || row.expected_hours === undefined ? null : asNumber(row.expected_hours),
    actualHours: row.actual_hours === null || row.actual_hours === undefined ? null : asNumber(row.actual_hours),
    evidenceSummary: asString(row.evidence_summary),
    suggestedAction: asString(row.suggested_action),
    sourceCompleteness: asString(row.source_completeness) as AiDriftSignalView["sourceCompleteness"],
    firstDetectedAt: fromSqlDate(row.first_detected_at) ?? new Date().toISOString(),
    lastDetectedAt: fromSqlDate(row.last_detected_at) ?? new Date().toISOString(),
    notification: notificationTraceFromRow(profile, row)
  }));

  const people: PersonSummary[] = profile.people.watchedUsers.map((login) => {
    const ownedIssues = issueRows.filter((row) => row.owner_login === login && row.state === "open");
    const ownedPrs = allPrViews.filter((pr) => pr.ownerLogin === login);
    return {
      login,
      activeCriticalIssues: ownedIssues.filter((row) => profile.labels.critical.includes(asString(row.severity)))
        .length,
      needsTriageIssues: ownedIssues.filter((row) =>
        isPersonalNeedsTriageIssue(
          {
            lifecycleState: asString(row.lifecycle_state),
            severity: row.severity ? asString(row.severity) : null
          },
          profile.labels.critical
        )
      ).length,
      deferredIssues: ownedIssues.filter((row) => row.lifecycle_state === "deferred").length,
      prsCreatedYesterday: ownedPrs.filter((pr) => inRange(pr.createdAt, start, end)).length,
      prsMergedYesterday: ownedPrs.filter((pr) => inRange(pr.mergedAt, start, end)).length,
      pendingPrs: ownedPrs.filter((pr) => pr.state === "open").length,
      attentionPrs: ownedPrs.filter((pr) => pr.attentionFlags.length > 0).length
    };
  });

  const syncHealth: SyncHealth[] = buildSyncHealthSummary({ rows: syncRows, expectedLayers: syncHealthLayers });

  const dailyMetrics: DailyMetricPoint[] = metricRows.map((row) => ({
    date: asString(row.metric_date),
    scopeType: asString(row.scope_type) as DailyMetricPoint["scopeType"],
    scopeKey: asString(row.scope_key),
    prsCreated: asNumber(row.prs_created),
    prsMerged: asNumber(row.prs_merged),
    issuesOpened: asNumber(row.issues_opened),
    issuesClosed: asNumber(row.issues_closed),
    issuesDeferred: asNumber(row.issues_deferred),
    workflowViolationsDetected: asNumber(row.workflow_violations_detected),
    activeCriticalIssues: asNumber(row.active_critical_issues),
    averageActiveCriticalIssueAgeHours:
      row.avg_active_critical_issue_age_hours === null || row.avg_active_critical_issue_age_hours === undefined
        ? null
        : asNumber(row.avg_active_critical_issue_age_hours),
    needsTriageIssues: asNumber(row.needs_triage_issues),
    averageNeedsTriageIssueAgeHours:
      row.avg_needs_triage_issue_age_hours === null || row.avg_needs_triage_issue_age_hours === undefined
        ? null
        : asNumber(row.avg_needs_triage_issue_age_hours),
    deferredIssues: asNumber(row.deferred_issues),
    averageDeferredIssueAgeHours:
      row.avg_deferred_issue_age_hours === null || row.avg_deferred_issue_age_hours === undefined
        ? null
        : asNumber(row.avg_deferred_issue_age_hours),
    pendingPrs: asNumber(row.pending_prs),
    averagePendingPrAgeHours:
      row.avg_pending_pr_age_hours === null || row.avg_pending_pr_age_hours === undefined
        ? null
        : asNumber(row.avg_pending_pr_age_hours),
    attentionPrs: asNumber(row.attention_prs),
    ciFailedPrs: asNumber(row.ci_failed_prs),
    requestedChangePrs: asNumber(row.requested_change_prs),
    reviewWaitingPrs: asNumber(row.review_waiting_prs),
    mergeConflictPrs: asNumber(row.merge_conflict_prs),
    testingQueuePrs: asNumber(row.testing_queue_prs),
    averageTestingQueueAgeHours:
      row.avg_testing_queue_age_hours === null || row.avg_testing_queue_age_hours === undefined
        ? null
        : asNumber(row.avg_testing_queue_age_hours),
    sourceCompleteness: asString(row.source_completeness) as DailyMetricPoint["sourceCompleteness"],
    generatedAt: fromSqlDate(row.generated_at) ?? new Date().toISOString()
  }));
  const weeklyMetrics = aggregateMetricPoints(dailyMetrics, "week", profile.reporting.weekStart);
  const monthlyMetrics = aggregateMetricPoints(dailyMetrics, "month", profile.reporting.weekStart);
  const hiddenIssues = asNumber(hiddenIssueRows[0]?.hidden_issues);
  const hiddenPullRequests = asNumber(hiddenPrRows[0]?.hidden_pull_requests);
  const hiddenObjects = hiddenIssues + hiddenPullRequests;
  const analyticsLimitedByVisibility = hiddenObjects > 0;
  const peopleByLogin = new Map(people.map((person) => [person.login, person]));
  const personalPrs = personalPrRows.map((row) =>
    applyIssueTestingContextToPendingPrView(profile, toPersonalPullRequestView(row), testingIssueContexts)
  );
  const personalViews: PersonalActionView[] = profile.people.watchedUsers.map((login) => {
    const ownedIssues = personalIssueRows.filter((row) => asString(row.owner_login) === login);
    const ownedPrs = personalPrs.filter((pr) => pr.ownerLogin === login);
    const pendingOwnedPrs = ownedPrs.filter((pr) => pr.state === "open");
    return {
      login,
      summary: peopleByLogin.get(login) ?? {
        login,
        activeCriticalIssues: 0,
        needsTriageIssues: 0,
        deferredIssues: 0,
        prsCreatedYesterday: 0,
        prsMergedYesterday: 0,
        pendingPrs: 0,
        attentionPrs: 0
      },
      activeCriticalIssues: ownedIssues
        .filter((row) => profile.labels.critical.includes(asString(row.severity)))
        .map((row) =>
          toCriticalIssueView(
            row,
            linkedPrsByIssueNumber.get(asNumber(row.number)) ?? [],
            profile.people.watchedUsers,
            profile.workflow.skipUsers,
            criticalIssueCommentEvidence.get(asNumber(row.number)),
            criticalStartedAtMap.get(asNumber(row.number)) ?? null
          )
        ),
      needsTriageIssues: ownedIssues
        .filter((row) =>
          isPersonalNeedsTriageIssue(
            {
              lifecycleState: asString(row.lifecycle_state),
              severity: row.severity ? asString(row.severity) : null
            },
            profile.labels.critical
          )
        )
        .map(toPersonalIssueView),
      deferredIssues: ownedIssues
        .filter((row) => asString(row.lifecycle_state) === "deferred")
        .map(toPersonalIssueView),
      pendingPrs: pendingOwnedPrs,
      attentionPrs: pendingOwnedPrs.filter((pr) => pr.attentionFlags.length > 0),
      testingPrs: pendingOwnedPrs.filter((pr) =>
        ["test_requested", "testing", "test_changes_requested"].includes(pr.testingState)
      ),
      prsCreatedYesterday: ownedPrs.filter((pr) => inRange(pr.createdAt, start, end)),
      prsMergedYesterday: ownedPrs.filter((pr) => inRange(pr.mergedAt, start, end)),
      analytics: analyticsLimitedByVisibility
        ? []
        : dailyMetrics.filter((point) => point.scopeType === "person" && point.scopeKey === login),
      analyticsWeekly: analyticsLimitedByVisibility
        ? []
        : weeklyMetrics.filter((point) => point.scopeType === "person" && point.scopeKey === login),
      analyticsMonthly: analyticsLimitedByVisibility
        ? []
        : monthlyMetrics.filter((point) => point.scopeType === "person" && point.scopeKey === login)
    };
  });

  const visibility: DashboardVisibility = {
    scope: viewer.authenticated ? "logged_in" : "anonymous",
    visibleClasses,
    hiddenIssues,
    hiddenPullRequests,
    hiddenObjects,
    note:
      hiddenObjects > 0
        ? `${hiddenObjects} cached GitHub objects are hidden from this view by repository visibility policy.`
        : null
  };
  const analytics: AnalyticsSummary = {
    periodDays: 30,
    sourceNote: analyticsLimitedByVisibility
      ? "Trend data is hidden because pre-aggregated metrics may include cached objects outside the current visibility scope."
      : "Trend data is derived from the local MatrixOne cache. It is partial until issue, PR, review, and timeline backfill are complete.",
    teamDaily: analyticsLimitedByVisibility ? [] : dailyMetrics.filter((point) => point.scopeType === "team"),
    teamWeekly: analyticsLimitedByVisibility ? [] : weeklyMetrics.filter((point) => point.scopeType === "team"),
    teamMonthly: analyticsLimitedByVisibility ? [] : monthlyMetrics.filter((point) => point.scopeType === "team"),
    peopleDaily: analyticsLimitedByVisibility ? [] : dailyMetrics.filter((point) => point.scopeType === "person"),
    peopleWeekly: analyticsLimitedByVisibility ? [] : weeklyMetrics.filter((point) => point.scopeType === "person"),
    peopleMonthly: analyticsLimitedByVisibility ? [] : monthlyMetrics.filter((point) => point.scopeType === "person")
  };
  const testingQueuePrs = allPrViews.filter(
    (pr) => pr.state === "open" && ["test_requested", "testing", "test_changes_requested"].includes(pr.testingState)
  );
  const queueAges = testingQueuePrs
    .map((pr) => pr.testingQueueAgeHours)
    .filter((value): value is number => value !== null && Number.isFinite(value) && value > 0);
  const issueQueueAges = testingIssueViews
    .map((issue) => issue.queueAgeHours)
    .filter((value): value is number => value !== null && Number.isFinite(value) && value > 0);
  const testerKeys = new Set([
    ...profile.people.testers,
    ...testingIssueViews.flatMap((issue) => issue.testers),
    ...testingQueuePrs.flatMap((pr) => pr.testingTesters)
  ]);
  const testingTurnoverTransitions = testingTransitionsForProfile(
    profile,
    testingTurnoverRows.map(testingTransitionViewFromRow)
  );
  const recentTestingTransitions = recentTestingTransitionsForProfile(
    profile,
    recentTestingEventRows.map(testingTransitionViewFromRow)
  );
  const recentIssueTestingTransitions = testingIssueTransitionsFromQueueIssues(testingIssueViews);
  const testingTurnover = testingTurnoverMetricsFromTransitions(testingTurnoverTransitions);
  const testingTurnoverByTester = testingTurnoverMetricsByTesterFromTransitions(testingTurnoverTransitions);
  const testing: TestingSummary = {
    queueIssues: testingIssueViews.length,
    queuePrs: testingQueuePrs.length,
    staleQueueIssues: testingIssueViews.filter(
      (issue) => (issue.queueAgeHours ?? 0) >= profile.thresholds.prNoActionAttentionHours
    ).length,
    staleQueuePrs: testingQueuePrs.filter(
      (pr) => (pr.testingQueueAgeHours ?? 0) >= profile.thresholds.prNoActionAttentionHours
    ).length,
    averageIssueQueueAgeHours: averageHours(issueQueueAges),
    averageQueueAgeHours: averageHours(queueAges),
    issueTransitionEvents: testingIssueViews.length,
    lastIssueTransitionAt: latestIsoOrNull(recentIssueTestingTransitions.map((transition) => transition.occurredAt)),
    transitionEvents: testingTurnoverTransitions.length,
    lastTransitionAt: latestIsoOrNull(testingTurnoverTransitions.map((transition) => transition.occurredAt)),
    ...testingTurnover,
    issues: testingIssueViews,
    recentIssueTransitions: recentIssueTestingTransitions,
    recentTransitions: recentTestingTransitions,
    testers: Array.from(testerKeys).map((login) => {
      const issues = testingIssueViews.filter((issue) => issue.testers.includes(login));
      const prs = testingQueuePrs.filter((pr) => pr.testingTesters.includes(login));
      const issueAges = issues.map((issue) => issue.queueAgeHours);
      const ages = prs.map((pr) => pr.testingQueueAgeHours);
      const turnover = testingTurnoverByTester.get(login) ?? emptyTestingTurnoverMetrics();
      return {
        login,
        queueIssues: issues.length,
        queuePrs: prs.length,
        averageIssueQueueAgeHours: averageHours(issueAges),
        averageQueueAgeHours: averageHours(ages),
        ...turnover
      };
    })
  };
  const jobQueue = await getJobQueueHealth();
  const worker: WorkerHealth = await getWorkerHealth();
  const webhooks = await getWebhookIngestionHealth(repoId);
  const writeActions: WriteActionExecutionView[] = await listWriteActionExecutionsForDashboard({
    repoId,
    profile,
    viewer
  });
  const criticalOwnershipCounts = criticalIssueOwnershipCounts(criticalIssues, profile.people.watchedUsers);
  const criticalOwnerCoverage = criticalIssueOwnerCoverage(criticalIssues);
  const notificationMappingCandidates = notificationEmployeeMappingCandidates(profile, [
    ...attentionItemRows.map((row) => ({
      relatedLogin: row.related_login ? asString(row.related_login) : null,
      severity: attentionSeverity(row.severity)
    })),
    ...workflowViolations.map((violation) => ({
      relatedLogin: violation.relatedLogin,
      severity: attentionSeverity(violation.severity)
    })),
    ...aiDriftSignals.map((signal) => ({
      relatedLogin: signal.ownerLogin,
      severity: attentionSeverity(signal.severity)
    }))
  ]);
  const notifications = await getNotificationHealth({
    repoId,
    profile,
    viewer,
    missingEmployeeMappings: notificationMappingCandidates.length
  });
  const oldestSyncedAt = fromSqlDate(staleRows[0]?.oldest_synced_at);
  const oldestCacheAgeHours = oldestSyncedAt
    ? Math.max(0, Math.round(((Date.now() - new Date(oldestSyncedAt).getTime()) / 3_600_000) * 10) / 10)
    : null;
  const profileActions = profileActionSuggestions(profile, criticalOwnerCoverage, notificationMappingCandidates);

  return {
    repo: {
      key: profile.key,
      owner: profile.repo.owner,
      name: profile.repo.name,
      timezone: profile.reporting.timezone
    },
    profileWarnings: profileConfigurationWarnings({ profile, env: process.env }),
    profileActions,
    profileSetup: profileSetupPlan(profile, profileActions),
    visibility,
    sync: {
      generatedAt: new Date().toISOString(),
      health: syncHealth,
      staleObjects: asNumber(staleRows[0]?.stale_count),
      staleThresholdHours,
      oldestCacheAgeHours,
      staleSamples: staleSampleRows.map((row) => cacheObjectEvidenceFromRow(row, staleCutoff)),
      partialObjects: asNumber(partialRows[0]?.partial_count),
      partialSamples: partialSampleRows.map((row) => cacheObjectEvidenceFromRow(row, staleCutoff)),
      jobQueue,
      worker
    },
    counts: {
      criticalIssues: criticalIssues.length,
      unownedCriticalIssues: criticalOwnershipCounts.unownedCriticalIssues,
      nonWatchedCriticalIssues: criticalOwnershipCounts.nonWatchedCriticalIssues,
      skippedCriticalIssues: criticalOwnershipCounts.skippedCriticalIssues,
      pendingPrs: pendingPrs.length,
      attentionPrs: pendingPrs.filter((pr) => pr.attentionFlags.length > 0).length,
      workflowViolations: workflowViolations.length,
      criticalWorkflowViolations: workflowViolations.filter((violation) => violation.severity === "critical").length,
      aiDriftSignals: aiDriftSignals.length,
      criticalAiDriftSignals: aiDriftSignals.filter((signal) => signal.severity === "critical").length
    },
    criticalIssues,
    criticalOwnerCoverage,
    people,
    personalViews,
    pendingPrs,
    workflowViolations,
    aiDriftSignals,
    writeActions,
    analytics,
    testing,
    notifications,
    webhooks
  };
}
