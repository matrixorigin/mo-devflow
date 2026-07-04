import { loadEnv, loadRepoProfile } from "@mo-devflow/config";
import {
  issueAttentionRuleKeys,
  listCachedIssuesForRules,
  listNotificationCandidates,
  isNotificationInCooldown,
  pullRequestAttentionRuleKeys,
  claimNextGitHubWebhookDelivery,
  completeGitHubWebhookDelivery,
  failGitHubWebhookDelivery,
  recordSyncRun,
  recordNotificationDelivery,
  recomputeDailyMetricsFromCache,
  replaceIssueComments,
  replaceAiDriftSignals,
  replaceWorkflowViolations,
  resolveStaleAttentionItems,
  runWithJobLease,
  snapshotManagedAttentionRuleKeys,
  upsertAttentionItem,
  upsertIssue,
  upsertPullRequest,
  upsertRepoProfile
} from "@mo-devflow/db";
import {
  classifyGitHubError,
  configuredGitHubSourceAuthType,
  fetchGitHubSnapshot,
  fetchPullRequestInsightForNumber
} from "@mo-devflow/github";
import { buildWeComMarkdown, isInQuietHours, sendWeComMarkdown } from "@mo-devflow/notifications";
import {
  aiDriftSignalsForIssue,
  criticalAttentionForIssue,
  linkedPrAuthorsByIssueNumber,
  normalizeIssueComment,
  normalizeIssue,
  normalizePullRequest,
  type CacheSource,
  workflowViolationsForIssue
} from "@mo-devflow/rules";
import {
  isSupportedGitHubWebhookEvent,
  type AiDriftSignal,
  type NormalizedIssue,
  type NotificationCandidate,
  type NotificationStatus,
  type PullRequestInsight,
  type WorkflowViolation
} from "@mo-devflow/shared";

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

export interface WebhookDeliverySyncResult {
  repoId: number;
  claimed: number;
  processed: number;
  failed: number;
  skipped: number;
}

export function syncIntervalSecondsFromEnv(): number {
  const parsed = Number(process.env.MO_DEVFLOW_SYNC_INTERVAL_SECONDS ?? "300");
  if (!Number.isFinite(parsed)) {
    return 300;
  }
  return Math.max(60, Math.floor(parsed));
}

export function dateAfterSeconds(seconds: number): string {
  return new Date(Date.now() + seconds * 1000).toISOString();
}

function shouldKeepIssue(issue: NormalizedIssue): boolean {
  return !issue.isPullRequest;
}

function issueAttentionDedupeKey(profileKey: string, issueNumber: number, flag: string): string {
  return `${profileKey}:issue:${issueNumber}:${flag}`;
}

function pullRequestAttentionDedupeKey(profileKey: string, prNumber: number, flag: string): string {
  return `${profileKey}:pr:${prNumber}:${flag}`;
}

export function prEvidence(flag: string, prNumber: number, isComplete: boolean): string {
  let evidence: string;
  if (flag === "requested_changes") {
    evidence = `PR #${prNumber} has unresolved requested changes.`;
  } else if (flag === "review_requested_no_response") {
    evidence = `PR #${prNumber} has a stale review request without reviewer response.`;
  } else if (flag === "ci_failed") {
    evidence = `PR #${prNumber} has failing CI checks.`;
  } else if (flag === "merge_conflict") {
    evidence = `PR #${prNumber} has a merge conflict.`;
  } else if (flag === "testing_stalled") {
    evidence = `PR #${prNumber} is stalled in testing handoff.`;
  } else {
    evidence = `PR #${prNumber} has no recent human action.`;
  }
  return isComplete
    ? evidence
    : `${evidence} Evidence is partial until PR detail, review, and timeline backfill completes.`;
}

function notificationLimitFromEnv(): number {
  const parsed = Number(process.env.MO_DEVFLOW_NOTIFICATION_LIMIT ?? "20");
  if (!Number.isFinite(parsed)) {
    return 20;
  }
  return Math.max(1, Math.floor(parsed));
}

