import { loadEnv, loadRepoProfile } from "@mo-devflow/config";
import {
  issueAttentionRuleKeys,
  listIssueCommentBackfillCandidates,
  listIssueTimelineBackfillCandidates,
  listCachedIssuesForRules,
  listCachedPullRequestsForRules,
  listNotificationCandidates,
  listPullRequestNumbersForDetailBackfill,
  isNotificationInCooldown,
  notificationDeliveryCooldownHoursForDedupe,
  notificationDeliveryCooldownStatuses,
  notificationDashboardBaseUrlFromEnv,
  notificationDashboardUrl,
  pullRequestAttentionRuleKeys,
  claimNextGitHubWebhookDelivery,
  completeGitHubWebhookDelivery,
  failGitHubWebhookDelivery,
  recordSyncRun,
  recordNotificationDelivery,
  recomputeDailyMetricsFromCache,
  replaceIssueComments,
  replaceIssueTimelineEvents,
  replaceAiDriftSignals,
  replaceWorkflowViolations,
  resolveStaleAttentionItems,
  runWithJobLease,
  snapshotManagedAttentionRuleKeys,
  upsertAttentionItem,
  upsertIssue,
  upsertIssueTimelineEvent,
  upsertPullRequest,
  upsertRepoProfile
} from "@mo-devflow/db";
import {
  classifyGitHubError,
  configuredGitHubSourceAuthType,
  fetchGitHubSnapshot,
  fetchIssueCommentsForNumber,
  fetchIssueEventsForNumber,
  fetchPullRequestInsightForNumber
} from "@mo-devflow/github";
import { buildWeComMarkdown, classifyWeComFailure, isInQuietHours, sendWeComMarkdown } from "@mo-devflow/notifications";
import {
  aiDriftSignalsForPullRequest,
  aiDriftSignalsForIssue,
  criticalAttentionForIssue,
  issueLastHumanActionAt,
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
  type IssueCommentEvidence,
  type NormalizedIssue,
  type NormalizedIssueTimelineEvent,
  type NotificationCandidate,
  type NotificationStatus,
  type PullRequestInsight,
  type SourceAuthType,
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

export interface PullRequestDetailBackfillResult {
  repoId: number;
  selected: number;
  refreshed: number;
  failed: number;
  skipped: boolean;
  sourceAuthType: ReturnType<typeof configuredGitHubSourceAuthType>;
  rateLimitRemaining: number | null;
}

export interface IssueCommentBackfillResult {
  repoId: number;
  selected: number;
  refreshed: number;
  complete: number;
  partial: number;
  failed: number;
  skipped: boolean;
  sourceAuthType: SourceAuthType;
  rateLimitRemaining: number | null;
  workflowViolations: number | null;
}

export interface IssueTimelineBackfillResult {
  repoId: number;
  selected: number;
  refreshed: number;
  complete: number;
  partial: number;
  failed: number;
  skipped: boolean;
  sourceAuthType: SourceAuthType;
  rateLimitRemaining: number | null;
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

export function metricsRetentionDaysFromEnv(env: Record<string, string | undefined> = process.env): number {
  const parsed = Number(env.MO_DEVFLOW_METRICS_RETENTION_DAYS ?? "120");
  if (!Number.isFinite(parsed)) {
    return 120;
  }
  return Math.max(31, Math.floor(parsed));
}

export function prDetailBackfillLimitFromEnv(
  env: Record<string, string | undefined> = process.env,
  sourceAuthType: ReturnType<typeof configuredGitHubSourceAuthType> = configuredGitHubSourceAuthType(env)
): number {
  const fallback = sourceAuthType === "anonymous" ? 0 : 25;
  const configured = env.MO_DEVFLOW_PR_BACKFILL_MAX_ITEMS;
  if (configured === undefined) {
    return fallback;
  }
  const parsed = Number(configured);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(0, Math.floor(parsed));
}

export function commentBackfillLimitFromEnv(
  env: Record<string, string | undefined> = process.env,
  sourceAuthType: SourceAuthType = configuredGitHubSourceAuthType(env)
): number {
  const fallback = sourceAuthType === "anonymous" ? 0 : 25;
  const configured = env.MO_DEVFLOW_COMMENT_BACKFILL_MAX_ITEMS;
  if (configured === undefined) {
    return fallback;
  }
  const parsed = Number(configured);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(0, Math.floor(parsed));
}

export function issueTimelineBackfillLimitFromEnv(
  env: Record<string, string | undefined> = process.env,
  sourceAuthType: SourceAuthType = configuredGitHubSourceAuthType(env)
): number {
  const fallback = sourceAuthType === "anonymous" ? 0 : 25;
  const configured = env.MO_DEVFLOW_ISSUE_TIMELINE_BACKFILL_MAX_ITEMS;
  if (configured === undefined) {
    return fallback;
  }
  const parsed = Number(configured);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(0, Math.floor(parsed));
}

export function dateAfterSeconds(seconds: number): string {
  return new Date(Date.now() + seconds * 1000).toISOString();
}

export function notificationFailureStatus(error: unknown): NotificationStatus {
  return classifyWeComFailure(error) === "permanent" ? "failed_permanent" : "failed_transient";
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

export function issueEvidence(flag: string, issue: NormalizedIssue): string {
  if (flag === "critical_no_human_action") {
    const source = issue.commentEvidence?.isComplete
      ? "complete cached issue comments"
      : "partial cached issue update time until issue comments are backfilled";
    return `Active s-1/s0 issue #${issue.number} has no recent human action since ${issueLastHumanActionAt(
      issue
    )}. Evidence uses ${source}.`;
  }
  return `Issue #${issue.number} needs attention: ${flag}.`;
}

function notificationLimitFromEnv(): number {
  const parsed = Number(process.env.MO_DEVFLOW_NOTIFICATION_LIMIT ?? "20");
  if (!Number.isFinite(parsed)) {
    return 20;
  }
  return Math.max(1, Math.floor(parsed));
}

function notificationCooldownHours(candidate: NotificationCandidate, defaultCooldownHours: number): number {
  if (
    candidate.sourceType === "daily_digest" ||
    candidate.sourceType === "weekly_digest" ||
    candidate.sourceType === "monthly_digest"
  ) {
    return 24 * 365 * 10;
  }
  return defaultCooldownHours;
}

function attentionDashboardUrl(objectType: "issue" | "pull_request"): string {
  return notificationDashboardUrl(notificationDashboardBaseUrlFromEnv(), "attention_item", objectType);
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

export class WebhookNormalizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebhookNormalizationError";
  }
}

function recordPayload(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function normalizeIssueTimelineEvent(
  issueNumber: number,
  event: unknown,
  source: CacheSource,
  visibilityClass: NormalizedIssue["visibilityClass"]
): NormalizedIssueTimelineEvent | null {
  const payload = recordPayload(event);
  if (!payload) {
    return null;
  }
  const eventType = typeof payload.event === "string" ? payload.event : "";
  if (eventType !== "labeled" && eventType !== "unlabeled") {
    return null;
  }
  const label = recordPayload(payload.label);
  const actor = recordPayload(payload.actor);
  const occurredAt = typeof payload.created_at === "string" ? payload.created_at : null;
  if (!occurredAt) {
    return null;
  }
  return {
    githubId: String(payload.id ?? `${issueNumber}:${eventType}:${occurredAt}:${label?.name ?? ""}`),
    issueNumber,
    eventType,
    labelName: typeof label?.name === "string" ? label.name : null,
    actorLogin: typeof actor?.login === "string" ? actor.login : null,
    occurredAt,
    sourceAuthType: source.authType,
    sourceUserId: source.userId,
    visibilityClass,
    rawPayload: payload
  };
}

function pullRequestNumbersFromArray(value: unknown): number[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return Array.from(
    new Set(
      value.map((item) => recordPayload(item)?.number).filter((number): number is number => typeof number === "number")
    )
  );
}

function pullRequestNumbersFromCiPayload(
  payload: Record<string, unknown>,
  eventName: "workflow_run" | "check_run"
): number[] {
  const source = eventName === "workflow_run" ? recordPayload(payload.workflow_run) : recordPayload(payload.check_run);
  return pullRequestNumbersFromArray(source?.pull_requests);
}

function ensureGitHubObjectWithNumber(
  input: Record<string, unknown>,
  label: string
): Record<string, unknown> & { id: number; number: number } {
  if (typeof input.id !== "number" || typeof input.number !== "number") {
    throw new Error(`${label} payload must include numeric id and number.`);
  }
  return input as Record<string, unknown> & { id: number; number: number };
}

function cacheSourceForWebhook(): CacheSource {
  return { authType: "service_read_token", userId: null };
}

function hasTestingCommentHandoffSignals(profile: ReturnType<typeof loadRepoProfile>): boolean {
  return profile.testing.handoffSignals.comments.some((signal) => signal.trim().length > 0);
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
  const retentionDays = metricsRetentionDaysFromEnv();
  const dailyMetrics = await recomputeDailyMetricsFromCache(repoId, profile, retentionDays);
  await recordSyncRun({
    repoId,
    syncLayer: "metrics",
    status: "success",
    sourceAuthType: "cache",
    startedAt,
    finishedAt: new Date().toISOString(),
    raw: { dailyMetrics, retentionDays }
  });
  return { repoId, dailyMetrics };
}

export async function recomputeAiDriftFromCache(): Promise<DriftSyncResult> {
  loadEnv();
  const profile = loadRepoProfile();
  const startedAt = new Date().toISOString();
  const repoId = await upsertRepoProfile(profile);
  const issues = await listCachedIssuesForRules(repoId);
  const pullRequests = await listCachedPullRequestsForRules(repoId);
  const aiDriftSignals = [
    ...issues.flatMap((issue) => aiDriftSignalsForIssue(profile, issue)),
    ...pullRequests.flatMap((pr) => aiDriftSignalsForPullRequest(profile, pr))
  ];
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

  for (const candidate of candidates) {
    const cooldownHours = notificationCooldownHours(candidate, profile.notifications.routing.cooldownHours);
    const payload = {
      markdown: buildWeComMarkdown(profile, candidate),
      candidate
    };

    if (!profile.notifications.wecom.enabled) {
      if (await isNotificationInCooldown(candidate.dedupeKey, cooldownHours, ["skipped_disabled"])) {
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
      if (await isNotificationInCooldown(candidate.dedupeKey, cooldownHours, ["skipped_no_webhook"])) {
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

    if (
      candidate.severity !== "critical" &&
      isInQuietHours(profile.notifications.wecom.quietHours, profile.reporting.timezone)
    ) {
      if (await isNotificationInCooldown(candidate.dedupeKey, cooldownHours, ["skipped_quiet_hours"])) {
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

    const deliveryCooldownHours = await notificationDeliveryCooldownHoursForDedupe(candidate.dedupeKey, cooldownHours);
    if (
      deliveryCooldownHours !== null &&
      (await isNotificationInCooldown(candidate.dedupeKey, deliveryCooldownHours, notificationDeliveryCooldownStatuses))
    ) {
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
        status: notificationFailureStatus(error),
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
  commentEvidence?: IssueCommentEvidence;
}): Promise<number> {
  const pr = normalizePullRequest(
    input.profile,
    ensureGitHubObjectWithNumber(input.rawPullRequest, "pull_request"),
    cacheSourceForWebhook(),
    input.insight,
    input.commentEvidence
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
      evidenceSummary: prEvidence(flag, cachedPr.number, cachedPr.isComplete),
      dashboardUrl: attentionDashboardUrl("pull_request")
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

async function refreshIssueCommentsForWebhook(input: {
  repoId: number;
  profile: ReturnType<typeof loadRepoProfile>;
  issueNumber: number;
  objectType: "issue" | "pull_request";
  visibilityClass: NormalizedIssue["visibilityClass"];
}): Promise<IssueCommentEvidence> {
  const result = await fetchIssueCommentsForNumber({
    profile: input.profile,
    issueNumber: input.issueNumber
  });
  const comments = result.comments.map((comment) =>
    normalizeIssueComment(input.profile, input.issueNumber, comment, {
      authType: result.sourceAuthType,
      userId: null
    })
  );
  await replaceIssueComments({
    repoId: input.repoId,
    issueNumber: input.issueNumber,
    comments,
    sourceAuthType: result.sourceAuthType,
    sourceUserId: null,
    visibilityClass: input.visibilityClass,
    isComplete: result.isComplete,
    syncError: result.syncError,
    raw: {
      issueNumber: input.issueNumber,
      objectType: input.objectType,
      trigger: "issue_comment_webhook",
      comments: comments.length,
      isComplete: result.isComplete,
      syncError: result.syncError
    },
    syncedAt: result.syncedAt
  });

  return {
    isComplete: result.isComplete,
    lastSyncedAt: result.syncedAt,
    syncError: result.syncError,
    comments: comments.map((comment) => ({
      authorLogin: comment.authorLogin,
      body: comment.body,
      createdAt: comment.createdAt,
      updatedAt: comment.updatedAt
    }))
  };
}

async function refreshPullRequestInsightFromGitHub(input: {
  repoId: number;
  profile: ReturnType<typeof loadRepoProfile>;
  pullNumber: number;
  commentEvidence?: IssueCommentEvidence;
}): Promise<{
  prNumber: number;
  rateLimitRemaining: number | null;
  sourceAuthType: ReturnType<typeof configuredGitHubSourceAuthType>;
}> {
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
  const prNumber = await upsertPullRequestFromWebhook({
    repoId: input.repoId,
    profile: input.profile,
    rawPullRequest,
    insight: result.insight,
    commentEvidence: input.commentEvidence
  });
  return {
    prNumber,
    rateLimitRemaining: result.rateLimitRemaining,
    sourceAuthType: result.sourceAuthType
  };
}

export async function backfillPullRequestDetailsOnce(): Promise<PullRequestDetailBackfillResult> {
  loadEnv();
  const profile = loadRepoProfile();
  const startedAt = new Date().toISOString();
  const repoId = await upsertRepoProfile(profile);
  const sourceAuthType = configuredGitHubSourceAuthType();
  const limit = prDetailBackfillLimitFromEnv(process.env, sourceAuthType);
  const summary: PullRequestDetailBackfillResult = {
    repoId,
    selected: 0,
    refreshed: 0,
    failed: 0,
    skipped: limit === 0,
    sourceAuthType,
    rateLimitRemaining: null
  };

  if (limit === 0) {
    await recordSyncRun({
      repoId,
      syncLayer: "pr_backfill",
      status: "success",
      sourceAuthType,
      startedAt,
      finishedAt: new Date().toISOString(),
      raw: {
        ...summary,
        reason: "MO_DEVFLOW_PR_BACKFILL_MAX_ITEMS is 0 for the current GitHub auth source."
      }
    });
    return summary;
  }

  const pullNumbers = await listPullRequestNumbersForDetailBackfill(repoId, limit);
  summary.selected = pullNumbers.length;
  let latestError: string | null = null;
  let blocked = false;

  for (const pullNumber of pullNumbers) {
    try {
      const result = await refreshPullRequestInsightFromGitHub({ repoId, profile, pullNumber });
      summary.refreshed += 1;
      summary.rateLimitRemaining = result.rateLimitRemaining ?? summary.rateLimitRemaining;
    } catch (error) {
      summary.failed += 1;
      const classified = classifyGitHubError(error);
      latestError = classified.message;
      if (classified.kind === "permission" || classified.kind === "not_found") {
        blocked = true;
        break;
      }
      if (classified.kind === "rate_limited") {
        break;
      }
    }
  }

  await recordSyncRun({
    repoId,
    syncLayer: "pr_backfill",
    status: blocked ? "blocked" : summary.failed > 0 ? "partial" : "success",
    sourceAuthType,
    startedAt,
    finishedAt: new Date().toISOString(),
    errorMessage: latestError,
    rateLimitRemaining: summary.rateLimitRemaining,
    raw: summary
  });

  return summary;
}

export async function backfillIssueCommentsOnce(): Promise<IssueCommentBackfillResult> {
  loadEnv();
  const profile = loadRepoProfile();
  const startedAt = new Date().toISOString();
  const repoId = await upsertRepoProfile(profile);
  const sourceAuthType = configuredGitHubSourceAuthType();
  const limit = commentBackfillLimitFromEnv(process.env, sourceAuthType);
  const summary: IssueCommentBackfillResult = {
    repoId,
    selected: 0,
    refreshed: 0,
    complete: 0,
    partial: 0,
    failed: 0,
    skipped: limit === 0,
    sourceAuthType,
    rateLimitRemaining: null,
    workflowViolations: null
  };

  if (limit === 0) {
    await recordSyncRun({
      repoId,
      syncLayer: "comment_backfill",
      status: "success",
      sourceAuthType,
      startedAt,
      finishedAt: new Date().toISOString(),
      raw: {
        ...summary,
        reason: "MO_DEVFLOW_COMMENT_BACKFILL_MAX_ITEMS is 0 for the current GitHub auth source."
      }
    });
    return summary;
  }

  const candidates = await listIssueCommentBackfillCandidates(repoId, {
    criticalLabels: profile.labels.critical,
    includePullRequests: hasTestingCommentHandoffSignals(profile),
    limit
  });
  summary.selected = candidates.length;
  let latestError: string | null = null;
  let blocked = false;

  for (const candidate of candidates) {
    try {
      const result = await fetchIssueCommentsForNumber({
        profile,
        issueNumber: candidate.issueNumber
      });
      const comments = result.comments.map((comment) =>
        normalizeIssueComment(profile, candidate.issueNumber, comment, {
          authType: result.sourceAuthType,
          userId: null
        })
      );
      await replaceIssueComments({
        repoId,
        issueNumber: candidate.issueNumber,
        comments,
        sourceAuthType: result.sourceAuthType,
        sourceUserId: null,
        visibilityClass: candidate.visibilityClass,
        isComplete: result.isComplete,
        syncError: result.syncError,
        raw: {
          issueNumber: candidate.issueNumber,
          objectType: candidate.objectType,
          comments: comments.length,
          isComplete: result.isComplete,
          syncError: result.syncError
        },
        syncedAt: result.syncedAt
      });
      summary.refreshed += 1;
      summary.rateLimitRemaining = result.rateLimitRemaining ?? summary.rateLimitRemaining;
      if (result.isComplete) {
        summary.complete += 1;
      } else {
        summary.partial += 1;
        latestError = result.syncError ?? latestError;
        if (result.syncError && comments.length === 0) {
          summary.failed += 1;
        }
      }
      if (
        result.sourceAuthType === "anonymous" &&
        summary.rateLimitRemaining !== null &&
        summary.rateLimitRemaining < 8
      ) {
        break;
      }
    } catch (error) {
      summary.failed += 1;
      const classified = classifyGitHubError(error);
      latestError = classified.message;
      if (classified.kind === "permission" || classified.kind === "not_found") {
        blocked = true;
        break;
      }
      if (classified.kind === "rate_limited") {
        summary.rateLimitRemaining = classified.rateLimitRemaining ?? summary.rateLimitRemaining;
        break;
      }
    }
  }

  await recordSyncRun({
    repoId,
    syncLayer: "comment_backfill",
    status: blocked ? "blocked" : summary.failed > 0 || summary.partial > 0 ? "partial" : "success",
    sourceAuthType,
    startedAt,
    finishedAt: new Date().toISOString(),
    errorMessage: latestError,
    rateLimitRemaining: summary.rateLimitRemaining,
    raw: summary
  });

  if (summary.refreshed > 0) {
    const rules = await recomputeWorkflowViolationsFromCache();
    summary.workflowViolations = rules.workflowViolations;
  }

  return summary;
}

export async function backfillIssueTimelineOnce(): Promise<IssueTimelineBackfillResult> {
  loadEnv();
  const profile = loadRepoProfile();
  const startedAt = new Date().toISOString();
  const repoId = await upsertRepoProfile(profile);
  const sourceAuthType = configuredGitHubSourceAuthType();
  const limit = issueTimelineBackfillLimitFromEnv(process.env, sourceAuthType);
  const summary: IssueTimelineBackfillResult = {
    repoId,
    selected: 0,
    refreshed: 0,
    complete: 0,
    partial: 0,
    failed: 0,
    skipped: limit === 0,
    sourceAuthType,
    rateLimitRemaining: null
  };

  if (limit === 0) {
    await recordSyncRun({
      repoId,
      syncLayer: "issue_timeline_backfill",
      status: "success",
      sourceAuthType,
      startedAt,
      finishedAt: new Date().toISOString(),
      raw: {
        ...summary,
        reason: "MO_DEVFLOW_ISSUE_TIMELINE_BACKFILL_MAX_ITEMS is 0 for the current GitHub auth source."
      }
    });
    return summary;
  }

  const candidates = await listIssueTimelineBackfillCandidates(repoId, {
    criticalLabels: profile.labels.critical,
    limit
  });
  summary.selected = candidates.length;
  let latestError: string | null = null;
  let blocked = false;

  for (const candidate of candidates) {
    try {
      const result = await fetchIssueEventsForNumber({
        profile,
        issueNumber: candidate.issueNumber
      });
      const events = result.events
        .map((event) =>
          normalizeIssueTimelineEvent(
            candidate.issueNumber,
            event,
            { authType: result.sourceAuthType, userId: null },
            candidate.visibilityClass
          )
        )
        .filter((event): event is NormalizedIssueTimelineEvent => event !== null);
      await replaceIssueTimelineEvents({
        repoId,
        issueNumber: candidate.issueNumber,
        events,
        sourceAuthType: result.sourceAuthType,
        sourceUserId: null,
        visibilityClass: candidate.visibilityClass,
        isComplete: result.isComplete,
        syncError: result.syncError,
        raw: {
          issueNumber: candidate.issueNumber,
          events: events.length,
          isComplete: result.isComplete,
          syncError: result.syncError
        },
        syncedAt: result.syncedAt
      });
      summary.refreshed += 1;
      summary.rateLimitRemaining = result.rateLimitRemaining ?? summary.rateLimitRemaining;
      if (result.isComplete) {
        summary.complete += 1;
      } else {
        summary.partial += 1;
        latestError = result.syncError ?? latestError;
        if (result.syncError && events.length === 0) {
          summary.failed += 1;
        }
      }
      if (
        result.sourceAuthType === "anonymous" &&
        summary.rateLimitRemaining !== null &&
        summary.rateLimitRemaining < 8
      ) {
        break;
      }
    } catch (error) {
      summary.failed += 1;
      const classified = classifyGitHubError(error);
      latestError = classified.message;
      if (classified.kind === "permission" || classified.kind === "not_found") {
        blocked = true;
        break;
      }
      if (classified.kind === "rate_limited") {
        summary.rateLimitRemaining = classified.rateLimitRemaining ?? summary.rateLimitRemaining;
        break;
      }
    }
  }

  await recordSyncRun({
    repoId,
    syncLayer: "issue_timeline_backfill",
    status: blocked ? "blocked" : summary.failed > 0 || summary.partial > 0 ? "partial" : "success",
    sourceAuthType,
    startedAt,
    finishedAt: new Date().toISOString(),
    errorMessage: latestError,
    rateLimitRemaining: summary.rateLimitRemaining,
    raw: summary
  });

  return summary;
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
      throw new WebhookNormalizationError("issues payload missing issue object");
    }
    const issue = normalizeIssue(
      input.profile,
      ensureGitHubObjectWithNumber(rawIssue, "issue"),
      cacheSourceForWebhook()
    );
    if (issue.isPullRequest) {
      return { processed: true, skipped: true, message: `issue #${issue.number} is a pull request shadow issue` };
    }
    await upsertIssue(input.repoId, issue);
    const action = typeof input.payload.action === "string" ? input.payload.action : "";
    if (action === "labeled" || action === "unlabeled") {
      const timelineEvent = normalizeIssueTimelineEvent(
        issue.number,
        {
          id: input.payload.delivery_id,
          event: action,
          label: input.payload.label,
          actor: input.payload.sender,
          created_at: issue.updatedAt,
          source: "webhook"
        },
        cacheSourceForWebhook(),
        issue.visibilityClass
      );
      if (timelineEvent) {
        await upsertIssueTimelineEvent(input.repoId, timelineEvent);
      }
    }
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
        evidenceSummary: issueEvidence(flag, issue),
        dashboardUrl: attentionDashboardUrl("issue")
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

  if (input.eventName === "issue_comment") {
    const rawIssue = recordPayload(input.payload.issue);
    if (!rawIssue) {
      throw new WebhookNormalizationError("issue_comment payload missing issue object");
    }
    const issue = normalizeIssue(
      input.profile,
      ensureGitHubObjectWithNumber(rawIssue, "issue"),
      cacheSourceForWebhook()
    );
    const commentEvidence = await refreshIssueCommentsForWebhook({
      repoId: input.repoId,
      profile: input.profile,
      issueNumber: issue.number,
      objectType: issue.isPullRequest ? "pull_request" : "issue",
      visibilityClass: issue.visibilityClass
    });

    if (issue.isPullRequest) {
      const refreshed = await refreshPullRequestInsightFromGitHub({
        repoId: input.repoId,
        profile: input.profile,
        pullNumber: issue.number,
        commentEvidence
      });
      return { processed: true, skipped: false, message: `updated PR #${refreshed.prNumber} comments` };
    }

    await upsertIssue(input.repoId, issue);
    const issueWithComments: NormalizedIssue = {
      ...issue,
      commentEvidence
    };
    const activeAttentionDedupeKeys = new Set<string>();
    for (const flag of criticalAttentionForIssue(input.profile, issueWithComments)) {
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
        evidenceSummary: issueEvidence(flag, issueWithComments),
        dashboardUrl: attentionDashboardUrl("issue")
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
    return { processed: true, skipped: false, message: `updated issue #${issue.number} comments` };
  }

  if (input.eventName === "pull_request") {
    const rawPullRequest = recordPayload(input.payload.pull_request);
    if (!rawPullRequest) {
      throw new WebhookNormalizationError("pull_request payload missing pull_request object");
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
      throw new WebhookNormalizationError("pull_request_review payload missing pull_request object");
    }
    const pullRequest = ensureGitHubObjectWithNumber(rawPullRequest, "pull_request");
    const refreshed = await refreshPullRequestInsightFromGitHub({
      repoId: input.repoId,
      profile: input.profile,
      pullNumber: pullRequest.number
    });
    return { processed: true, skipped: false, message: `updated PR #${refreshed.prNumber} review insight` };
  }

  if (input.eventName === "workflow_run" || input.eventName === "check_run") {
    const pullNumbers = pullRequestNumbersFromCiPayload(input.payload, input.eventName);
    if (pullNumbers.length === 0) {
      return { processed: true, skipped: true, message: `${input.eventName} payload has no pull request numbers` };
    }
    const refreshedNumbers: number[] = [];
    for (const pullNumber of pullNumbers) {
      const refreshed = await refreshPullRequestInsightFromGitHub({
        repoId: input.repoId,
        profile: input.profile,
        pullNumber
      });
      refreshedNumbers.push(refreshed.prNumber);
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
        errorMessage: error instanceof Error ? error.message : String(error),
        status: error instanceof WebhookNormalizationError ? "failed_normalization" : "failed"
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
          evidenceSummary: issueEvidence(flag, issueWithComments),
          dashboardUrl: attentionDashboardUrl("issue")
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
      aiDriftSignals.push(...aiDriftSignalsForPullRequest(profile, cachedPr));
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
          evidenceSummary: prEvidence(flag, cachedPr.number, cachedPr.isComplete),
          dashboardUrl: attentionDashboardUrl("pull_request")
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
    await replaceAiDriftSignals(repoId, aiDriftSignals);
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

  return runWithJobLease(`github-sync:${profile.key}`, "github_sync", () => syncGitHubSnapshotOnce(), {
    leaseSeconds: 600,
    nextRunAt: dateAfterSeconds(syncIntervalSecondsFromEnv())
  });
}
