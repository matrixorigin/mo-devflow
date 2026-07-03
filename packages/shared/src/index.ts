export type SourceAuthType = "anonymous" | "service_read_token" | "user_token";

export type VisibilityClass =
  | "anonymous_readable"
  | "logged_in_readable"
  | "token_owner_only"
  | "admin_only";

export type LifecycleState =
  | "critical"
  | "needs-triage"
  | "deferred"
  | "active"
  | "other";

export type AttentionSeverity = "info" | "warning" | "critical";

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
    handoffSignals: {
      labels: string[];
      reviewerUsers: string[];
      assigneeUsers: string[];
      comments: string[];
    };
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
    };
  };
  raw: unknown;
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
  isPullRequest: boolean;
  sourceAuthType: SourceAuthType;
  visibilityClass: VisibilityClass;
  isComplete: boolean;
  rawPayload: unknown;
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
  attentionFlags: string[];
  sourceAuthType: SourceAuthType;
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
  detailSyncedAt: string;
  detailError: string | null;
}

export interface CriticalIssueView {
  number: number;
  title: string;
  htmlUrl: string;
  severity: string | null;
  ownerLogin: string | null;
  ownerReason: string | null;
  lifecycleState: LifecycleState;
  ageHours: number;
  lastSyncedAt: string;
  isComplete: boolean;
  labels: string[];
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
  attentionFlags: string[];
  isComplete: boolean;
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
}

export type WorkflowFixActionKey = "add_needs_triage";

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

export interface WorkflowFixPreview {
  previewId: string;
  actionKey: WorkflowFixActionKey;
  repoKey: string;
  objectType: WorkflowViolationObjectType;
  objectNumber: number;
  ruleKey: string;
  title: string;
  htmlUrl: string;
  operations: WorkflowFixOperation[];
  warnings: string[];
  blockedReason: string | null;
  createdAt: string;
  expiresAt: string;
}

export type WorkflowFixExecutionStatus =
  | "success"
  | "failed"
  | "stale_preview"
  | "blocked"
  | "token_unavailable";

export interface WorkflowFixExecutionResult {
  previewId: string;
  status: WorkflowFixExecutionStatus;
  executedOperations: WorkflowFixOperation[];
  message: string;
  errorMessage: string | null;
  executedAt: string;
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
}

export type DailyMetricScopeType = "team" | "person";
export type MetricSourceCompleteness = "partial_cache" | "complete_cache";

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
  sourceCompleteness: MetricSourceCompleteness;
  generatedAt: string;
}

export interface AnalyticsSummary {
  periodDays: number;
  sourceNote: string;
  teamDaily: DailyMetricPoint[];
  peopleDaily: DailyMetricPoint[];
}

export type NotificationSourceType = "attention_item" | "workflow_violation" | "ai_drift_signal";
export type NotificationStatus =
  | "sent"
  | "failed"
  | "dry_run"
  | "skipped_disabled"
  | "skipped_no_webhook"
  | "skipped_quiet_hours";

export interface NotificationCandidate {
  sourceType: NotificationSourceType;
  sourceId: number;
  ruleKey: string;
  severity: AttentionSeverity;
  objectType: string;
  objectNumber: number | null;
  title: string;
  htmlUrl: string | null;
  relatedLogin: string | null;
  recipient: string;
  dedupeKey: string;
  evidenceSummary: string;
  firstDetectedAt: string;
  lastDetectedAt: string;
}

export interface NotificationDeliveryView {
  sourceType: NotificationSourceType;
  ruleKey: string;
  objectType: string;
  objectNumber: number | null;
  recipientScope: "fallback" | "mapped_employee";
  channel: string;
  status: NotificationStatus;
  errorMessage: string | null;
  attemptedAt: string;
}

export interface NotificationHealth {
  enabled: boolean;
  channel: "wecom";
  webhookConfigured: boolean;
  cooldownHours: number;
  failedDeliveries: number;
  lastDeliveries: NotificationDeliveryView[];
}

export interface AuthenticatedUserView {
  githubLogin: string;
  githubId: string;
  avatarUrl: string | null;
  tokenScopes: string[];
  tokenLastValidatedAt: string | null;
  sessionExpiresAt: string;
}

export interface SessionView {
  authenticated: boolean;
  user: AuthenticatedUserView | null;
  tokenEncryptionConfigured: boolean;
}

export interface SyncHealth {
  layer: string;
  status: string;
  lastSuccessfulAt: string | null;
  lastAttemptedAt: string | null;
  errorMessage: string | null;
}

export interface DashboardSummary {
  repo: {
    key: string;
    owner: string;
    name: string;
    timezone: string;
  };
  sync: {
    generatedAt: string;
    health: SyncHealth[];
    staleObjects: number;
    partialObjects: number;
  };
  counts: {
    criticalIssues: number;
    unownedCriticalIssues: number;
    pendingPrs: number;
    attentionPrs: number;
    workflowViolations: number;
    criticalWorkflowViolations: number;
    aiDriftSignals: number;
    criticalAiDriftSignals: number;
  };
  criticalIssues: CriticalIssueView[];
  people: PersonSummary[];
  pendingPrs: PendingPrView[];
  workflowViolations: WorkflowViolationView[];
  aiDriftSignals: AiDriftSignalView[];
  analytics: AnalyticsSummary;
  notifications: NotificationHealth;
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
