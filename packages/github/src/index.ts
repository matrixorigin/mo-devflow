import { Octokit } from "@octokit/rest";
import type { RestEndpointMethodTypes } from "@octokit/rest";
import type {
  PullRequestInsight,
  RepoProfile,
  SourceAuthType,
  WorkflowFixOperation,
  WorkflowFixPreview,
  WorkflowFixStateSnapshot
} from "@mo-devflow/shared";

type PullRequestListItem = RestEndpointMethodTypes["pulls"]["list"]["response"]["data"][number];

export interface GitHubSnapshot {
  issues: RestEndpointMethodTypes["issues"]["listForRepo"]["response"]["data"];
  pullRequests: RestEndpointMethodTypes["pulls"]["list"]["response"]["data"];
  pullRequestInsights: Map<number, PullRequestInsight>;
  sourceAuthType: SourceAuthType;
  rateLimitRemaining: number | null;
  issuesComplete: boolean;
  openPullRequestsComplete: boolean;
}

export interface GitHubTokenValidation {
  githubId: string;
  githubLogin: string;
  avatarUrl: string | null;
  scopes: string[];
  rateLimitRemaining: number | null;
}

export interface GitHubIssueFreshState {
  state: "open" | "closed";
  labels: string[];
  updatedAt: string;
  rateLimitRemaining: number | null;
}

export interface GitHubWorkflowFixApplyResult {
  freshState: GitHubIssueFreshState;
  appliedOperations: WorkflowFixOperation[];
  beforeState: WorkflowFixStateSnapshot;
  afterState: WorkflowFixStateSnapshot;
  response: unknown;
  rateLimitRemaining: number | null;
}

export type GitHubErrorKind = "rate_limited" | "permission" | "not_found" | "server" | "network" | "unknown";

export interface GitHubErrorClassification {
  kind: GitHubErrorKind;
  retriable: boolean;
  status: number | null;
  message: string;
  rateLimitRemaining: number | null;
  rateLimitResetAt: string | null;
  retryAfterSeconds: number | null;
}

export function createGitHubClient(): { octokit: Octokit; sourceAuthType: SourceAuthType } {
  const token = process.env.MO_DEVFLOW_GITHUB_TOKEN ?? process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  return {
    octokit: new Octokit(token ? { auth: token } : {}),
    sourceAuthType: token ? "service_read_token" : "anonymous"
  };
}

export function configuredGitHubSourceAuthType(env: Record<string, string | undefined> = process.env): SourceAuthType {
  return env.MO_DEVFLOW_GITHUB_TOKEN || env.GITHUB_TOKEN || env.GH_TOKEN ? "service_read_token" : "anonymous";
}

function createUserGitHubClient(token: string): Octokit {
  return new Octokit({ auth: token });
}

export async function validateGitHubToken(token: string): Promise<GitHubTokenValidation> {
  const octokit = createUserGitHubClient(token);
  const response = await octokit.rest.users.getAuthenticated();
  const scopesHeader = response.headers["x-oauth-scopes"];
  const scopes =
    typeof scopesHeader === "string"
      ? scopesHeader
          .split(",")
          .map((scope) => scope.trim())
          .filter(Boolean)
      : [];

  return {
    githubId: String(response.data.id),
    githubLogin: response.data.login,
    avatarUrl: response.data.avatar_url ?? null,
    scopes,
    rateLimitRemaining: readRateLimit(response.headers)
  };
}

export async function fetchIssueFreshState(input: {
  token: string;
  profile: RepoProfile;
  issueNumber: number;
}): Promise<GitHubIssueFreshState> {
  const octokit = createUserGitHubClient(input.token);
  const response = await octokit.rest.issues.get({
    owner: input.profile.repo.owner,
    repo: input.profile.repo.name,
    issue_number: input.issueNumber
  });
  return {
    state: response.data.state === "closed" ? "closed" : "open",
    labels: response.data.labels
      .map((label) => (typeof label === "string" ? label : label.name ?? ""))
      .filter(Boolean),
    updatedAt: response.data.updated_at,
    rateLimitRemaining: readRateLimit(response.headers)
  };
}

export async function applyWorkflowFixPreview(input: {
  token: string;
  profile: RepoProfile;
  preview: WorkflowFixPreview;
}): Promise<GitHubWorkflowFixApplyResult> {
  if (input.preview.objectType !== "issue") {
    throw new Error("Only issue workflow fixes can be executed.");
  }
  if (input.preview.actionKey === "add_needs_triage") {
    return applyAddNeedsTriageWorkflowFix(input);
  }
  if (input.preview.actionKey === "move_to_deferred") {
    return applyMoveToDeferredWorkflowFix(input);
  }
  throw new Error("Unsupported workflow fix action.");
}

