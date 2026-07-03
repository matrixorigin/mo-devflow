import { loadEnv, loadRepoProfile } from "@mo-devflow/config";
import {
  recordSyncRun,
  runWithJobLease,
  upsertAttentionItem,
  upsertIssue,
  upsertPullRequest,
  upsertRepoProfile
} from "@mo-devflow/db";
import { fetchGitHubSnapshot } from "@mo-devflow/github";
import { criticalAttentionForIssue, normalizeIssue, normalizePullRequest } from "@mo-devflow/rules";
import type { NormalizedIssue } from "@mo-devflow/shared";

export interface SyncResult {
  repoId: number;
  issues: number;
  pullRequests: number;
  rateLimitRemaining: number | null;
}

function shouldKeepIssue(issue: NormalizedIssue): boolean {
  return !issue.isPullRequest;
}

export async function syncOnce(): Promise<SyncResult | null> {
  loadEnv();
  const profile = loadRepoProfile();
  const startedAt = new Date().toISOString();
  const repoId = await upsertRepoProfile(profile);

  return runWithJobLease(`github-sync:${profile.key}`, "github_sync", async () => {
    try {
      const snapshot = await fetchGitHubSnapshot(profile);
      let issueCount = 0;
      let prCount = 0;

      for (const rawIssue of snapshot.issues) {
        const issue = normalizeIssue(profile, rawIssue, snapshot.sourceAuthType);
        if (!shouldKeepIssue(issue)) {
          continue;
        }
        await upsertIssue(repoId, issue);
        issueCount += 1;

        for (const flag of criticalAttentionForIssue(profile, issue)) {
          await upsertAttentionItem({
            repoId,
            objectType: "issue",
            objectNumber: issue.number,
            ruleKey: flag,
            severity: "critical",
            relatedLogin: issue.ownerLogin,
            targetRecipient: issue.ownerLogin,
            dedupeKey: `${profile.key}:issue:${issue.number}:${flag}`,
            evidenceSummary: `Critical issue #${issue.number} has no recent human action.`
          });
        }
      }

      for (const rawPr of snapshot.pullRequests) {
        const pr = normalizePullRequest(profile, rawPr, snapshot.sourceAuthType);
        await upsertPullRequest(repoId, pr);
        prCount += 1;
        for (const flag of pr.attentionFlags) {
          await upsertAttentionItem({
            repoId,
            objectType: "pull_request",
            objectNumber: pr.number,
            ruleKey: flag,
            severity: "warning",
            relatedLogin: pr.ownerLogin,
            targetRecipient: pr.ownerLogin,
            dedupeKey: `${profile.key}:pr:${pr.number}:${flag}`,
            evidenceSummary: `PR #${pr.number} has no recent human action.`
          });
        }
      }

      await recordSyncRun({
        repoId,
        syncLayer: "github_snapshot",
        status: "success",
        sourceAuthType: snapshot.sourceAuthType,
        startedAt,
        finishedAt: new Date().toISOString(),
        rateLimitRemaining: snapshot.rateLimitRemaining,
        raw: { issues: issueCount, pullRequests: prCount }
      });

      return {
        repoId,
        issues: issueCount,
        pullRequests: prCount,
        rateLimitRemaining: snapshot.rateLimitRemaining
      };
    } catch (error) {
      await recordSyncRun({
        repoId,
        syncLayer: "github_snapshot",
        status: "failed",
        sourceAuthType: "anonymous",
        startedAt,
        finishedAt: new Date().toISOString(),
        errorMessage: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  });
}
