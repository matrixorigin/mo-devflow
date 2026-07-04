export type SourceAuthType = "anonymous" | "service_read_token" | "user_token";

export type VisibilityClass = "anonymous_readable" | "logged_in_readable" | "token_owner_only" | "admin_only";

export type LifecycleState = "needs-triage" | "deferred" | "active" | "other";

export type AttentionSeverity = "info" | "warning" | "critical";
export type TestingHandoffScope = "issue";

export interface TestingHandoffSignals {
  labels: string[];
  reviewerUsers: string[];
  assigneeUsers: string[];
  comments: string[];
}

export const supportedGitHubWebhookEvents = [
  "issues",
  "issue_comment",
  "pull_request",
  "pull_request_review",
  "workflow_run",
  "check_run"
] as const;
export type SupportedGitHubWebhookEvent = (typeof supportedGitHubWebhookEvents)[number];

export function isSupportedGitHubWebhookEvent(eventName: string): eventName is SupportedGitHubWebhookEvent {
  return (supportedGitHubWebhookEvents as readonly string[]).includes(eventName);
}

export interface RepoProfile {
  key: string;
  repo: {
    owner: string;
    name: string;
    localPath?: string;
  };
  reporting: {
    timezone: string;
    weekStart: "Monday" | "Sunday";
  };
  access: {
    anonymousRead: boolean;
    exposeUserTokenSyncedPrivateData: boolean;
    criticalScope: "repo-wide" | "watched-users";
    writeBackEnabled: boolean;
  };
  people: {
    watchedUsers: string[];
    testers: string[];
  };
  ownership: {
    issueOwnerPriority: Array<"assignee" | "linked_pr_author" | "author">;
    prOwner: "author" | "assignee";
    unownedBucket: boolean;
  };
  labels: {
    bug: string;
    needsTriage: string;
    deferred: string;
    critical: string[];
    active: string[];
    aiEffort: string[];
  };
  thresholds: {
    prNoActionAttentionHours: number;
    criticalNoActionAttentionHours: number;
    aiEasyS0ToTestAttentionDays: number;
    needsTriageStaleHours: number;
    prematureSeverityWindowHours: number;
    aiEasyCriticalCriticalDays: number;
  };
  testing: {
    handoffScope?: TestingHandoffScope;
    handoffSignals?: TestingHandoffSignals;
  };
  workflow: {
    skipUsers: string[];
  };
  notifications: {
    wecom: {
      enabled: boolean;
      webhookUrlEnv?: string;
      quietHours?: {
        start: string;
        end: string;
      };
    };
    employees: Record<string, { wecomUserId: string }>;
    routing: {
      cooldownHours: number;
      fallbackRecipient: string;
      escalateAfterHours: number;
    };
  };
  raw: unknown;
}

export interface ProfileConfigurationWarning {
  key: string;
  severity: AttentionSeverity;
  title: string;
  description: string;
  action: string;
}

export interface ProfileActionSuggestion {
  key: string;
  severity: AttentionSeverity;
  title: string;
  description: string;
  action: string;
  relatedLogins: string[];
  yamlSnippet: string | null;
}

export type ProfileSetupCapability = "watched_users" | "testing_handoff" | "notification_employees";

export interface ProfileSetupPlan {
  status: "complete" | "action_required";
  missingCapabilities: ProfileSetupCapability[];
  candidateLogins: string[];
  yamlPatch: string | null;
}

export interface RepoProfileConfigurationStatus {
  localCheckoutConfigured: boolean;
  watchedUsersConfigured: boolean;
  watchedUserCount: number;
  testersConfigured: boolean;
  testerCount: number;
  testingHandoffConfigured: boolean;
  workflowSkipUsersConfigured: boolean;
  workflowSkipUserCount: number;
  notificationEmployeesConfigured: boolean;
  notificationEmployeeCount: number;
  webhookSecretConfigured: boolean;
}

export function repoProfileConfigurationStatus(
  profile: RepoProfile,
  env: Record<string, string | undefined> = {}
): RepoProfileConfigurationStatus {
  const watchedUserCount = profile.people.watchedUsers.length;
  const testerCount = profile.people.testers.length;
  const workflowSkipUserCount = profile.workflow.skipUsers.length;
  const notificationEmployeeCount = Object.keys(profile.notifications.employees).length;
  const issueHandoffSignals = [
    ...(profile.people.testers ?? []),
    ...(profile.testing.handoffSignals?.assigneeUsers ?? []),
    ...(profile.testing.handoffSignals?.labels ?? [])
  ].filter((value) => value.trim().length > 0);

  return {
    localCheckoutConfigured: Boolean(profile.repo.localPath),
    watchedUsersConfigured: watchedUserCount > 0,
    watchedUserCount,
    testersConfigured: testerCount > 0,
    testerCount,
    testingHandoffConfigured: issueHandoffSignals.length > 0,
    workflowSkipUsersConfigured: workflowSkipUserCount > 0,
    workflowSkipUserCount,
    notificationEmployeesConfigured: notificationEmployeeCount > 0,
    notificationEmployeeCount,
    webhookSecretConfigured: Boolean(env.MO_DEVFLOW_GITHUB_WEBHOOK_SECRET?.trim())
  };
}