async function applyAddNeedsTriageWorkflowFix(input: {
  token: string;
  profile: RepoProfile;
  preview: WorkflowFixPreview;
}): Promise<GitHubWorkflowFixApplyResult> {
  if (input.preview.ruleKey !== "bug_missing_needs_triage") {
    throw new Error("Only missing needs-triage workflow fixes can be executed.");
  }
  const unsupportedOperation = input.preview.operations.find((operation) => operation.type !== "add_label");
  if (unsupportedOperation) {
    throw new Error(`Unsupported workflow fix operation: ${unsupportedOperation.type}`);
  }
  const freshState = await fetchIssueFreshState({
    token: input.token,
    profile: input.profile,
    issueNumber: input.preview.objectNumber
  });
  const labelsToAdd = input.preview.operations
    .filter((operation): operation is Extract<WorkflowFixOperation, { type: "add_label" }> => operation.type === "add_label")
    .map((operation) => operation.label);

  const staleReason = missingNeedsTriageStaleReason(input.profile, freshState, labelsToAdd);
  const beforeState = stateSnapshotFromFreshIssue(freshState);
  if (staleReason) {
    return {
      freshState,
      appliedOperations: [],
      beforeState,
      afterState: beforeState,
      response: { skipped: staleReason },
      rateLimitRemaining: freshState.rateLimitRemaining
    };
  }

  const response = await createUserGitHubClient(input.token).rest.issues.addLabels({
    owner: input.profile.repo.owner,
    repo: input.profile.repo.name,
    issue_number: input.preview.objectNumber,
    labels: labelsToAdd
  });
  const responseLabels = response.data.map((label) => label.name).filter((label): label is string => Boolean(label));

  return {
    freshState,
    appliedOperations: input.preview.operations,
    beforeState,
    afterState: {
      ...beforeState,
      labels: responseLabels.length > 0 ? responseLabels : appendUnique(freshState.labels, labelsToAdd),
      updatedAt: null
    },
    response: {
      status: response.status,
      labels: response.data.map((label) => label.name)
    },
    rateLimitRemaining: readRateLimit(response.headers) ?? freshState.rateLimitRemaining
  };
}

async function applyMoveToDeferredWorkflowFix(input: {
  token: string;
  profile: RepoProfile;
  preview: WorkflowFixPreview;
}): Promise<GitHubWorkflowFixApplyResult> {
  if (!["needs_triage_stale", "premature_active_severity"].includes(input.preview.ruleKey)) {
    throw new Error("Only stale triage or premature active severity issues can be moved to deferred.");
  }
  const unsupportedOperation = input.preview.operations.find(
    (operation) => !["remove_label", "add_label", "add_comment"].includes(operation.type)
  );
  if (unsupportedOperation) {
    throw new Error(`Unsupported workflow fix operation: ${unsupportedOperation.type}`);
  }
  const freshState = await fetchIssueFreshState({
    token: input.token,
    profile: input.profile,
    issueNumber: input.preview.objectNumber
  });
  const beforeState = stateSnapshotFromFreshIssue(freshState);
  const staleReason = moveToDeferredStaleReason(input.profile, input.preview, freshState);
  if (staleReason) {
    return {
      freshState,
      appliedOperations: [],
      beforeState,
      afterState: beforeState,
      response: { skipped: staleReason },
      rateLimitRemaining: freshState.rateLimitRemaining
    };
  }

  const octokit = createUserGitHubClient(input.token);
  const appliedOperations: WorkflowFixOperation[] = [];
  const responses: unknown[] = [];
  let rateLimitRemaining = freshState.rateLimitRemaining;
  let labels = [...freshState.labels];

  for (const operation of input.preview.operations) {
    if (operation.type === "remove_label") {
      if (!labels.includes(operation.label)) {
        continue;
      }
      const response = await octokit.rest.issues.removeLabel({
        owner: input.profile.repo.owner,
        repo: input.profile.repo.name,
        issue_number: input.preview.objectNumber,
        name: operation.label
      });
      rateLimitRemaining = readRateLimit(response.headers) ?? rateLimitRemaining;
      labels = labels.filter((label) => label !== operation.label);
      appliedOperations.push(operation);
      responses.push({ type: operation.type, status: response.status, label: operation.label });
      continue;
    }

    if (operation.type === "add_label") {
      if (labels.includes(operation.label)) {
        continue;
      }
      const response = await octokit.rest.issues.addLabels({
        owner: input.profile.repo.owner,
        repo: input.profile.repo.name,
        issue_number: input.preview.objectNumber,
        labels: [operation.label]
      });
      rateLimitRemaining = readRateLimit(response.headers) ?? rateLimitRemaining;
      const responseLabels = response.data.map((label) => label.name).filter((label): label is string => Boolean(label));
      labels = responseLabels.length > 0 ? responseLabels : appendUnique(labels, [operation.label]);
      appliedOperations.push(operation);
      responses.push({ type: operation.type, status: response.status, labels: [operation.label] });
      continue;
    }

    const response = await octokit.rest.issues.createComment({
      owner: input.profile.repo.owner,
      repo: input.profile.repo.name,
      issue_number: input.preview.objectNumber,
      body: operation.body
    });
    rateLimitRemaining = readRateLimit(response.headers) ?? rateLimitRemaining;
    appliedOperations.push(operation);
    responses.push({
      type: operation.type,
      status: response.status,
      url: response.data.html_url
    });
  }

  return {
    freshState,
    appliedOperations,
    beforeState,
    afterState: {
      ...beforeState,
      labels,
      lifecycleState: labels.includes(input.profile.labels.deferred) ? "deferred" : beforeState.lifecycleState,
      severity: null,
      updatedAt: null
    },
    response: { operations: responses },
    rateLimitRemaining
  };
}

