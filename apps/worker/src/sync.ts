import { loadEnv, loadRepoProfile } from "@mo-devflow/config";
import {
  listCachedIssuesForRules,
  listNotificationCandidates,
  isNotificationInCooldown,
  recordSyncRun,
  recordNotificationDelivery,
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
import { buildWeComMarkdown, isInQuietHours, sendWeComMarkdown } from "@mo-devflow/notifications";
import {
  aiDriftSignalsForIssue,
  criticalAttentionForIssue,
  normalizeIssue,
  normalizePullRequest,
  workflowViolationsForIssue
} from "@mo-devflow/rules";
import type { AiDriftSignal, NormalizedIssue, NotificationStatus, WorkflowViolation } from "@mo-devflow/shared";

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

export interface NotificationSyncResult {
  repoId: number;
  candidates: number;
  sent: number;
  skipped: number;
  failed: number;
  cooldown: number;
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

function notificationLimitFromEnv(): number {
  const parsed = Number(process.env.MO_DEVFLOW_NOTIFICATION_LIMIT ?? "20");
  if (!Number.isFinite(parsed)) {
    return 20;
  }
  return Math.max(1, Math.floor(parsed));
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

export async function sendNotificationsOnce(): Promise<NotificationSyncResult> {
  loadEnv();
  const profile = loadRepoProfile();
  const startedAt = new Date().toISOString();
  const repoId = await upsertRepoProfile(profile);
  const limit = notificationLimitFromEnv();
  const dryRun = process.env.MO_DEVFLOW_NOTIFICATION_DRY_RUN === "1";
  const candidates = await listNotificationCandidates(repoId, profile, limit);
  const webhookUrl = profile.notifications.wecom.webhookUrlEnv
    ? process.env[profile.notifications.wecom.webhookUrlEnv]
    : undefined;
  const summary: NotificationSyncResult = {
    repoId,
    candidates: candidates.length,
    sent: 0,
    skipped: 0,
    failed: 0,
    cooldown: 0
  };
  const deliveryCooldownStatuses: NotificationStatus[] = ["sent", "failed", "dry_run"];

  for (const candidate of candidates) {
    const payload = {
      markdown: buildWeComMarkdown(profile, candidate),
      candidate
    };

    if (!profile.notifications.wecom.enabled) {
      if (
        await isNotificationInCooldown(candidate.dedupeKey, profile.notifications.routing.cooldownHours, [
          "skipped_disabled"
        ])
      ) {
        summary.cooldown += 1;
        continue;
      }
      await recordNotificationDelivery({
        repoId,
        candidate,
        channel: "wecom",
        status: "skipped_disabled",
        dryRun: false,
        payload
      });
      summary.skipped += 1;
      continue;
    }

    if (!webhookUrl) {
      if (
        await isNotificationInCooldown(candidate.dedupeKey, profile.notifications.routing.cooldownHours, [
          "skipped_no_webhook"
        ])
      ) {
        summary.cooldown += 1;
        continue;
      }
      await recordNotificationDelivery({
        repoId,
        candidate,
        channel: "wecom",
        status: "skipped_no_webhook",
        dryRun: false,
        payload,
        errorMessage: "WeCom notification is enabled but webhook URL is not configured."
      });
      summary.skipped += 1;
      continue;
    }

    if (candidate.severity !== "critical" && isInQuietHours(profile.notifications.wecom.quietHours, profile.reporting.timezone)) {
      if (
        await isNotificationInCooldown(candidate.dedupeKey, profile.notifications.routing.cooldownHours, [
          "skipped_quiet_hours"
        ])
      ) {
        summary.cooldown += 1;
        continue;
      }
      await recordNotificationDelivery({
        repoId,
        candidate,
        channel: "wecom",
        status: "skipped_quiet_hours",
        dryRun: false,
        payload
      });
      summary.skipped += 1;
      continue;
    }

    if (await isNotificationInCooldown(candidate.dedupeKey, profile.notifications.routing.cooldownHours, deliveryCooldownStatuses)) {
      summary.cooldown += 1;
      continue;
    }

    if (dryRun) {
      await recordNotificationDelivery({
        repoId,
        candidate,
        channel: "wecom",
        status: "dry_run",
        dryRun: true,
        payload
      });
      summary.skipped += 1;
      continue;
    }

    try {
      const providerResponse = await sendWeComMarkdown(webhookUrl, payload.markdown);
      await recordNotificationDelivery({
        repoId,
        candidate,
        channel: "wecom",
        status: "sent",
        dryRun: false,
        payload,
        providerResponse
      });
      summary.sent += 1;
    } catch (error) {
      await recordNotificationDelivery({
        repoId,
        candidate,
        channel: "wecom",
        status: "failed",
        dryRun: false,
        payload,
        errorMessage: error instanceof Error ? error.message : String(error)
      });
      summary.failed += 1;
    }
  }

  await recordSyncRun({
    repoId,
    syncLayer: "notifications",
    status: summary.failed > 0 ? "partial" : "success",
    sourceAuthType: "cache",
    startedAt,
    finishedAt: new Date().toISOString(),
    raw: summary
  });
  return summary;
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