export interface NormalizedIssue {
  githubId: number;
  number: number;
  title: string;
  body: string;
  state: "open" | "closed";
  authorLogin: string;
  htmlUrl: string;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  labels: string[];
  assignees: string[];
  ownerLogin: string | null;
  ownerReason: string | null;
  lifecycleState: LifecycleState;
  severity: string | null;
  aiEffortLabel: string | null;
  criticalStartedAt?: string | null;
  testingHandoffStartedAt?: string | null;
  isPullRequest: boolean;
  sourceAuthType: SourceAuthType;
  sourceUserId: number | null;
  visibilityClass: VisibilityClass;
  isComplete: boolean;
  commentEvidence?: IssueCommentEvidence;
  rawPayload: unknown;
}

export interface NormalizedIssueComment extends IssueCommentEvidenceItem {
  githubId: number;
  issueNumber: number;
  htmlUrl: string;
  sourceAuthType: SourceAuthType;
  sourceUserId: number | null;
  visibilityClass: VisibilityClass;
  rawPayload: unknown;
}

export interface NormalizedIssueTimelineEvent {
  githubId: string;
  issueNumber: number;
  eventType: "labeled" | "unlabeled" | "assigned" | "unassigned";
  labelName: string | null;
  assigneeLogin: string | null;
  actorLogin: string | null;
  occurredAt: string;
  sourceAuthType: SourceAuthType;
  sourceUserId: number | null;
  visibilityClass: VisibilityClass;
  rawPayload: unknown;
}

export interface IssueCommentEvidence {
  isComplete: boolean;
  lastSyncedAt: string | null;
  syncError: string | null;
  comments: IssueCommentEvidenceItem[];
}

export type IssueCommentEvidenceState = "complete" | "pending" | "missing" | "error";

export interface IssueCommentEvidenceSummary {
  state: IssueCommentEvidenceState;
  lastSyncedAt: string | null;
  syncError: string | null;
}

export interface IssueCommentEvidenceItem {
  authorLogin: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}

export interface NormalizedPullRequest {
  githubId: number;
  number: number;
  title: string;
  state: "open" | "closed";
  authorLogin: string;
  ownerLogin: string;
  htmlUrl: string;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  mergedAt: string | null;
  draft: boolean;
  headRef: string;
  baseRef: string;
  labels: string[];
  assignees: string[];
  requestedReviewers: string[];
  ageHours: number;
  lastHumanActionAt: string;
  lastSystemActionAt: string | null;
  reviewDecision: string | null;
  mergeStateStatus: string | null;
  ciState: string | null;
  latestReviewState: string | null;
  latestReviewSubmittedAt: string | null;
  latestCommitAt: string | null;
  detailSyncedAt: string | null;
  detailError: string | null;
  testingState: TestingFlowState;
  testingTesters: string[];
  testingSignals: string[];
  testingQueueAgeHours: number | null;
  attentionFlags: string[];
  linkedIssueNumbers: number[];
  sourceAuthType: SourceAuthType;
  sourceUserId: number | null;
  visibilityClass: VisibilityClass;
  isComplete: boolean;
  rawPayload: unknown;
}

export interface PullRequestInsight {
  number: number;
  reviewDecision: string | null;
  mergeStateStatus: string | null;
  ciState: string | null;
  latestReviewState: string | null;
  latestReviewSubmittedAt: string | null;
  latestCommitAt: string | null;
  linkedIssueNumbers: number[];
  detailSyncedAt: string;
  detailError: string | null;
}

export interface CriticalIssueLinkedPullRequestView {
  number: number;
  title: string;
  htmlUrl: string;
  state: "open" | "closed";
  ownerLogin: string;
  ageHours: number;
  lastHumanActionAt: string;
  reviewDecision: string | null;
  mergeStateStatus: string | null;
  ciState: string | null;
  testingState: TestingFlowState;
  testingTesters: string[];
  testingQueueAgeHours: number | null;
  attentionFlags: string[];
  linkedIssueNumbers: number[];
  isComplete: boolean;
}

export interface CriticalIssueBlockerView {
  key: string;
  severity: AttentionSeverity;
  message: string;
  relatedPrNumber: number | null;
}