function appendUnique(values: string[], additions: string[]): string[] {
  const merged = [...values];
  for (const addition of additions) {
    if (!merged.includes(addition)) {
      merged.push(addition);
    }
  }
  return merged;
}

function stateSnapshotFromFreshIssue(freshState: GitHubIssueFreshState): WorkflowFixStateSnapshot {
  return {
    source: "github",
    state: freshState.state,
    labels: [...freshState.labels],
    assignees: [],
    lifecycleState: null,
    severity: null,
    aiEffortLabel: null,
    updatedAt: freshState.updatedAt
  };
}

function missingNeedsTriageStaleReason(
  profile: RepoProfile,
  freshState: GitHubIssueFreshState,
  labelsToAdd: string[]
): string | null {
  if (freshState.state !== "open") {
    return "issue_closed";
  }
  const hasLabelToAdd = labelsToAdd.some((label) => freshState.labels.includes(label));
  if (hasLabelToAdd || freshState.labels.includes(profile.labels.needsTriage)) {
    return "label_already_present";
  }
  if (!freshState.labels.includes(profile.labels.bug)) {
    return "bug_label_missing";
  }
  if (freshState.labels.includes(profile.labels.deferred)) {
    return "issue_deferred";
  }
  if (profile.labels.active.some((label) => freshState.labels.includes(label))) {
    return "active_lifecycle_present";
  }
  return null;
}

function moveToDeferredStaleReason(
  profile: RepoProfile,
  preview: WorkflowFixPreview,
  freshState: GitHubIssueFreshState
): string | null {
  if (freshState.state !== "open") {
    return "issue_closed";
  }
  if (freshState.labels.includes(profile.labels.deferred)) {
    return "issue_deferred";
  }
  if (!sameStringSet(lifecycleLabels(profile, freshState.labels), lifecycleLabels(profile, preview.currentState.labels))) {
    return "lifecycle_labels_changed";
  }
  if (!preview.operations.some((operation) => operation.type === "add_label" && operation.label === profile.labels.deferred)) {
    return "missing_deferred_label_operation";
  }
  if (!preview.operations.some((operation) => operation.type === "add_comment" && operation.body.trim().length > 0)) {
    return "missing_deferred_comment_operation";
  }
  return null;
}

function lifecycleLabels(profile: RepoProfile, labels: string[]): string[] {
  const configured = new Set([profile.labels.needsTriage, profile.labels.deferred, ...profile.labels.active]);
  return labels.filter((label) => configured.has(label)).sort();
}

function sameStringSet(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((value, index) => value === right[index]);
}

function headerValue(headers: Record<string, string | number | undefined>, name: string): string | number | undefined {
  return headers[name] ?? headers[name.toLowerCase()] ?? headers[name.toUpperCase()];
}

function readRateLimit(headers: Record<string, string | number | undefined>): number | null {
  const remainingHeader = headerValue(headers, "x-ratelimit-remaining");
  return remainingHeader === undefined ? null : Number(remainingHeader);
}

