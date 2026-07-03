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
  attentionFlags: string[];
  sourceAuthType: SourceAuthType;
  visibilityClass: VisibilityClass;
  isComplete: boolean;
  rawPayload: unknown;
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
  ageHours: number;
  lastHumanActionAt: string;
  attentionFlags: string[];
  isComplete: boolean;
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
  };
  criticalIssues: CriticalIssueView[];
  people: PersonSummary[];
  pendingPrs: PendingPrView[];
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