export type CriticalIssueOwnerScope = "unowned" | "watched" | "non_watched";
export type CriticalIssueAgeEvidence = "issue_timeline_event" | "missing_timeline";

export interface CriticalIssueView {
  number: number;
  title: string;
  htmlUrl: string;
  severity: string | null;
  ownerLogin: string | null;
  ownerScope: CriticalIssueOwnerScope;
  ownerReason: string | null;
  workflowSkipped: boolean;
  lifecycleState: LifecycleState;
  aiEffortLabel: string | null;
  ageHours: number;
  criticalStartedAt: string | null;
  criticalAgeHours: number | null;
  criticalAgeEvidence: CriticalIssueAgeEvidence;
  lastHumanActionAt: string | null;
  lastHumanActionEvidence: MetricSourceCompleteness;
  sourceUpdatedAt: string;
  lastSyncedAt: string;
  syncError: string | null;
  isComplete: boolean;
  labels: string[];
  linkedPullRequests: CriticalIssueLinkedPullRequestView[];
  blockers: CriticalIssueBlockerView[];
}

export interface CriticalOwnerCoverageView {
  ownerLogin: string | null;
  ownerScope: CriticalIssueOwnerScope;
  workflowSkipped: boolean;
  criticalIssues: number;
  averageAgeHours: number | null;
}

export interface PersonSummary {
  login: string;
  activeCriticalIssues: number;
  needsTriageIssues: number;
  deferredIssues: number;
  prsCreatedYesterday: number;
  prsMergedYesterday: number;
  pendingPrs: number;
  attentionPrs: number;
}

export interface PersonalIssueView {
  number: number;
  title: string;
  htmlUrl: string;
  severity: string | null;
  lifecycleState: LifecycleState;
  ageHours: number;
  lastSyncedAt: string;
  isComplete: boolean;
  commentEvidence: IssueCommentEvidenceSummary;
  labels: string[];
}

export interface PendingPrView {
  number: number;
  title: string;
  htmlUrl: string;
  ownerLogin: string;
  draft: boolean;
  ageHours: number;
  lastHumanActionAt: string;
  reviewDecision: string | null;
  mergeStateStatus: string | null;
  ciState: string | null;
  latestReviewState: string | null;
  latestReviewSubmittedAt: string | null;
  latestCommitAt: string | null;
  detailSyncedAt: string | null;
  detailError: string | null;
  testingState: TestingFlowState;
  testingTesters: string[];
  testingSignals: string[];
  testingQueueAgeHours: number | null;
  attentionFlags: string[];
  linkedIssueNumbers: number[];
  isComplete: boolean;
}

export interface PersonalPullRequestView extends PendingPrView {
  state: "open" | "closed";
  createdAt: string;
  mergedAt: string | null;
}

export interface PersonalActionView {
  login: string;
  summary: PersonSummary;
  activeCriticalIssues: CriticalIssueView[];
  needsTriageIssues: PersonalIssueView[];
  deferredIssues: PersonalIssueView[];
  pendingPrs: PersonalPullRequestView[];
  attentionPrs: PersonalPullRequestView[];
  testingIssues: TestingIssueQueueView[];
  testingPrs: PersonalPullRequestView[];
  prsCreatedYesterday: PersonalPullRequestView[];
  prsMergedYesterday: PersonalPullRequestView[];
  analytics: DailyMetricPoint[];
  analyticsWeekly: AggregatedMetricPoint[];
  analyticsMonthly: AggregatedMetricPoint[];
}

export type TestingFlowState =
  | "not_ready"
  | "dev_done"
  | "test_requested"
  | "testing"
  | "test_changes_requested"
  | "test_passed"
  | "closed_or_merged";

export interface TestingTransitionView {
  id: number;
  prNumber: number;
  fromState: TestingFlowState;
  toState: TestingFlowState;
  testingTesters: string[];
  testingSignals: string[];
  occurredAt: string;
  sourceCompleteness: MetricSourceCompleteness;
}

export interface TestingIssueTransitionView {
  id: number;
  issueNumber: number;
  fromState: TestingFlowState;
  toState: TestingFlowState;
  testingTesters: string[];
  testingSignals: string[];
  occurredAt: string;
  sourceCompleteness: MetricSourceCompleteness;
}

export interface TestingIssueLinkedPullRequestView {
  number: number;
  title: string;
  htmlUrl: string;
  ownerLogin: string;
  ageHours: number;
  reviewDecision: string | null;
  mergeStateStatus: string | null;
  ciState: string | null;
  attentionFlags: string[];
  isComplete: boolean;
}