function notificationCooldownHours(candidate: NotificationCandidate, defaultCooldownHours: number): number {
  if (candidate.sourceType === "daily_digest") {
    return 24 * 365 * 10;
  }
  return defaultCooldownHours;
}

function webhookLimitFromEnv(): number {
  const parsed = Number(process.env.MO_DEVFLOW_WEBHOOK_PROCESS_LIMIT ?? "20");
  if (!Number.isFinite(parsed)) {
    return 20;
  }
  return Math.max(1, Math.floor(parsed));
}

function webhookLeaseSecondsFromEnv(): number {
  const parsed = Number(process.env.MO_DEVFLOW_WEBHOOK_PROCESS_LEASE_SECONDS ?? "300");
  if (!Number.isFinite(parsed)) {
    return 300;
  }
  return Math.max(60, Math.floor(parsed));
}

function webhookWorkerId(): string {
  return `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function recordPayload(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function pullRequestNumbersFromArray(value: unknown): number[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return Array.from(
    new Set(
      value
        .map((item) => (recordPayload(item)?.number))
        .filter((number): number is number => typeof number === "number")
    )
  );
}

function pullRequestNumbersFromCiPayload(payload: Record<string, unknown>, eventName: "workflow_run" | "check_run"): number[] {
  const source = eventName === "workflow_run" ? recordPayload(payload.workflow_run) : recordPayload(payload.check_run);
  return pullRequestNumbersFromArray(source?.pull_requests);
}

function ensureGitHubObjectWithNumber(input: Record<string, unknown>, label: string): Record<string, unknown> & { id: number; number: number } {
  if (typeof input.id !== "number" || typeof input.number !== "number") {
    throw new Error(`${label} payload must include numeric id and number.`);
  }
  return input as Record<string, unknown> & { id: number; number: number };
}

function cacheSourceForWebhook(): CacheSource {
  return { authType: "service_read_token", userId: null };
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
    const cooldownHours = notificationCooldownHours(candidate, profile.notifications.routing.cooldownHours);
    const payload = {
      markdown: buildWeComMarkdown(profile, candidate),
      candidate
    };

    if (!profile.notifications.wecom.enabled) {
      if (
        await isNotificationInCooldown(candidate.dedupeKey, cooldownHours, [
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
        await isNotificationInCooldown(candidate.dedupeKey, cooldownHours, [
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
        await isNotificationInCooldown(candidate.dedupeKey, cooldownHours, [
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

    if (await isNotificationInCooldown(candidate.dedupeKey, cooldownHours, deliveryCooldownStatuses)) {
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

async function upsertPullRequestFromWebhook(input: {
  repoId: number;
  profile: ReturnType<typeof loadRepoProfile>;
  rawPullRequest: Record<string, unknown>;
  insight?: PullRequestInsight;
}): Promise<number> {
  const pr = normalizePullRequest(
    input.profile,
    ensureGitHubObjectWithNumber(input.rawPullRequest, "pull_request"),
    cacheSourceForWebhook(),
    input.insight
  );
  const cachedPr = await upsertPullRequest(input.repoId, pr);
  const activeAttentionDedupeKeys = new Set<string>();
  for (const flag of cachedPr.attentionFlags) {
    const dedupeKey = pullRequestAttentionDedupeKey(input.profile.key, cachedPr.number, flag);
    activeAttentionDedupeKeys.add(dedupeKey);
    await upsertAttentionItem({
      repoId: input.repoId,
      objectType: "pull_request",
      objectNumber: cachedPr.number,
      ruleKey: flag,
      severity: "warning",
      relatedLogin: cachedPr.ownerLogin,
      targetRecipient: cachedPr.ownerLogin,
      dedupeKey,
      evidenceSummary: prEvidence(flag, cachedPr.number, cachedPr.isComplete)
    });
  }
  await resolveStaleAttentionItems({
    repoId: input.repoId,
    activeDedupeKeys: activeAttentionDedupeKeys,
    managedRuleKeys: pullRequestAttentionRuleKeys,
    objectType: "pull_request",
    objectNumber: cachedPr.number
  });
  return cachedPr.number;
}

async function refreshPullRequestInsightFromGitHub(input: {
  repoId: number;
  profile: ReturnType<typeof loadRepoProfile>;
  pullNumber: number;
}): Promise<number> {
  const result = await fetchPullRequestInsightForNumber({
    profile: input.profile,
    pullNumber: input.pullNumber
  });
  const rawPullRequest = recordPayload(result.pullRequest);
  if (!rawPullRequest) {
    throw new Error(
      `Cannot refresh PR #${input.pullNumber} insight from GitHub: ${
        result.insight.detailError ?? "pull request detail unavailable"
      }`
    );
  }
  return upsertPullRequestFromWebhook({
    repoId: input.repoId,
    profile: input.profile,
    rawPullRequest,
    insight: result.insight
  });
}

export async function processWebhookPayload(input: {
  repoId: number;
  profile: ReturnType<typeof loadRepoProfile>;
  eventName: string;
  payload: Record<string, unknown>;
}): Promise<{ processed: boolean; skipped: boolean; message: string }> {
  if (!isSupportedGitHubWebhookEvent(input.eventName)) {
    return { processed: true, skipped: true, message: `unsupported event ${input.eventName}` };
  }

  if (input.eventName === "issues") {
    const rawIssue = recordPayload(input.payload.issue);
    if (!rawIssue) {
      return { processed: true, skipped: true, message: "issues payload missing issue object" };
    }
    const issue = normalizeIssue(input.profile, ensureGitHubObjectWithNumber(rawIssue, "issue"), cacheSourceForWebhook());
    if (issue.isPullRequest) {
      return { processed: true, skipped: true, message: `issue #${issue.number} is a pull request shadow issue` };
    }
    await upsertIssue(input.repoId, issue);
    const activeAttentionDedupeKeys = new Set<string>();
    for (const flag of criticalAttentionForIssue(input.profile, issue)) {
      const dedupeKey = issueAttentionDedupeKey(input.profile.key, issue.number, flag);
      activeAttentionDedupeKeys.add(dedupeKey);
      await upsertAttentionItem({
        repoId: input.repoId,
        objectType: "issue",
        objectNumber: issue.number,
        ruleKey: flag,
        severity: "critical",
        relatedLogin: issue.ownerLogin,
        targetRecipient: issue.ownerLogin,
        dedupeKey,
        evidenceSummary: `Critical issue #${issue.number} has no recent human action.`
      });
    }
    await resolveStaleAttentionItems({
      repoId: input.repoId,
      activeDedupeKeys: activeAttentionDedupeKeys,
      managedRuleKeys: issueAttentionRuleKeys,
      objectType: "issue",
      objectNumber: issue.number
    });
    await recomputeWorkflowViolationsFromCache();
    await recomputeAiDriftFromCache();
    return { processed: true, skipped: false, message: `updated issue #${issue.number}` };
  }

  if (input.eventName === "pull_request") {
    const rawPullRequest = recordPayload(input.payload.pull_request);
    if (!rawPullRequest) {
      return { processed: true, skipped: true, message: "pull_request payload missing pull_request object" };
    }
    const prNumber = await upsertPullRequestFromWebhook({
      repoId: input.repoId,
      profile: input.profile,
      rawPullRequest
    });
    return { processed: true, skipped: false, message: `updated PR #${prNumber}` };
  }

  if (input.eventName === "pull_request_review") {
    const rawPullRequest = recordPayload(input.payload.pull_request);
    if (!rawPullRequest) {
      return { processed: true, skipped: true, message: "pull_request_review payload missing pull_request object" };
    }
    const pullRequest = ensureGitHubObjectWithNumber(rawPullRequest, "pull_request");
    const prNumber = await refreshPullRequestInsightFromGitHub({
      repoId: input.repoId,
      profile: input.profile,
      pullNumber: pullRequest.number
    });
    return { processed: true, skipped: false, message: `updated PR #${prNumber} review insight` };
  }

  if (input.eventName === "workflow_run" || input.eventName === "check_run") {
    const pullNumbers = pullRequestNumbersFromCiPayload(input.payload, input.eventName);
    if (pullNumbers.length === 0) {
      return { processed: true, skipped: true, message: `${input.eventName} payload has no pull request numbers` };
    }
    const refreshedNumbers: number[] = [];
    for (const pullNumber of pullNumbers) {
      const refreshedNumber = await refreshPullRequestInsightFromGitHub({
        repoId: input.repoId,
        profile: input.profile,
        pullNumber
      });
      refreshedNumbers.push(refreshedNumber);
    }
    return {
      processed: true,
      skipped: false,
      message: `updated PR CI insight for #${refreshedNumbers.join(", #")}`
    };
  }

  const exhaustiveEvent: never = input.eventName;
  throw new Error(`Unhandled supported webhook event ${exhaustiveEvent}`);
}

