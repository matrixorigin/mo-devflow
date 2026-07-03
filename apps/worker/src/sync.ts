import { loadEnv, loadRepoProfile } from "@mo-devflow/config";
import {
  listCachedIssuesForRules,
  recordSyncRun,
  recomputeDailyMetricsFromCache,
  replaceAiDriftSignals,
  replaceWorkflowViolations,
  runWithJobLease,
  upsertAttentionItem,
  upsertIssue,
  upsertPullRequest,
  upsertRepoProfile
} from "@mo-devflow/db";
import { fetchGitHubSnapshot } from "@mo-devflow/github";
import {
  aiDriftSignalsForIssue,
  criticalAttentionForIssue,
  normalizeIssue,
  normalizePullRequest,
  workflowViolationsForIssue
} from "@mo-devflow/rules";
import type { AiDriftSignal, NormalizedIssue, WorkflowViolation } from "@mo-devflow/shared";

export interface SyncResult {
  repoId: number;
  issues: number;
  pullRequests: number;
  rateLimitRemaining: number | null;
}

export interface RuleSyncResult {
  repoId: number;
  workflowViolations: number;
}

export interface MetricSyncResult {
  repoId: number;
  dailyMetrics: number;
}

export interface DriftSyncResult {
  repoId: number;
  aiDriftSignals: number;
}

function shouldKeepIssue(issue: NormalizedIssue): boolean {
  return !issue.isPullRequest;
}

function prEvidence(flag: string, prNumber: number): string {
  if (flag === "requested_changes") {
    return `PR #${prNumber} has unresolved requested changes.`;
  }
  if (flag === "ci_failed") {
    return `PR #${prNumber} has failing CI checks.`;
  }
  if (flag === "merge_conflict") {
    return `PR #${prNumber} has a merge conflict.`;
  }
  return `PR #${prNumber} has no recent human action.`;
}

export async function recomputeWorkflowViolationsFromCache(): Promise<RuleSyncResult> {
  loadEnv();
  const profile = loadRepoProfile();
  const startedAt = new Date().toISOString();
  const repoId = await upsertRepoProfile(profile);
  const issues = await listCachedIssuesForRules(repoId);
  const workflowViolations = issues.flatMap((issue) => workflowViolationsForIssue(profile, issue));
  await replaceWorkflowViolations(repoId, workflowViolations);
  await recordSyncRun({
    repoId,
    syncLayer: "rules",
    status: "success",
    sourceAuthType: "cache",
    startedAt,
    finishedAt: new Date().toISOString(),
    raw: { workflowViolations: workflowViolations.length }
  });
  return { repoId, workflowViolations: workflowViolations.length };
}

export async function recomputeMetricsFromCache(): Promise<MetricSyncResult> {
  loadEnv();
  const profile = loadRepoProfile();
  const startedAt = new Date().toISOString();
  const repoId = await upsertRepoProfile(profile);
  const dailyMetrics = await recomputeDailyMetricsFromCache(repoId, profile, 30);
  await recordSyncRun({
    repoId,
    syncLayer: "metrics",
    status: "success",
    sourceAuthType: "cache",
    startedAt,
    finishedAt: new Date().toISOString(),
    raw: { dailyMetrics }
  });
  return { repoId, dailyMetrics };
}

export async function recomputeAiDriftFromCache(): Promise<DriftSyncResult> {
  loadEnv();
  const profile = loadRepoProfile();
  const startedAt = new Date().toISOString();
  const repoId = await upsertRepoProfile(profile);
  const issues = await listCachedIssuesForRules(repoId);
  const aiDriftSignals = issues.flatMap((issue) => aiDriftSignalsForIssue(profile, issue));
  await replaceAiDriftSignals(repoId, aiDriftSignals);
  await recordSyncRun({
    repoId,
    syncLayer: "ai_drift",
    status: "success",
    sourceAuthType: "cache",
    startedAt,
    finishedAt: new Date().toISOString(),
    raw: { aiDriftSignals: aiDriftSignals.length }
  });
  return { repoId, aiDriftSignals: aiDriftSignals.length };
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
      const workflowViolations: WorkflowViolation[] = [];
      const aiDriftSignals: AiDriftSignal[] = [];

      for (const rawIssue of snapshot.issues) {
        const issue = normalizeIssue(profile, rawIssue, snapshot.sourceAuthType);
        if (!shouldKeepIssue(issue)) {
          continue;
        }
        await upsertIssue(repoId, issue);
        issueCount += 1;
        workflowViolations.push(...workflowViolationsForIssue(profile, issue));
        aiDriftSignals.push(...aiDriftSignalsForIssue(profile, issue));

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
      await replaceWorkflowViolations(repoId, workflowViolations);
      await replaceAiDriftSignals(repoId, aiDriftSignals);

      for (const rawPr of snapshot.pullRequests) {
        const pr = normalizePullRequest(
          profile,
          rawPr,
          snapshot.sourceAuthType,
          snapshot.pullRequestInsights.get(rawPr.number)
        );
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
            evidenceSummary: prEvidence(flag, pr.number)
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
        raw: {
          issues: issueCount,
          pullRequests: prCount,
          pullRequestInsights: snapshot.pullRequestInsights.size,
          workflowViolations: workflowViolations.length,
          aiDriftSignals: aiDriftSignals.length
        }
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
