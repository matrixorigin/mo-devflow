import { Octokit } from "@octokit/rest";
import type { RestEndpointMethodTypes } from "@octokit/rest";
import type { RepoProfile, SourceAuthType } from "@mo-devflow/shared";

export interface GitHubSnapshot {
  issues: RestEndpointMethodTypes["issues"]["listForRepo"]["response"]["data"];
  pullRequests: RestEndpointMethodTypes["pulls"]["list"]["response"]["data"];
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
    const remainingHeader = response.headers["x-ratelimit-remaining"];
    if (remainingHeader !== undefined) {
      rateLimitRemaining = Number(remainingHeader);
    }
    if (page >= maxPages) {
      break;
    }
  }
  return { data, rateLimitRemaining };
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

  return {
    issues: issuesResult.data,
    pullRequests: Array.from(prsByNumber.values()),
    sourceAuthType,
    rateLimitRemaining: issuesResult.rateLimitRemaining ?? openPrsResult.rateLimitRemaining ?? null
  };
}