export interface TestingIssueQueueView {
  number: number;
  title: string;
  htmlUrl: string;
  testers: string[];
  testingSignals: string[];
  queueAgeHours: number | null;
  queueStartedAt: string | null;
  queueAgeEvidence: "issue_assignment_event" | "issue_label_event" | "issue_cache_timestamp";
  linkedPullRequests: TestingIssueLinkedPullRequestView[];
  isComplete: boolean;
  syncError: string | null;
  lastSyncedAt: string;
}

export interface TestingSummary {
  queueIssues: number;
  queuePrs: number;
  staleQueueIssues: number;
  staleQueuePrs: number;
  averageIssueQueueAgeHours: number | null;
  averageQueueAgeHours: number | null;
  issueTransitionEvents: number;
  lastIssueTransitionAt: string | null;
  transitionEvents: number;
  lastTransitionAt: string | null;
  requestToPassSamples: number;
  passToCloseSamples: number;
  closedWithoutPassSignalSamples: number;
  averageRequestToPassHours: number | null;
  averagePassToCloseHours: number | null;
  issues: TestingIssueQueueView[];
  recentIssueTransitions: TestingIssueTransitionView[];
  recentTransitions: TestingTransitionView[];
  testers: Array<{
    login: string;
    queueIssues: number;
    queuePrs: number;
    averageIssueQueueAgeHours: number | null;
    averageQueueAgeHours: number | null;
    requestToPassSamples: number;
    passToCloseSamples: number;
    closedWithoutPassSignalSamples: number;
    averageRequestToPassHours: number | null;
    averagePassToCloseHours: number | null;
  }>;
}

export type WorkflowViolationObjectType = "issue" | "pull_request";
export type WorkflowViolationSeverity = "info" | "warning" | "critical";

export interface WorkflowViolation {
  objectType: WorkflowViolationObjectType;
  objectNumber: number;
  title: string;
  htmlUrl: string;
  ruleKey: string;
  severity: WorkflowViolationSeverity;
  relatedLogin: string | null;
  evidenceSummary: string;
  suggestedAction: string;
  fixable: boolean;
}

export interface WorkflowViolationView extends WorkflowViolation {
  firstDetectedAt: string;
  lastDetectedAt: string;
  notification: NotificationTraceView;
}

export type WorkflowFixActionKey = "add_needs_triage" | "move_to_deferred";

export type WorkflowFixOperation =
  | {
      type: "add_label";
      label: string;
    }
  | {
      type: "add_comment";
      body: string;
    }
  | {
      type: "remove_label";
      label: string;
    };

export type WorkflowFixStateSource = "cache" | "github";

export interface WorkflowFixStateSnapshot {
  source: WorkflowFixStateSource;
  state: "open" | "closed";
  labels: string[];
  assignees: string[];
  lifecycleState: LifecycleState | null;
  severity: string | null;
  aiEffortLabel: string | null;
  updatedAt: string | null;
}

export interface WorkflowFixPreview {
  previewId: string;
  actionKey: WorkflowFixActionKey;
  repoKey: string;
  objectType: WorkflowViolationObjectType;
  objectNumber: number;
  ruleKey: string;
  title: string;
  htmlUrl: string;
  reason: string;
  currentState: WorkflowFixStateSnapshot;
  proposedState: WorkflowFixStateSnapshot;
  operations: WorkflowFixOperation[];
  warnings: string[];
  blockedReason: string | null;
  createdAt: string;
  expiresAt: string;
}

export type WorkflowFixExecutionStatus = "success" | "failed" | "stale_preview" | "blocked" | "token_unavailable";
export type WriteActionKey = WorkflowFixActionKey | "acknowledge_notification" | "retry_notification";
export type WriteActionObjectType = WorkflowViolationObjectType | "notification_delivery";
export type WriteActionStatus = WorkflowFixExecutionStatus;

export interface WorkflowFixExecutionResult {
  previewId: string;
  status: WorkflowFixExecutionStatus;
  executedOperations: WorkflowFixOperation[];
  beforeState: WorkflowFixStateSnapshot | null;
  afterState: WorkflowFixStateSnapshot | null;
  message: string;
  errorMessage: string | null;
  executedAt: string;
}

export interface WriteActionExecutionView {
  id: number;
  previewId: string;
  githubLogin: string;
  actionKey: WriteActionKey;
  objectType: WriteActionObjectType;
  objectNumber: number;
  title: string;
  htmlUrl: string | null;
  status: WriteActionStatus;
  executedOperations: WorkflowFixOperation[];
  errorMessage: string | null;
  startedAt: string;
  finishedAt: string;
}

export type AiDriftObjectType = "issue" | "pull_request";
export type AiDriftSeverity = "info" | "warning" | "critical";

