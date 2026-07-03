import { Octokit } from "@octokit/rest";
import type { RestEndpointMethodTypes } from "@octokit/rest";
import type { PullRequestInsight, RepoProfile, SourceAuthType } from "@mo-devflow/shared";

type PullRequestListItem = RestEndpointMethodTypes["pulls"]["list"]["response"]["data"][number];

export interface GitHubSnapshot {
  issues: RestEndpointMethodTypes["issues"]["listForRepo"]["response"]["data"];
  pullRequests: RestEndpointMethodTypes["pulls"]["list"]["response"]["data"];
  pullRequestInsights: Map<number, PullRequestInsight>;
  sourceAuthType: SourceAuthType;
  rateLimitRemaining: number | null;
}

export function createGitHubClient(): { octokit: Octokit; sourceAuthType: SourceAuthType } {
  const token = process.env.MO_DEVFLOW_GITHUB_TOKEN ?? process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  return {
    octokit: new Octokit(token ? { auth: token } : {}),
    sourceAuthType: token ? "service_read_token" : "anonymous"
  };
}

function readRateLimit(headers: Record<string, string | number | undefined>): number | null {
  const remainingHeader = headers["x-ratelimit-remaining"];
  return remainingHeader === undefined ? null : Number(remainingHeader);
}

async function collectPages<T>(
  iterator: AsyncIterable<{ data: T[]; headers: Record<string, string | number | undefined> }>,
  maxPages: number
): Promise<{ data: T[]; rateLimitRemaining: number | null }> {
  const data: T[] = [];
  let page = 0;
  let rateLimitRemaining: number | null = null;
  for await (const response of iterator) {
    page += 1;
    data.push(...response.data);
    rateLimitRemaining = readRateLimit(response.headers) ?? rateLimitRemaining;
    if (page >= maxPages) {
      break;
    }
  }
  return { data, rateLimitRemaining };
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
      prInsightsResult.rateLimitRemaining ?? issuesResult.rateLimitRemaining ?? openPrsResult.rateLimitRemaining ?? null
  };
}
