import type {
  AiDriftSignal,
  IssueCommentEvidence,
  LifecycleState,
  NormalizedIssueComment,
  NormalizedIssue,
  NormalizedPullRequest,
  PullRequestInsight,
  RepoProfile,
  SourceAuthType,
  TestingFlowState,
  VisibilityClass,
  WorkflowViolation
} from "@mo-devflow/shared";
import { extractLinkedIssueNumbers, hoursBetween } from "@mo-devflow/shared";
export * from "./actions";

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

interface GitHubIssueCommentLike {
  id: number;
  body?: string | null;
  user?: GitHubUser | null;
  html_url?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

interface GitHubPullRequestLike {
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
  merged_at?: string | null;
  draft?: boolean | null;
  head?: { ref?: string | null; sha?: string | null } | null;
  base?: { ref?: string | null } | null;
  labels?: Array<string | GitHubLabel>;
  assignees?: GitHubUser[] | null;
  requested_reviewers?: GitHubUser[] | null;
}

export interface IssueOwnerHints {
  linkedPrAuthorByIssueNumber?: ReadonlyMap<number, string>;
}

interface TestingFlowDerivation {
  state: TestingFlowState;
  testers: string[];
  signals: string[];
  queueAgeHours: number | null;
}

export interface CacheSource {
  authType: SourceAuthType;
  userId: number | null;
}

export function labelNames(labels: Array<string | GitHubLabel> | undefined): string[] {
  return (labels ?? [])
    .map((label) => (typeof label === "string" ? label : (label.name ?? "")))
    .filter((label) => label.length > 0);
}

export function userLogins(users: GitHubUser[] | null | undefined): string[] {
  return (users ?? []).map((user) => user.login ?? "").filter((login) => login.length > 0);
}

function chooseIssueOwner(
  profile: RepoProfile,
  issue: GitHubIssueLike,
  hints?: IssueOwnerHints
): { owner: string | null; reason: string | null } {
  const assignees = userLogins(issue.assignees);
  for (const source of profile.ownership.issueOwnerPriority) {
    if (source === "assignee" && assignees.length > 0) {
      return { owner: assignees[0] ?? null, reason: "assignee" };
    }
    if (source === "linked_pr_author") {
      const owner = hints?.linkedPrAuthorByIssueNumber?.get(issue.number);
      if (owner) {
        return { owner, reason: "linked_pr_author" };
      }
    }
    if (source === "author" && issue.user?.login) {
      return { owner: issue.user.login, reason: "author" };
    }
  }
  return { owner: null, reason: null };
}

export function linkedPrAuthorsByIssueNumber(pullRequests: GitHubPullRequestLike[]): Map<number, string> {
  const owners = new Map<number, string>();
  for (const pr of pullRequests) {
    if (pr.state === "closed") {
      continue;
    }
    const author = pr.user?.login;
    if (!author) {
      continue;
    }
    const linkedIssues = extractLinkedIssueNumbers(`${pr.title ?? ""}\n${pr.body ?? ""}`);
    for (const issueNumber of linkedIssues) {
      if (!owners.has(issueNumber)) {
        owners.set(issueNumber, author);
      }
    }
  }
  return owners;
}

function chooseLifecycle(
  profile: RepoProfile,
  labels: string[]
): { lifecycle: LifecycleState; severity: string | null } {
  const severity =
    [...profile.labels.critical, ...profile.labels.active].find((label) => labels.includes(label)) ?? null;
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

function chooseAiEffortLabel(profile: RepoProfile, labels: string[]): string {
  return profile.labels.aiEffort.find((label) => labels.includes(label)) ?? "ai-easy";
}

function hasExplicitAiEffortLabel(profile: RepoProfile, labels: string[]): boolean {
  return profile.labels.aiEffort.some((label) => labels.includes(label));
}

function visibility(profile: RepoProfile, source: CacheSource): VisibilityClass {
  if (source.authType === "user_token" && source.userId === null) {
    throw new Error("user_token cache source requires source user id");
  }
  if (source.authType === "user_token" && !profile.access.exposeUserTokenSyncedPrivateData) {
    return "token_owner_only";
  }
  return profile.access.anonymousRead ? "anonymous_readable" : "logged_in_readable";
}

function normalizeState(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  return value.toLowerCase().replaceAll("-", "_");
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function normalizedLogin(login: string): string {
  return login.trim().toLowerCase();
}

function skippedLogins(profile: RepoProfile): Set<string> {
  return new Set(profile.workflow.skipUsers.map(normalizedLogin).filter(Boolean));
}

function issueMatchesSkipList(profile: RepoProfile, issue: NormalizedIssue): boolean {
  const skipped = skippedLogins(profile);
  if (skipped.size === 0) {
    return false;
  }
  return [issue.authorLogin, issue.ownerLogin, ...issue.assignees].some(
    (login) => login && skipped.has(normalizedLogin(login))
  );
}

function prMatchesSkipList(profile: RepoProfile, pr: NormalizedPullRequest): boolean {
  const skipped = skippedLogins(profile);
  if (skipped.size === 0) {
    return false;
  }
  return [pr.authorLogin, pr.ownerLogin, ...pr.assignees].some((login) => login && skipped.has(normalizedLogin(login)));
}

function deriveTestingFlow(
  profile: RepoProfile,
  pr: GitHubPullRequestLike,
  labels: string[],
  assignees: string[],
  requestedReviewers: string[],
  insight?: PullRequestInsight,
  commentEvidence?: IssueCommentEvidence
): TestingFlowDerivation {
  if (pr.state === "closed") {
    return {
      state: "closed_or_merged",
      testers: [],
      signals: ["closed_or_merged"],
      queueAgeHours: null
    };
  }

  if ((profile.testing.handoffScope ?? "issue") !== "pull_request") {
    return {
      state: "not_ready",
      testers: [],
      signals: [],
      queueAgeHours: null
    };
  }

  const configuredTesters = new Set([
    ...profile.people.testers,
    ...profile.testing.handoffSignals.reviewerUsers,
    ...profile.testing.handoffSignals.assigneeUsers
  ]);
  const signals: string[] = [];
  const testers: string[] = [];

  for (const label of profile.testing.handoffSignals.labels) {
    if (labels.includes(label)) {
      signals.push(`label:${label}`);
    }
  }
  for (const reviewer of requestedReviewers) {
    if (configuredTesters.has(reviewer)) {
      signals.push(`reviewer:${reviewer}`);
      testers.push(reviewer);
    }
  }
  for (const assignee of assignees) {
    if (configuredTesters.has(assignee)) {
      signals.push(`assignee:${assignee}`);
      testers.push(assignee);
    }
  }
  if (commentEvidence?.isComplete) {
    for (const signal of profile.testing.handoffSignals.comments) {
      const normalizedSignal = signal.trim().toLowerCase();
      if (!normalizedSignal) {
        continue;
      }
      const matched = commentEvidence.comments.some((comment) => comment.body.toLowerCase().includes(normalizedSignal));
      if (matched) {
        signals.push(`comment:${signal}`);
      }
    }
  }

  if (signals.length === 0) {
    return {
      state: "not_ready",
      testers: [],
      signals: [],
      queueAgeHours: null
    };
  }

  let state: TestingFlowState = "test_requested";
  const reviewDecision = normalizeState(insight?.reviewDecision);
  const latestReviewState = normalizeState(insight?.latestReviewState);
  if (reviewDecision === "changes_requested" || latestReviewState === "changes_requested") {
    state = "test_changes_requested";
  } else if (reviewDecision === "approved" || latestReviewState === "approved") {
    state = "test_passed";
  }

  return {
    state,
    testers: unique(testers),
    signals: unique(signals),
    queueAgeHours:
      state === "test_passed" ? null : hoursBetween(pr.updated_at ?? pr.created_at ?? new Date().toISOString())
  };
}

function maxIso(values: Array<string | null | undefined>): string | null {
  let latest: string | null = null;
  let latestTime = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    if (!value) {
      continue;
    }
    const time = new Date(value).getTime();
    if (Number.isFinite(time) && time > latestTime) {
      latest = value;
      latestTime = time;
    }
  }
  return latest;
}

export function normalizeIssue(
  profile: RepoProfile,
  issue: GitHubIssueLike,
  source: CacheSource,
  ownerHints?: IssueOwnerHints
): NormalizedIssue {
  const labels = labelNames(issue.labels);
  const owner = chooseIssueOwner(profile, issue, ownerHints);
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
    sourceAuthType: source.authType,
    sourceUserId: source.userId,
    visibilityClass: visibility(profile, source),
    isComplete: false,
    rawPayload: issue
  };
}

export function normalizeIssueComment(
  profile: RepoProfile,
  issueNumber: number,
  comment: GitHubIssueCommentLike,
  source: CacheSource
): NormalizedIssueComment {
  return {
    githubId: comment.id,
    issueNumber,
    authorLogin: comment.user?.login ?? "unknown",
    body: comment.body ?? "",
    htmlUrl: comment.html_url ?? "",
    createdAt: comment.created_at ?? new Date().toISOString(),
    updatedAt: comment.updated_at ?? comment.created_at ?? new Date().toISOString(),
    sourceAuthType: source.authType,
    sourceUserId: source.userId,
    visibilityClass: visibility(profile, source),
    rawPayload: comment
  };
}

export function normalizePullRequest(
  profile: RepoProfile,
  pr: GitHubPullRequestLike,
  source: CacheSource,
  insight?: PullRequestInsight,
  commentEvidence?: IssueCommentEvidence
): NormalizedPullRequest {
  const labels = labelNames(pr.labels);
  const assignees = userLogins(pr.assignees);
  const requestedReviewers = userLogins(pr.requested_reviewers);
  const owner =
    profile.ownership.prOwner === "assignee" ? (userLogins(pr.assignees)[0] ?? pr.user?.login) : pr.user?.login;
  const createdAt = pr.created_at ?? new Date().toISOString();
  const updatedAt = pr.updated_at ?? createdAt;
  const ageHours =
    pr.state === "closed" && pr.closed_at ? hoursBetween(createdAt, pr.closed_at) : hoursBetween(createdAt);
  const reviewDecision = normalizeState(insight?.reviewDecision);
  const mergeStateStatus = normalizeState(insight?.mergeStateStatus);
  const ciState = normalizeState(insight?.ciState);
  const latestReviewState = normalizeState(insight?.latestReviewState);
  const testingFlow = deriveTestingFlow(profile, pr, labels, assignees, requestedReviewers, insight, commentEvidence);
  const latestHumanCommentAt = latestHumanCommentTimestamp(commentEvidence);
  const lastHumanActionAt = insight
    ? (maxIso([createdAt, insight.latestCommitAt, insight.latestReviewSubmittedAt, latestHumanCommentAt]) ?? createdAt)
    : (maxIso([updatedAt, latestHumanCommentAt]) ?? updatedAt);
  const attentionFlags: string[] = [];
  if (pr.state !== "closed" && hoursBetween(lastHumanActionAt) >= profile.thresholds.prNoActionAttentionHours) {
    attentionFlags.push("no_human_action_24h");
  }
  if (
    pr.state !== "closed" &&
    requestedReviewers.length > 0 &&
    !reviewDecision &&
    !latestReviewState &&
    !insight?.latestReviewSubmittedAt &&
    hoursBetween(updatedAt) >= profile.thresholds.prNoActionAttentionHours
  ) {
    attentionFlags.push("review_requested_no_response");
  }
  if (pr.state !== "closed" && (reviewDecision === "changes_requested" || latestReviewState === "changes_requested")) {
    attentionFlags.push("requested_changes");
  }
  if (
    pr.state !== "closed" &&
    ["failure", "failed", "error", "timed_out", "action_required", "cancelled"].includes(ciState ?? "")
  ) {
    attentionFlags.push("ci_failed");
  }
  if (pr.state !== "closed" && mergeStateStatus === "dirty") {
    attentionFlags.push("merge_conflict");
  }
  if (
    pr.state !== "closed" &&
    testingFlow.queueAgeHours !== null &&
    ["test_requested", "testing", "test_changes_requested"].includes(testingFlow.state) &&
    testingFlow.queueAgeHours >= profile.thresholds.prNoActionAttentionHours
  ) {
    attentionFlags.push("testing_stalled");
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
    labels,
    assignees,
    requestedReviewers,
    ageHours,
    lastHumanActionAt,
    lastSystemActionAt: null,
    reviewDecision,
    mergeStateStatus,
    ciState,
    latestReviewState,
    latestReviewSubmittedAt: insight?.latestReviewSubmittedAt ?? null,
    latestCommitAt: insight?.latestCommitAt ?? null,
    detailSyncedAt: insight?.detailSyncedAt ?? null,
    detailError: insight?.detailError ?? null,
    testingState: testingFlow.state,
    testingTesters: testingFlow.testers,
    testingSignals: testingFlow.signals,
    testingQueueAgeHours: testingFlow.queueAgeHours,
    attentionFlags,
    sourceAuthType: source.authType,
    sourceUserId: source.userId,
    visibilityClass: visibility(profile, source),
    isComplete: Boolean(insight?.detailSyncedAt && !insight.detailError),
    rawPayload: pr
  };
}

function latestHumanCommentTimestamp(commentEvidence: IssueCommentEvidence | undefined): string | null {
  if (!commentEvidence?.isComplete) {
    return null;
  }
  return maxIso(
    commentEvidence.comments
      .filter((comment) => !isBotLogin(comment.authorLogin))
      .map((comment) => comment.updatedAt || comment.createdAt)
  );
}

export function issueLastHumanActionAt(issue: NormalizedIssue): string {
  const latestCommentAt = latestHumanCommentTimestamp(issue.commentEvidence);
  if (latestCommentAt) {
    return latestCommentAt;
  }
  if (issue.commentEvidence?.isComplete) {
    return issue.createdAt;
  }
  return issue.updatedAt;
}

function isBotLogin(login: string): boolean {
  const normalized = login.toLowerCase();
  return normalized.endsWith("[bot]") || normalized.includes("bot");
}

export function criticalAttentionForIssue(profile: RepoProfile, issue: NormalizedIssue): string[] {
  if (issueMatchesSkipList(profile, issue)) {
    return [];
  }
  if (issue.state !== "open" || !issue.severity || !profile.labels.critical.includes(issue.severity)) {
    return [];
  }
  if (hoursBetween(issueLastHumanActionAt(issue)) >= profile.thresholds.criticalNoActionAttentionHours) {
    return ["critical_no_human_action"];
  }
  return [];
}

function violation(input: WorkflowViolation): WorkflowViolation {
  return input;
}

function activeSeverityLabels(profile: RepoProfile, labels: string[]): string[] {
  return profile.labels.active.filter((label) => labels.includes(label));
}

function hasDeferredExplanationComment(issue: NormalizedIssue): boolean {
  const evidence = issue.commentEvidence;
  if (!evidence?.isComplete) {
    return true;
  }
  return evidence.comments.some((comment) => isDeferredExplanationComment(comment.body));
}

function isDeferredExplanationComment(body: string): boolean {
  const normalized = body.toLowerCase();
  if (!normalized.includes("defer")) {
    return false;
  }
  if (normalized.includes("reason:")) {
    return true;
  }
  return [
    "unstable repro",
    "missing dependency",
    "non-critical",
    "not critical",
    "consolidated",
    "duplicate",
    "no current owner",
    "no near-term",
    "insufficient impact",
    "feature request",
    "not a bug"
  ].some((signal) => normalized.includes(signal));
}

export function workflowViolationsForIssue(profile: RepoProfile, issue: NormalizedIssue): WorkflowViolation[] {
  if (issueMatchesSkipList(profile, issue)) {
    return [];
  }
  if (issue.state !== "open") {
    return [];
  }

  const violations: WorkflowViolation[] = [];
  const labels = issue.labels;
  const hasBug = labels.includes(profile.labels.bug);
  const hasNeedsTriage = labels.includes(profile.labels.needsTriage);
  const hasDeferred = labels.includes(profile.labels.deferred);
  const severityLabels = activeSeverityLabels(profile, labels);
  const hasActiveSeverity = severityLabels.length > 0;
  const hasCriticalSeverity = severityLabels.some((label) => profile.labels.critical.includes(label));
  const issueAgeHours = hoursBetween(issue.createdAt);

  if (hasBug && !hasNeedsTriage && !hasDeferred && !hasActiveSeverity) {
    violations.push(
      violation({
        objectType: "issue",
        objectNumber: issue.number,
        title: issue.title,
        htmlUrl: issue.htmlUrl,
        ruleKey: "bug_missing_needs_triage",
        severity: "warning",
        relatedLogin: issue.ownerLogin ?? issue.authorLogin,
        evidenceSummary: `Open bug issue #${issue.number} has no ${profile.labels.needsTriage} label.`,
        suggestedAction: `Add ${profile.labels.needsTriage} or move it to an explicit lifecycle state.`,
        fixable: true
      })
    );
  }

  if (
    hasActiveSeverity &&
    !hasNeedsTriage &&
    !hasDeferred &&
    issueAgeHours <= profile.thresholds.prematureSeverityWindowHours
  ) {
    violations.push(
      violation({
        objectType: "issue",
        objectNumber: issue.number,
        title: issue.title,
        htmlUrl: issue.htmlUrl,
        ruleKey: "premature_active_severity",
        severity: hasCriticalSeverity ? "critical" : "warning",
        relatedLogin: issue.ownerLogin ?? issue.authorLogin,
        evidenceSummary: `New issue #${issue.number} has ${severityLabels.join(", ")} within ${profile.thresholds.prematureSeverityWindowHours}h and no ${profile.labels.needsTriage}/${profile.labels.deferred}.`,
        suggestedAction: `Confirm this is active urgent work, or move it back to ${profile.labels.needsTriage}/${profile.labels.deferred}.`,
        fixable: true
      })
    );
  }

  if (
    hasNeedsTriage &&
    !hasDeferred &&
    !hasActiveSeverity &&
    issueAgeHours >= profile.thresholds.needsTriageStaleHours
  ) {
    violations.push(
      violation({
        objectType: "issue",
        objectNumber: issue.number,
        title: issue.title,
        htmlUrl: issue.htmlUrl,
        ruleKey: "needs_triage_stale",
        severity: "warning",
        relatedLogin: issue.ownerLogin ?? issue.authorLogin,
        evidenceSummary: `Issue #${issue.number} has stayed in ${profile.labels.needsTriage} for ${issueAgeHours}h.`,
        suggestedAction: `Triage it into active work, ${profile.labels.deferred}, or close/merge with an existing issue.`,
        fixable: true
      })
    );
  }

  if ((hasNeedsTriage && hasDeferred) || (hasNeedsTriage && hasActiveSeverity) || (hasDeferred && hasActiveSeverity)) {
    violations.push(
      violation({
        objectType: "issue",
        objectNumber: issue.number,
        title: issue.title,
        htmlUrl: issue.htmlUrl,
        ruleKey: "conflicting_lifecycle_labels",
        severity: "warning",
        relatedLogin: issue.ownerLogin ?? issue.authorLogin,
        evidenceSummary: `Issue #${issue.number} has conflicting lifecycle labels: ${[
          hasNeedsTriage ? profile.labels.needsTriage : null,
          hasDeferred ? profile.labels.deferred : null,
          ...severityLabels
        ]
          .filter(Boolean)
          .join(", ")}.`,
        suggestedAction: "Keep exactly one lifecycle state label that matches the current workflow stage.",
        fixable: true
      })
    );
  }

  if (hasDeferred && !hasDeferredExplanationComment(issue)) {
    violations.push(
      violation({
        objectType: "issue",
        objectNumber: issue.number,
        title: issue.title,
        htmlUrl: issue.htmlUrl,
        ruleKey: "deferred_missing_explanation_comment",
        severity: "warning",
        relatedLogin: issue.ownerLogin ?? issue.authorLogin,
        evidenceSummary: `Deferred issue #${issue.number} has no cached comment explaining why it was deferred.`,
        suggestedAction:
          "Add a deferred explanation comment with the reason and the signal needed to promote it later.",
        fixable: false
      })
    );
  }

  if (hasCriticalSeverity && !issue.ownerLogin) {
    violations.push(
      violation({
        objectType: "issue",
        objectNumber: issue.number,
        title: issue.title,
        htmlUrl: issue.htmlUrl,
        ruleKey: "critical_issue_unowned",
        severity: "critical",
        relatedLogin: null,
        evidenceSummary: `Active s-1/s0 issue #${issue.number} has no derived owner in the cache.`,
        suggestedAction: "Assign an owner or update the repository profile ownership rules.",
        fixable: true
      })
    );
  }

  return violations;
}

export function aiDriftSignalsForIssue(profile: RepoProfile, issue: NormalizedIssue): AiDriftSignal[] {
  if (issueMatchesSkipList(profile, issue)) {
    return [];
  }
  if (issue.state !== "open" || !issue.severity || !profile.labels.critical.includes(issue.severity)) {
    return [];
  }

  const signals: AiDriftSignal[] = [];
  const ageHours = hoursBetween(issue.createdAt);

  if (issue.aiEffortLabel === "ai-easy") {
    const warningHours = profile.thresholds.aiEasyS0ToTestAttentionDays * 24;
    const criticalHours = profile.thresholds.aiEasyCriticalCriticalDays * 24;
    if (ageHours >= warningHours) {
      const effortEvidence = hasExplicitAiEffortLabel(profile, issue.labels)
        ? "is labeled ai-easy"
        : "has no ai-* label and is treated as ai-easy";
      signals.push({
        objectType: "issue",
        objectNumber: issue.number,
        title: issue.title,
        htmlUrl: issue.htmlUrl,
        ruleKey: "ai_easy_critical_too_old",
        severity: ageHours >= criticalHours ? "critical" : "warning",
        ownerLogin: issue.ownerLogin,
        aiEffortLabel: issue.aiEffortLabel,
        expectedHours: warningHours,
        actualHours: ageHours,
        evidenceSummary: `Active s-1/s0 issue #${issue.number} ${effortEvidence}; it is ${ageHours}h old and the threshold is ${warningHours}h. Created time is used as a proxy until severity timeline and testing handoff are backfilled.`,
        suggestedAction:
          "Review whether ai-easy is still accurate, split blockers, or change the effort label before close.",
        sourceCompleteness: "partial_cache"
      });
    }
  }

  return signals;
}

export function aiDriftSignalsForPullRequest(profile: RepoProfile, pr: NormalizedPullRequest): AiDriftSignal[] {
  if (prMatchesSkipList(profile, pr) || pr.state !== "open") {
    return [];
  }
  const aiEffortLabel = chooseAiEffortLabel(profile, pr.labels);
  if (aiEffortLabel !== "ai-easy") {
    return [];
  }

  const blockerFlags = pr.attentionFlags.filter((flag) =>
    ["requested_changes", "ci_failed", "merge_conflict"].includes(flag)
  );
  if (blockerFlags.length === 0) {
    return [];
  }

  const ageHours = hoursBetween(pr.createdAt);
  const effortEvidence = hasExplicitAiEffortLabel(profile, pr.labels)
    ? "is labeled ai-easy"
    : "has no ai-* label and is treated as ai-easy";
  return [
    {
      objectType: "pull_request",
      objectNumber: pr.number,
      title: pr.title,
      htmlUrl: pr.htmlUrl,
      ruleKey: "ai_easy_pr_has_blockers",
      severity: blockerFlags.includes("merge_conflict") || blockerFlags.length >= 2 ? "critical" : "warning",
      ownerLogin: pr.ownerLogin,
      aiEffortLabel,
      expectedHours: profile.thresholds.aiEasyS0ToTestAttentionDays * 24,
      actualHours: ageHours,
      evidenceSummary: `PR #${pr.number} ${effortEvidence} and has blocker attention flags: ${blockerFlags.join(", ")}.`,
      suggestedAction:
        "Re-evaluate the AI effort label before close, split blockers, or document why ai-easy is still accurate.",
      sourceCompleteness: pr.isComplete ? "complete_cache" : "partial_cache"
    }
  ];
}