export interface AiDriftSignal {
  objectType: AiDriftObjectType;
  objectNumber: number;
  title: string;
  htmlUrl: string;
  ruleKey: string;
  severity: AiDriftSeverity;
  ownerLogin: string | null;
  aiEffortLabel: string | null;
  expectedHours: number | null;
  actualHours: number | null;
  evidenceSummary: string;
  suggestedAction: string;
  sourceCompleteness: MetricSourceCompleteness;
}

export interface AiDriftSignalView extends AiDriftSignal {
  firstDetectedAt: string;
  lastDetectedAt: string;
  notification: NotificationTraceView;
}

export type DailyMetricScopeType = "team" | "person";
export type MetricSourceCompleteness = "partial_cache" | "complete_cache";
export type MetricPeriod = "day" | "week" | "month";

export interface DailyMetricPoint {
  date: string;
  scopeType: DailyMetricScopeType;
  scopeKey: string;
  prsCreated: number;
  prsMerged: number;
  issuesOpened: number;
  issuesClosed: number;
  issuesDeferred: number;
  workflowViolationsDetected: number;
  activeCriticalIssues: number;
  averageActiveCriticalIssueAgeHours: number | null;
  needsTriageIssues: number;
  averageNeedsTriageIssueAgeHours: number | null;
  deferredIssues: number;
  averageDeferredIssueAgeHours: number | null;
  pendingPrs: number;
  averagePendingPrAgeHours: number | null;
  attentionPrs: number;
  ciFailedPrs: number;
  requestedChangePrs: number;
  reviewWaitingPrs: number;
  mergeConflictPrs: number;
  testingQueuePrs: number;
  averageTestingQueueAgeHours: number | null;
  sourceCompleteness: MetricSourceCompleteness;
  generatedAt: string;
}

export interface AggregatedMetricPoint extends DailyMetricPoint {
  period: Exclude<MetricPeriod, "day">;
  periodStart: string;
  periodEnd: string;
  label: string;
}

export interface AnalyticsSummary {
  periodDays: number;
  sourceNote: string;
  teamDaily: DailyMetricPoint[];
  teamWeekly: AggregatedMetricPoint[];
  teamMonthly: AggregatedMetricPoint[];
  peopleDaily: DailyMetricPoint[];
  peopleWeekly: AggregatedMetricPoint[];
  peopleMonthly: AggregatedMetricPoint[];
}

export type NotificationSourceType =
  "attention_item" | "workflow_violation" | "ai_drift_signal" | "daily_digest" | "weekly_digest" | "monthly_digest";
export type NotificationStatus =
  | "sent"
  | "failed_transient"
  | "failed_permanent"
  | "retry_requested"
  | "dry_run"
  | "skipped_disabled"
  | "skipped_no_webhook"
  | "skipped_quiet_hours";

export type NotificationRecipientScope = "fallback" | "mapped_employee";

export interface NotificationTraceView {
  status: NotificationStatus | null;
  recipientScope: NotificationRecipientScope | null;
  attemptedAt: string | null;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
}

export function emptyNotificationTrace(): NotificationTraceView {
  return {
    status: null,
    recipientScope: null,
    attemptedAt: null,
    acknowledgedAt: null,
    acknowledgedBy: null
  };
}

export interface NotificationCandidate {
  sourceType: NotificationSourceType;
  sourceId: number;
  ruleKey: string;
  severity: AttentionSeverity;
  objectType: string;
  objectNumber: number | null;
  title: string;
  htmlUrl: string | null;
  dashboardUrl: string;
  relatedLogin: string | null;
  recipient: string;
  dedupeKey: string;
  evidenceSummary: string;
  firstDetectedAt: string;
  lastDetectedAt: string;
}

export interface NotificationDeliveryView {
  id: number;
  sourceType: NotificationSourceType;
  ruleKey: string;
  objectType: string;
  objectNumber: number | null;
  recipientScope: NotificationRecipientScope;
  channel: string;
  status: NotificationStatus;
  errorMessage: string | null;
  attemptedAt: string;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
}

export type NotificationReadinessStatus = "ready" | "degraded" | "action_required" | "disabled";

export interface NotificationReadiness {
  status: NotificationReadinessStatus;
  blockers: string[];
  warnings: string[];
  webhookEnvVar: string | null;
  mappedEmployees: number;
  missingEmployeeMappings: number;
  fallbackRecipient: string;
}

export interface NotificationHealth {
  enabled: boolean;
  channel: "wecom";
  webhookConfigured: boolean;
  readiness: NotificationReadiness;
  cooldownHours: number;
  escalateAfterHours: number;
  failedDeliveries: number;
  unacknowledgedDeliveries: number;
  escalationPendingDeliveries: number;
  lastDeliveries: NotificationDeliveryView[];
}

