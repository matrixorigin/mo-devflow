import type {
  LifecycleState,
  NormalizedIssue,
  NormalizedPullRequest,
  RepoProfile,
  SourceAuthType,
  VisibilityClass
} from "@mo-devflow/shared";
import { hoursBetween } from "@mo-devflow/shared";

interface GitHubLabel {
  name?: string | null;
}

interface GitHubUser {
  login?: string | null;
}

interface GitHubIssueLike {
  id: number;
  number: number;
  title?: string | null;
  body?: string | null;
  state?: string | null;
  user?: GitHubUser | null;
  html_url?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  closed_at?: string | null;
  labels?: Array<string | GitHubLabel>;
  assignees?: GitHubUser[] | null;
  pull_request?: unknown;
}

interface GitHubPullRequestLike {
  id: number;
  number: number;
  title?: string | null;
  state?: string | null;
  user?: GitHubUser | null;
  html_url?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  closed_at?: string | null;
  merged_at?: string | null;
  draft?: boolean | null;
  head?: { ref?: string | null } | null;
  base?: { ref?: string | null } | null;
  assignees?: GitHubUser[] | null;
  requested_reviewers?: GitHubUser[] | null;
}

export function labelNames(labels: Array<string | GitHubLabel> | undefined): string[] {
  return (labels ?? [])
    .map((label) => (typeof label === "string" ? label : label.name ?? ""))
    .filter((label) => label.length > 0);
}

export function userLogins(users: GitHubUser[] | null | undefined): string[] {
  return (users ?? []).map((user) => user.login ?? "").filter((login) => login.length > 0);
}

function chooseIssueOwner(profile: RepoProfile, issue: GitHubIssueLike): { owner: string | null; reason: string | null } {
  const assignees = userLogins(issue.assignees);
  for (const source of profile.ownership.issueOwnerPriority) {
    if (source === "assignee" && assignees.length > 0) {
      return { owner: assignees[0] ?? null, reason: "assignee" };
    }
    if (source === "author" && issue.user?.login) {
      return { owner: issue.user.login, reason: "author" };
    }
  }
  return { owner: null, reason: null };
}

function chooseLifecycle(profile: RepoProfile, labels: string[]): { lifecycle: LifecycleState; severity: string | null } {
  const severity = [...profile.labels.critical, ...profile.labels.active].find((label) => labels.includes(label)) ?? null;
  if (severity && profile.labels.critical.includes(severity)) {
    return { lifecycle: "critical", severity };
  }
  if (labels.includes(profile.labels.deferred)) {
    return { lifecycle: "deferred", severity };
  }
  if (labels.includes(profile.labels.needsTriage)) {
    return { lifecycle: "needs-triage", severity };
  }
  if (severity) {
    return { lifecycle: "active", severity };
  }
  return { lifecycle: "other", severity: null };
}

function chooseAiEffortLabel(profile: RepoProfile, labels: string[]): string | null {
  return profile.labels.aiEffort.find((label) => labels.includes(label)) ?? null;
}

function visibility(profile: RepoProfile, sourceAuthType: SourceAuthType): VisibilityClass {
  if (sourceAuthType === "user_token" && !profile.access.exposeUserTokenSyncedPrivateData) {
    return "token_owner_only";
  }
  return profile.access.anonymousRead ? "anonymous_readable" : "logged_in_readable";
}

export function normalizeIssue(
  profile: RepoProfile,
  issue: GitHubIssueLike,
  sourceAuthType: SourceAuthType
): NormalizedIssue {
  const labels = labelNames(issue.labels);
  const owner = chooseIssueOwner(profile, issue);
  const lifecycle = chooseLifecycle(profile, labels);
  return {
    githubId: issue.id,
    number: issue.number,
    title: issue.title ?? "(untitled)",
    body: issue.body ?? "",
    state: issue.state === "closed" ? "closed" : "open",
    authorLogin: issue.user?.login ?? "unknown",
    htmlUrl: issue.html_url ?? "",
    createdAt: issue.created_at ?? new Date().toISOString(),
    updatedAt: issue.updated_at ?? issue.created_at ?? new Date().toISOString(),
    closedAt: issue.closed_at ?? null,
    labels,
    assignees: userLogins(issue.assignees),
    ownerLogin: owner.owner,
    ownerReason: owner.reason,
    lifecycleState: lifecycle.lifecycle,
    severity: lifecycle.severity,
    aiEffortLabel: chooseAiEffortLabel(profile, labels),
    isPullRequest: Boolean(issue.pull_request),
    sourceAuthType,
    visibilityClass: visibility(profile, sourceAuthType),
    isComplete: false,
    rawPayload: issue
  };
}

export function normalizePullRequest(
  profile: RepoProfile,
  pr: GitHubPullRequestLike,
  sourceAuthType: SourceAuthType
): NormalizedPullRequest {
  const owner = profile.ownership.prOwner === "assignee" ? userLogins(pr.assignees)[0] ?? pr.user?.login : pr.user?.login;
  const createdAt = pr.created_at ?? new Date().toISOString();
  const updatedAt = pr.updated_at ?? createdAt;
  const ageHours = pr.state === "closed" && pr.closed_at ? hoursBetween(createdAt, pr.closed_at) : hoursBetween(createdAt);
  const lastHumanActionAt = updatedAt;
  const attentionFlags: string[] = [];
  if (pr.state !== "closed" && hoursBetween(lastHumanActionAt) >= profile.thresholds.prNoActionAttentionHours) {
    attentionFlags.push("no_human_action_24h");
  }

  return {
    githubId: pr.id,
    number: pr.number,
    title: pr.title ?? "(untitled)",
    state: pr.state === "closed" ? "closed" : "open",
    authorLogin: pr.user?.login ?? "unknown",
    ownerLogin: owner ?? "unknown",
    htmlUrl: pr.html_url ?? "",
    createdAt,
    updatedAt,
    closedAt: pr.closed_at ?? null,
    mergedAt: pr.merged_at ?? null,
    draft: Boolean(pr.draft),
    headRef: pr.head?.ref ?? "",
    baseRef: pr.base?.ref ?? "",
    assignees: userLogins(pr.assignees),
    requestedReviewers: userLogins(pr.requested_reviewers),
    ageHours,
    lastHumanActionAt,
    lastSystemActionAt: null,
    attentionFlags,
    sourceAuthType,
    visibilityClass: visibility(profile, sourceAuthType),
    isComplete: false,
    rawPayload: pr
  };
}

export function criticalAttentionForIssue(profile: RepoProfile, issue: NormalizedIssue): string[] {
  if (issue.state !== "open" || !issue.severity || !profile.labels.critical.includes(issue.severity)) {
    return [];
  }
  if (hoursBetween(issue.updatedAt) >= profile.thresholds.criticalNoActionAttentionHours) {
    return ["critical_no_human_action"];
  }
  return [];
}