export async function processGitHubWebhookDeliveriesOnce(): Promise<WebhookDeliverySyncResult> {
  loadEnv();
  const profile = loadRepoProfile();
  const repoId = await upsertRepoProfile(profile);
  const startedAt = new Date().toISOString();
  const summary: WebhookDeliverySyncResult = {
    repoId,
    claimed: 0,
    processed: 0,
    failed: 0,
    skipped: 0
  };
  const limit = webhookLimitFromEnv();

  for (let index = 0; index < limit; index += 1) {
    const processingOwner = webhookWorkerId();
    const delivery = await claimNextGitHubWebhookDelivery({
      repoId,
      processingOwner,
      leaseSeconds: webhookLeaseSecondsFromEnv()
    });
    if (!delivery) {
      break;
    }

    summary.claimed += 1;
    try {
      const result = await processWebhookPayload({
        repoId,
        profile,
        eventName: delivery.eventName,
        payload: delivery.payload
      });
      await completeGitHubWebhookDelivery({
        deliveryId: delivery.id,
        processingOwner,
        result: {
          deliveryId: delivery.deliveryId,
          eventName: delivery.eventName,
          action: delivery.action,
          message: result.message,
          skipped: result.skipped
        }
      });
      summary.processed += result.processed ? 1 : 0;
      summary.skipped += result.skipped ? 1 : 0;
    } catch (error) {
      await failGitHubWebhookDelivery({
        deliveryId: delivery.id,
        processingOwner,
        errorMessage: error instanceof Error ? error.message : String(error)
      });
      summary.failed += 1;
    }
  }

  await recordSyncRun({
    repoId,
    syncLayer: "webhooks",
    status: summary.failed > 0 ? "partial" : "success",
    sourceAuthType: "cache",
    startedAt,
    finishedAt: new Date().toISOString(),
    raw: summary
  });
  return summary;
}