export function notificationStatusRequiresAcknowledgement(status: NotificationStatus): boolean {
  return status === "sent";
}

export function notificationStatusAllowsRetry(status: NotificationStatus): boolean {
  return status === "failed_transient" || status === "failed_permanent";
}

export type GitHubWriteCapabilityStatus =
  | "ready"
  | "missing_token"
  | "insufficient_scope"
  | "scope_unverified"
  | "repo_permission_unverified"
  | "insufficient_repo_permission"
  | "write_back_disabled";

export type GitHubRepoPermission = "admin" | "maintain" | "write" | "triage" | "read" | "none" | "unverified";

export interface GitHubWriteCapability {
  enabled: boolean;
  status: GitHubWriteCapabilityStatus;
  message: string;
  requiredScopes: string[];
  currentScopes: string[];
  requiredRepoPermissions: GitHubRepoPermission[];
  repoPermission: GitHubRepoPermission;
}

export interface GitHubWriteCapabilities {
  issueLabels: GitHubWriteCapability;
}

export interface AuthenticatedUserView {
  githubLogin: string;
  githubId: string;
  avatarUrl: string | null;
  tokenScopes: string[];
  tokenRepoPermission: GitHubRepoPermission;
  tokenLastValidatedAt: string | null;
  sessionExpiresAt: string;
  writeCapabilities: GitHubWriteCapabilities;
}

export interface SessionView {
  authenticated: boolean;
  user: AuthenticatedUserView | null;
  tokenEncryptionConfigured: boolean;
}

export const csrfCookieName = "mo_devflow_csrf";
export const csrfHeaderName = "x-mo-devflow-csrf";

export const syncHealthLayers = [
  "github_sync",
  "pr_backfill",
  "issue_timeline_backfill",
  "comment_backfill",
  "webhooks",
  "rules",
  "metrics",
  "ai_drift",
  "notifications"
] as const;
export type SyncHealthLayer = (typeof syncHealthLayers)[number];
export type SyncHealthStatus = "success" | "failed" | "partial" | "blocked" | "not_started";

export interface SyncHealth {
  layer: SyncHealthLayer;
  status: SyncHealthStatus;
  lastSuccessfulAt: string | null;
  lastAttemptedAt: string | null;
  lastFailedAt: string | null;
  lastFailureMessage: string | null;
  errorMessage: string | null;
  rateLimitRemaining: number | null;
  skipped: boolean;
  skipReason: string | null;
}

export type JobQueueHealthStatus = "healthy" | "attention";

export interface JobQueueHealth {
  status: JobQueueHealthStatus;
  queueDepth: number;
  runningJobs: number;
  failedJobs: number;
  blockedJobs: number;
  staleLeases: number;
  oldestPendingAgeHours: number | null;
  nextRunAt: string | null;
  latestFailure: string | null;
  recommendedAction: string | null;
}

export type WorkerHealthStatus = "offline" | "active" | "stale" | "failed";
export type WorkerHeartbeatPhase = "starting" | "running" | "idle" | "failed" | "stopped";

export interface WorkerHealth {
  status: WorkerHealthStatus;
  phase: WorkerHeartbeatPhase | null;
  workerId: string | null;
  processId: number | null;
  host: string | null;
  heartbeatAt: string | null;
  lastTickStartedAt: string | null;
  lastTickFinishedAt: string | null;
  secondsSinceHeartbeat: number | null;
  staleAfterSeconds: number;
  lastError: string | null;
  recommendedAction: string | null;
  details: Record<string, unknown> | null;
}

export type DashboardVisibilityScope = "anonymous" | "logged_in";

export interface DashboardVisibility {
  scope: DashboardVisibilityScope;
  visibleClasses: VisibilityClass[];
  hiddenIssues: number;
  hiddenPullRequests: number;
  hiddenObjects: number;
  note: string | null;
}

export interface WebhookIngestionHealth {
  pendingDeliveries: number;
  processedDeliveries: number;
  failedDeliveries: number;
  normalizationFailedDeliveries: number;
  ignoredDeliveries: number;
  duplicateDeliveries: number;
  lastReceivedAt: string | null;
  latestFailure: string | null;
  eventSummaries: GitHubWebhookEventHealth[];
  recentDeliveries: GitHubWebhookDeliveryView[];
}

export interface GitHubWebhookEventHealth {
  eventName: string;
  pendingDeliveries: number;
  processedDeliveries: number;
  failedDeliveries: number;
  ignoredDeliveries: number;
  duplicateDeliveries: number;
  lastReceivedAt: string | null;
  lastProcessedAt: string | null;
  latestFailure: string | null;
}