function readRetryAfterSeconds(headers: Record<string, string | number | undefined>): number | null {
  const retryAfter = headerValue(headers, "retry-after");
  const parsed = retryAfter === undefined ? null : Number(retryAfter);
  return parsed !== null && Number.isFinite(parsed) && parsed >= 0 ? Math.ceil(parsed) : null;
}

function readRateLimitResetAt(headers: Record<string, string | number | undefined>): string | null {
  const resetHeader = headerValue(headers, "x-ratelimit-reset");
  const resetSeconds = resetHeader === undefined ? null : Number(resetHeader);
  if (resetSeconds === null || !Number.isFinite(resetSeconds) || resetSeconds <= 0) {
    return null;
  }
  return new Date(resetSeconds * 1000).toISOString();
}

function secondsUntil(iso: string | null): number | null {
  if (!iso) {
    return null;
  }
  const diff = Math.ceil((new Date(iso).getTime() - Date.now()) / 1000);
  return Number.isFinite(diff) ? Math.max(0, diff) : null;
}

function errorHeaders(error: unknown): Record<string, string | number | undefined> {
  const headers = (error as { response?: { headers?: Record<string, string | number | undefined> } })?.response?.headers;
  return headers ?? {};
}

function errorStatus(error: unknown): number | null {
  const status = (error as { status?: number; response?: { status?: number } })?.status ?? (error as { response?: { status?: number } })?.response?.status;
  return typeof status === "number" ? status : null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function classifyGitHubError(error: unknown): GitHubErrorClassification {
  const headers = errorHeaders(error);
  const status = errorStatus(error);
  const message = errorMessage(error);
  const rateLimitRemaining = readRateLimit(headers);
  const rateLimitResetAt = readRateLimitResetAt(headers);
  const retryAfterSeconds = readRetryAfterSeconds(headers) ?? secondsUntil(rateLimitResetAt);
  const lowerMessage = message.toLowerCase();
  const rateLimited =
    status === 429 ||
    (status === 403 && rateLimitRemaining === 0) ||
    lowerMessage.includes("rate limit") ||
    lowerMessage.includes("secondary rate limit");
  if (rateLimited) {
    return {
      kind: "rate_limited",
      retriable: true,
      status,
      message,
      rateLimitRemaining,
      rateLimitResetAt,
      retryAfterSeconds
    };
  }
  if (status === 401 || status === 403) {
    return {
      kind: "permission",
      retriable: false,
      status,
      message,
      rateLimitRemaining,
      rateLimitResetAt,
      retryAfterSeconds: null
    };
  }
  if (status === 404) {
    return {
      kind: "not_found",
      retriable: false,
      status,
      message,
      rateLimitRemaining,
      rateLimitResetAt,
      retryAfterSeconds: null
    };
  }
  if (status !== null && status >= 500) {
    return {
      kind: "server",
      retriable: true,
      status,
      message,
      rateLimitRemaining,
      rateLimitResetAt,
      retryAfterSeconds
    };
  }
  if (status === null) {
    return {
      kind: "network",
      retriable: true,
      status,
      message,
      rateLimitRemaining,
      rateLimitResetAt,
      retryAfterSeconds
    };
  }
  return {
    kind: "unknown",
    retriable: true,
    status,
    message,
    rateLimitRemaining,
    rateLimitResetAt,
    retryAfterSeconds
  };
}

async function collectPages<T>(
  iterator: AsyncIterable<{ data: T[]; headers: Record<string, string | number | undefined> }>,
  maxPages: number
): Promise<{ data: T[]; rateLimitRemaining: number | null; complete: boolean }> {
  const data: T[] = [];
  let page = 0;
  let rateLimitRemaining: number | null = null;
  let complete = true;
  for await (const response of iterator) {
    page += 1;
    data.push(...response.data);
    rateLimitRemaining = readRateLimit(response.headers) ?? rateLimitRemaining;
    if (page >= maxPages) {
      complete = !githubLinkHeaderHasNextPage(response.headers);
      break;
    }
  }
  return { data, rateLimitRemaining, complete };
}

export function githubLinkHeaderHasNextPage(headers: Record<string, string | number | undefined>): boolean {
  const link = headers.link;
  return typeof link === "string" && link.split(",").some((part) => part.includes('rel="next"'));
}

function normalizeCiState(
  combinedStatus: string | null,
  checkRuns: Array<{ status?: string | null; conclusion?: string | null }>
): string | null {
  const conclusions = checkRuns.map((run) => run.conclusion).filter(Boolean);
  const statuses = checkRuns.map((run) => run.status).filter(Boolean);
  if (conclusions.some((value) => ["failure", "timed_out", "action_required", "cancelled"].includes(value ?? ""))) {
    return "failure";
  }
  if (combinedStatus === "failure" || combinedStatus === "error") {
    return combinedStatus;
  }
  if (statuses.some((value) => ["queued", "in_progress", "requested", "waiting", "pending"].includes(value ?? ""))) {
    return "pending";
  }
  if (combinedStatus === "pending") {
    return "pending";
  }
  if (checkRuns.length > 0 && conclusions.every((value) => ["success", "neutral", "skipped"].includes(value ?? ""))) {
    return "success";
  }
  return combinedStatus;
}

function reviewInsight(
  reviews: Array<{ state?: string | null; submitted_at?: string | null; user?: { login?: string | null } | null }>
): Pick<PullRequestInsight, "reviewDecision" | "latestReviewState" | "latestReviewSubmittedAt"> {
  const latestByReviewer = new Map<string, { state: string; submittedAt: string }>();
  let latestReviewState: string | null = null;
  let latestReviewSubmittedAt: string | null = null;
  let latestReviewTime = Number.NEGATIVE_INFINITY;

  for (const review of reviews) {
    if (!review.state || !review.submitted_at) {
      continue;
    }
    const submittedTime = new Date(review.submitted_at).getTime();
    if (!Number.isFinite(submittedTime)) {
      continue;
    }
    const login = review.user?.login ?? `anonymous-${submittedTime}`;
    const previous = latestByReviewer.get(login);
    if (!previous || submittedTime > new Date(previous.submittedAt).getTime()) {
      latestByReviewer.set(login, { state: review.state, submittedAt: review.submitted_at });
    }
    if (submittedTime > latestReviewTime) {
      latestReviewTime = submittedTime;
      latestReviewState = review.state;
      latestReviewSubmittedAt = review.submitted_at;
    }
  }

  const latestStates = Array.from(latestByReviewer.values()).map((review) => review.state);
  const reviewDecision = latestStates.includes("CHANGES_REQUESTED")
    ? "changes_requested"
    : latestStates.includes("APPROVED")
      ? "approved"
      : latestStates.length > 0
        ? "reviewed"
        : null;

  return {
    reviewDecision,
    latestReviewState,
    latestReviewSubmittedAt
  };
}

async function fetchPullRequestInsight(
  octokit: Octokit,
  owner: string,
  repo: string,
  pr: PullRequestListItem
): Promise<{ insight: PullRequestInsight; rateLimitRemaining: number | null }> {
  let rateLimitRemaining: number | null = null;
  const detailSyncedAt = new Date().toISOString();
  try {
    const detail = await octokit.rest.pulls.get({ owner, repo, pull_number: pr.number });
    rateLimitRemaining = readRateLimit(detail.headers) ?? rateLimitRemaining;
    const detailData = detail.data as typeof detail.data & { mergeable_state?: string | null; commits?: number | null };

    const reviewsResponse = await octokit.rest.pulls.listReviews({
      owner,
      repo,
      pull_number: pr.number,
      per_page: 100
    });
    rateLimitRemaining = readRateLimit(reviewsResponse.headers) ?? rateLimitRemaining;

    const review = reviewInsight(reviewsResponse.data);
    let combinedStatus: string | null = null;
    let checkRuns: Array<{ status?: string | null; conclusion?: string | null }> = [];
    const headSha = detail.data.head.sha;

    try {
      const statusResponse = await octokit.rest.repos.getCombinedStatusForRef({ owner, repo, ref: headSha });
      rateLimitRemaining = readRateLimit(statusResponse.headers) ?? rateLimitRemaining;
      combinedStatus = statusResponse.data.state;
    } catch {
      combinedStatus = null;
    }

    try {
      const checksResponse = await octokit.rest.checks.listForRef({ owner, repo, ref: headSha, per_page: 100 });
      rateLimitRemaining = readRateLimit(checksResponse.headers) ?? rateLimitRemaining;
      checkRuns = checksResponse.data.check_runs.map((run) => ({
        status: run.status,
        conclusion: run.conclusion
      }));
    } catch {
      checkRuns = [];
    }

    let latestCommitAt: string | null = null;
    const commits = Number(detailData.commits ?? 0);
    if (commits > 0) {
      const commitResponse = await octokit.rest.pulls.listCommits({
        owner,
        repo,
        pull_number: pr.number,
        per_page: 1,
        page: commits
      });
      rateLimitRemaining = readRateLimit(commitResponse.headers) ?? rateLimitRemaining;
      latestCommitAt =
        commitResponse.data[0]?.commit.committer?.date ?? commitResponse.data[0]?.commit.author?.date ?? null;
    }

    return {
      insight: {
        number: pr.number,
        reviewDecision: review.reviewDecision,
        mergeStateStatus: detailData.mergeable_state ?? null,
        ciState: normalizeCiState(combinedStatus, checkRuns),
        latestReviewState: review.latestReviewState,
        latestReviewSubmittedAt: review.latestReviewSubmittedAt,
        latestCommitAt,
        detailSyncedAt,
        detailError: null
      },
      rateLimitRemaining
    };
  } catch (error) {
    return {
      insight: {
        number: pr.number,
        reviewDecision: null,
        mergeStateStatus: null,
        ciState: null,
        latestReviewState: null,
        latestReviewSubmittedAt: null,
        latestCommitAt: null,
        detailSyncedAt,
        detailError: error instanceof Error ? error.message : String(error)
      },
      rateLimitRemaining
    };
  }
}

async function fetchPullRequestInsights(input: {
  octokit: Octokit;
  owner: string;
  repo: string;
  pullRequests: PullRequestListItem[];
  sourceAuthType: SourceAuthType;
}): Promise<{ insights: Map<number, PullRequestInsight>; rateLimitRemaining: number | null }> {
  const configuredLimit = process.env.MO_DEVFLOW_PR_DETAIL_MAX_ITEMS;
  const defaultLimit = input.sourceAuthType === "anonymous" ? 0 : 50;
  const limit = Math.max(0, Number(configuredLimit ?? defaultLimit));
  const selected = input.pullRequests.filter((pr) => pr.state === "open").slice(0, limit);
  const insights = new Map<number, PullRequestInsight>();
  let rateLimitRemaining: number | null = null;

  for (const pr of selected) {
    const result = await fetchPullRequestInsight(input.octokit, input.owner, input.repo, pr);
    insights.set(result.insight.number, result.insight);
    rateLimitRemaining = result.rateLimitRemaining ?? rateLimitRemaining;
    if (input.sourceAuthType === "anonymous" && rateLimitRemaining !== null && rateLimitRemaining < 8) {
      break;
    }
  }

  return { insights, rateLimitRemaining };
}

export async function fetchGitHubSnapshot(profile: RepoProfile): Promise<GitHubSnapshot> {
  const { octokit, sourceAuthType } = createGitHubClient();
  const maxPages = Math.max(1, Number(process.env.MO_DEVFLOW_SYNC_MAX_PAGES ?? "2"));
  const owner = profile.repo.owner;
  const repo = profile.repo.name;

  const issuesResult = await collectPages(
    octokit.paginate.iterator(octokit.rest.issues.listForRepo, {
      owner,
      repo,
      state: "open",
      per_page: 100,
      sort: "updated",
      direction: "desc"
    }),
    maxPages
  );

  const openPrsResult = await collectPages(
    octokit.paginate.iterator(octokit.rest.pulls.list, {
      owner,
      repo,
      state: "open",
      per_page: 100,
      sort: "updated",
      direction: "desc"
    }),
    maxPages
  );

  const closedPrsResult = await collectPages(
    octokit.paginate.iterator(octokit.rest.pulls.list, {
      owner,
      repo,
      state: "closed",
      per_page: 100,
      sort: "updated",
      direction: "desc"
    }),
    1
  );

  const prsByNumber = new Map<number, (typeof openPrsResult.data)[number]>();
  for (const pr of [...openPrsResult.data, ...closedPrsResult.data]) {
    prsByNumber.set(pr.number, pr);
  }

  const prInsightsResult = await fetchPullRequestInsights({
    octokit,
    owner,
    repo,
    pullRequests: openPrsResult.data,
    sourceAuthType
  });

  return {
    issues: issuesResult.data,
    pullRequests: Array.from(prsByNumber.values()),
    pullRequestInsights: prInsightsResult.insights,
    sourceAuthType,
    rateLimitRemaining:
      prInsightsResult.rateLimitRemaining ?? issuesResult.rateLimitRemaining ?? openPrsResult.rateLimitRemaining ?? null,
    issuesComplete: issuesResult.complete,
    openPullRequestsComplete: openPrsResult.complete
  };
}