export async function syncGitHubSnapshotOnce(): Promise<SyncResult> {
  loadEnv();
  const profile = loadRepoProfile();
  const startedAt = new Date().toISOString();
  const repoId = await upsertRepoProfile(profile);

  try {
    const snapshot = await fetchGitHubSnapshot(profile);
    const linkedPrAuthorByIssueNumber = linkedPrAuthorsByIssueNumber(snapshot.pullRequests);
    let issueCount = 0;
    let prCount = 0;
    const workflowViolations: WorkflowViolation[] = [];
    const aiDriftSignals: AiDriftSignal[] = [];
    const activeAttentionDedupeKeys = new Set<string>();
    let resolvedAttentionItems = 0;

    for (const rawIssue of snapshot.issues) {
      const issue = normalizeIssue(
        profile,
        rawIssue,
        { authType: snapshot.sourceAuthType, userId: null },
        { linkedPrAuthorByIssueNumber }
      );
      if (!shouldKeepIssue(issue)) {
        continue;
      }
      const commentResult = snapshot.issueComments.get(issue.number);
      const comments = commentResult
        ? commentResult.comments.map((comment) =>
            normalizeIssueComment(profile, issue.number, comment, {
              authType: snapshot.sourceAuthType,
              userId: null
            })
          )
        : [];
      const issueWithComments = commentResult
        ? {
            ...issue,
            commentEvidence: {
              isComplete: commentResult.isComplete,
              lastSyncedAt: commentResult.syncedAt,
              syncError: commentResult.syncError,
              comments
            }
          }
        : issue;
      await upsertIssue(repoId, issue);
      if (commentResult) {
        await replaceIssueComments({
          repoId,
          issueNumber: issue.number,
          comments,
          sourceAuthType: snapshot.sourceAuthType,
          sourceUserId: null,
          visibilityClass: issue.visibilityClass,
          isComplete: commentResult.isComplete,
          syncError: commentResult.syncError,
          raw: {
            issueNumber: issue.number,
            comments: comments.length,
            isComplete: commentResult.isComplete,
            syncError: commentResult.syncError
          },
          syncedAt: commentResult.syncedAt
        });
      }
      issueCount += 1;
      workflowViolations.push(...workflowViolationsForIssue(profile, issueWithComments));
      aiDriftSignals.push(...aiDriftSignalsForIssue(profile, issueWithComments));

      const issueActiveAttentionDedupeKeys = new Set<string>();
      for (const flag of criticalAttentionForIssue(profile, issueWithComments)) {
        const dedupeKey = issueAttentionDedupeKey(profile.key, issue.number, flag);
        activeAttentionDedupeKeys.add(dedupeKey);
        issueActiveAttentionDedupeKeys.add(dedupeKey);
        await upsertAttentionItem({
          repoId,
          objectType: "issue",
          objectNumber: issue.number,
          ruleKey: flag,
          severity: "critical",
          relatedLogin: issue.ownerLogin,
          targetRecipient: issue.ownerLogin,
          dedupeKey,
          evidenceSummary: `Critical issue #${issue.number} has no recent human action.`
        });
      }
      resolvedAttentionItems += await resolveStaleAttentionItems({
        repoId,
        activeDedupeKeys: issueActiveAttentionDedupeKeys,
        managedRuleKeys: issueAttentionRuleKeys,
        objectType: "issue",
        objectNumber: issue.number
      });
    }
    await replaceWorkflowViolations(repoId, workflowViolations);
    await replaceAiDriftSignals(repoId, aiDriftSignals);

    for (const rawPr of snapshot.pullRequests) {
      const commentResult = snapshot.issueComments.get(rawPr.number);
      const comments = commentResult
        ? commentResult.comments.map((comment) =>
            normalizeIssueComment(profile, rawPr.number, comment, {
              authType: snapshot.sourceAuthType,
              userId: null
            })
          )
        : [];
      const pr = normalizePullRequest(
        profile,
        rawPr,
        { authType: snapshot.sourceAuthType, userId: null },
        snapshot.pullRequestInsights.get(rawPr.number),
        commentResult
          ? {
              isComplete: commentResult.isComplete,
              lastSyncedAt: commentResult.syncedAt,
              syncError: commentResult.syncError,
              comments
            }
          : undefined
      );
      if (commentResult) {
        await replaceIssueComments({
          repoId,
          issueNumber: rawPr.number,
          comments,
          sourceAuthType: snapshot.sourceAuthType,
          sourceUserId: null,
          visibilityClass: pr.visibilityClass,
          isComplete: commentResult.isComplete,
          syncError: commentResult.syncError,
          raw: {
            issueNumber: rawPr.number,
            comments: comments.length,
            isComplete: commentResult.isComplete,
            syncError: commentResult.syncError,
            objectType: "pull_request"
          },
          syncedAt: commentResult.syncedAt
        });
      }
      const cachedPr = await upsertPullRequest(repoId, pr);
      prCount += 1;
      const prActiveAttentionDedupeKeys = new Set<string>();
      for (const flag of cachedPr.attentionFlags) {
        const dedupeKey = pullRequestAttentionDedupeKey(profile.key, cachedPr.number, flag);
        activeAttentionDedupeKeys.add(dedupeKey);
        prActiveAttentionDedupeKeys.add(dedupeKey);
        await upsertAttentionItem({
          repoId,
          objectType: "pull_request",
          objectNumber: cachedPr.number,
          ruleKey: flag,
          severity: "warning",
          relatedLogin: cachedPr.ownerLogin,
          targetRecipient: cachedPr.ownerLogin,
          dedupeKey,
          evidenceSummary: prEvidence(flag, cachedPr.number, cachedPr.isComplete)
        });
      }
      resolvedAttentionItems += await resolveStaleAttentionItems({
        repoId,
        activeDedupeKeys: prActiveAttentionDedupeKeys,
        managedRuleKeys: pullRequestAttentionRuleKeys,
        objectType: "pull_request",
        objectNumber: cachedPr.number
      });
    }
    const snapshotComplete = snapshot.issuesComplete && snapshot.openPullRequestsComplete;
    if (snapshotComplete) {
      resolvedAttentionItems += await resolveStaleAttentionItems({
        repoId,
        activeDedupeKeys: activeAttentionDedupeKeys,
        managedRuleKeys: snapshotManagedAttentionRuleKeys
      });
    }

    await recordSyncRun({
      repoId,
      syncLayer: "github_sync",
      status: "success",
      sourceAuthType: snapshot.sourceAuthType,
      startedAt,
      finishedAt: new Date().toISOString(),
      rateLimitRemaining: snapshot.rateLimitRemaining,
      raw: {
        issues: issueCount,
        pullRequests: prCount,
        pullRequestInsights: snapshot.pullRequestInsights.size,
        issueCommentBackfills: snapshot.issueComments.size,
        workflowViolations: workflowViolations.length,
        aiDriftSignals: aiDriftSignals.length,
        resolvedAttentionItems,
        attentionResolutionScope: snapshotComplete ? "repo" : "observed_objects",
        issuesComplete: snapshot.issuesComplete,
        openPullRequestsComplete: snapshot.openPullRequestsComplete
      }
    });

    return {
      repoId,
      issues: issueCount,
      pullRequests: prCount,
      rateLimitRemaining: snapshot.rateLimitRemaining
    };
  } catch (error) {
    const classified = classifyGitHubError(error);
    await recordSyncRun({
      repoId,
      syncLayer: "github_sync",
      status: classified.kind === "permission" || classified.kind === "not_found" ? "blocked" : "failed",
      sourceAuthType: configuredGitHubSourceAuthType(),
      startedAt,
      finishedAt: new Date().toISOString(),
      errorMessage: classified.message,
      rateLimitRemaining: classified.rateLimitRemaining,
      raw: {
        errorKind: classified.kind,
        retriable: classified.retriable,
        status: classified.status,
        rateLimitRemaining: classified.rateLimitRemaining,
        rateLimitResetAt: classified.rateLimitResetAt,
        retryAfterSeconds: classified.retryAfterSeconds
      }
    });
    throw error;
  }
}

export async function syncOnce(): Promise<SyncResult | null> {
  loadEnv();
  const profile = loadRepoProfile();

  return runWithJobLease(
    `github-sync:${profile.key}`,
    "github_sync",
    () => syncGitHubSnapshotOnce(),
    {
      leaseSeconds: 600,
      nextRunAt: dateAfterSeconds(syncIntervalSecondsFromEnv())
    }
  );
}