export type GitHubWebhookDeliveryStatus =
  "received" | "processing" | "processed" | "failed" | "failed_normalization" | "ignored";

export interface GitHubWebhookDeliveryView {
  deliveryId: string;
  eventName: string;
  action: string | null;
  status: GitHubWebhookDeliveryStatus;
  attempts: number;
  duplicateCount: number;
  receivedAt: string;
  processedAt: string | null;
  errorMessage: string | null;
}

export type CacheHealthStatus = "healthy" | "partial" | "stale";
export type OperationalHealthStatus = "healthy" | "degraded";

export interface OperationalHealthSummary {
  status: OperationalHealthStatus;
  recommendedAction: string | null;
  sync: {
    health: SyncHealth[];
    unhealthyLayers: SyncHealthLayer[];
    rateLimitedLayers: SyncHealthLayer[];
  };
  cache: {
    status: CacheHealthStatus;
    staleObjects: number;
    staleThresholdHours: number;
    oldestCacheAgeHours: number | null;
    partialObjects: number;
  };
  notifications: {
    failedDeliveries: number;
  };
  webhooks: WebhookIngestionHealth;
}

export type CacheObjectEvidenceReason = "stale" | "partial" | "stale_and_partial";

export interface CacheObjectEvidenceView {
  objectType: "issue" | "pull_request";
  number: number;
  title: string;
  htmlUrl: string;
  ownerLogin: string | null;
  state: "open" | "closed";
  visibilityClass: VisibilityClass;
  sourceAuthType: SourceAuthType;
  lastSyncedAt: string;
  sourceUpdatedAt: string;
  cacheAgeHours: number;
  isComplete: boolean;
  syncError: string | null;
  reason: CacheObjectEvidenceReason;
}

export type ManualRefreshLayer = SyncHealthLayer;

export interface ManualRefreshResult {
  requestId: number;
  requestedLayers: ManualRefreshLayer[];
  queuedJobs: Array<{
    jobKey: string;
    jobType: ManualRefreshLayer;
    status: string;
    nextRunAt: string | null;
  }>;
  requestedAt: string;
}

export interface DashboardSummary {
  repo: {
    key: string;
    owner: string;
    name: string;
    timezone: string;
  };
  profileConfiguration: RepoProfileConfigurationStatus;
  profileWarnings: ProfileConfigurationWarning[];
  profileActions: ProfileActionSuggestion[];
  profileSetup: ProfileSetupPlan;
  visibility: DashboardVisibility;
  sync: {
    generatedAt: string;
    health: SyncHealth[];
    staleObjects: number;
    staleThresholdHours: number;
    oldestCacheAgeHours: number | null;
    staleSamples: CacheObjectEvidenceView[];
    partialObjects: number;
    partialSamples: CacheObjectEvidenceView[];
    jobQueue: JobQueueHealth;
    worker: WorkerHealth;
  };
  counts: {
    criticalIssues: number;
    unownedCriticalIssues: number;
    nonWatchedCriticalIssues: number;
    skippedCriticalIssues: number;
    pendingPrs: number;
    attentionPrs: number;
    workflowViolations: number;
    criticalWorkflowViolations: number;
    aiDriftSignals: number;
    criticalAiDriftSignals: number;
  };
  criticalIssues: CriticalIssueView[];
  criticalOwnerCoverage: CriticalOwnerCoverageView[];
  people: PersonSummary[];
  personalViews: PersonalActionView[];
  pendingPrs: PendingPrView[];
  workflowViolations: WorkflowViolationView[];
  aiDriftSignals: AiDriftSignalView[];
  writeActions: WriteActionExecutionView[];
  analytics: AnalyticsSummary;
  testing: TestingSummary;
  notifications: NotificationHealth;
  webhooks: WebhookIngestionHealth;
}

export function parseJsonArray(value: string | null | undefined): string[] {
  if (!value) {
    return [];
  }
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export function parseJsonRecord<T>(value: string | null | undefined, fallback: T): T {
  if (!value) {
    return fallback;
  }
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function hoursBetween(startIso: string, endIso = new Date().toISOString()): number {
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return 0;
  }
  return Math.max(0, Math.round(((end - start) / 3_600_000) * 10) / 10);
}

export function extractLinkedIssueNumbers(text: string): number[] {
  const linked = new Set<number>();
  const issueUrlPattern = /github\.com\/[^/\s]+\/[^/\s]+\/issues\/(\d+)/gi;
  for (const match of text.matchAll(issueUrlPattern)) {
    linked.add(Number(match[1]));
  }
  const repoIssuePattern = /(?:^|[\s([<])[\w.-]+\/[\w.-]+#(\d+)\b/gi;
  for (const match of text.matchAll(repoIssuePattern)) {
    linked.add(Number(match[1]));
  }
  const parenthesizedIssuePattern = /\((?!\s*(?:cherry[-\s]?pick|backport)\b)([^)\n]*#\d+[^)\n]*)\)/gi;
  for (const match of text.matchAll(parenthesizedIssuePattern)) {
    const clause = match[1] ?? "";
    for (const issueMatch of clause.matchAll(/#(\d+)/g)) {
      linked.add(Number(issueMatch[1]));
    }
  }

  const keywordPattern =
    /\b(?:(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+|(?:refs?|references?|relates?\s+to|related\s+to|see(?:\s+also)?|issues?)\s*:?\s+)([^\n.]+)/gi;
  for (const match of text.matchAll(keywordPattern)) {
    const clause = match[1] ?? "";
    for (const issueMatch of clause.matchAll(/#(\d+)/g)) {
      linked.add(Number(issueMatch[1]));
    }
    for (const issueMatch of clause.matchAll(/\/issues\/(\d+)/gi)) {
      linked.add(Number(issueMatch[1]));
    }
  }

  return Array.from(linked)
    .filter((number) => Number.isInteger(number) && number > 0)
    .sort((left, right) => left - right);
}

const issueLabelClassicScopes = ["repo", "public_repo"] as const;
const issueLabelRepoPermissions: GitHubRepoPermission[] = ["admin", "maintain", "write", "triage"];

export function buildGitHubWriteCapabilities(input: {
  writeBackEnabled: boolean;
  tokenScopes: string[];
  repoPermission: GitHubRepoPermission;
  tokenLastValidatedAt: string | null;
}): GitHubWriteCapabilities {
  const currentScopes = Array.from(new Set(input.tokenScopes.map((scope) => scope.trim()).filter(Boolean))).sort();
  const normalizedScopes = new Set(currentScopes.map((scope) => scope.toLowerCase()));
  const hasIssueLabelScope = issueLabelClassicScopes.some((scope) => normalizedScopes.has(scope));
  const requiredScopes = [...issueLabelClassicScopes];
  const requiredRepoPermissions = [...issueLabelRepoPermissions];

  if (!input.writeBackEnabled) {
    return {
      issueLabels: {
        enabled: false,
        status: "write_back_disabled",
        message: "GitHub write-back is disabled in the repository profile.",
        requiredScopes,
        currentScopes,
        requiredRepoPermissions,
        repoPermission: input.repoPermission
      }
    };
  }

  if (!input.tokenLastValidatedAt) {
    return {
      issueLabels: {
        enabled: false,
        status: "missing_token",
        message: "Connect or reconnect a GitHub token before workflow fixes are enabled.",
        requiredScopes,
        currentScopes,
        requiredRepoPermissions,
        repoPermission: input.repoPermission
      }
    };
  }

  if (currentScopes.length === 0) {
    return {
      issueLabels: {
        enabled: false,
        status: "scope_unverified",
        message:
          "GitHub did not report classic token scopes. Reconnect a token with repo or public_repo before workflow fixes are enabled.",
        requiredScopes,
        currentScopes,
        requiredRepoPermissions,
        repoPermission: input.repoPermission
      }
    };
  }

  if (!hasIssueLabelScope) {
    return {
      issueLabels: {
        enabled: false,
        status: "insufficient_scope",
        message: "GitHub token needs repo or public_repo scope to add issue labels.",
        requiredScopes,
        currentScopes,
        requiredRepoPermissions,
        repoPermission: input.repoPermission
      }
    };
  }

  if (input.repoPermission === "unverified") {
    return {
      issueLabels: {
        enabled: false,
        status: "repo_permission_unverified",
        message:
          "GitHub repository permission was not verified for this token. Reconnect a token with triage or write access to this repository.",
        requiredScopes,
        currentScopes,
        requiredRepoPermissions,
        repoPermission: input.repoPermission
      }
    };
  }

  if (!issueLabelRepoPermissions.includes(input.repoPermission)) {
    return {
      issueLabels: {
        enabled: false,
        status: "insufficient_repo_permission",
        message: `GitHub token has ${input.repoPermission} permission for this repository; triage or write access is required for workflow fixes.`,
        requiredScopes,
        currentScopes,
        requiredRepoPermissions,
        repoPermission: input.repoPermission
      }
    };
  }

  return {
    issueLabels: {
      enabled: true,
      status: "ready",
      message: "GitHub token can preview issue label workflow fixes.",
      requiredScopes,
      currentScopes,
      requiredRepoPermissions,
      repoPermission: input.repoPermission
    }
  };
}
