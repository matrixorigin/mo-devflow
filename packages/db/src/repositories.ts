import type {
  AggregatedMetricPoint,
  AiDriftSignal,
  AiDriftSignalView,
  AnalyticsSummary,
  CriticalIssueBlockerView,
  CriticalIssueView,
  CriticalIssueLinkedPullRequestView,
  CriticalIssueOwnerScope,
  DailyMetricPoint,
  DashboardVisibility,
  DashboardSummary,
  NormalizedIssue,
  NormalizedPullRequest,
  PendingPrView,
  PersonalActionView,
  PersonalIssueView,
  PersonalPullRequestView,
  PersonSummary,
  ProfileConfigurationWarning,
  RepoProfile,
  SyncHealth,
  TestingSummary,
  VisibilityClass,
  WorkerHealth,
  WorkflowViolation,
  WorkflowViolationView
} from "@mo-devflow/shared";
import { extractLinkedIssueNumbers, parseJsonArray, parseJsonRecord } from "@mo-devflow/shared";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { fromSqlDate, getPool, nowSql, sqlDate } from "./client";
import { getJobQueueHealth } from "./jobs";
import { getNotificationHealth } from "./notifications";
import { addDaysToDateKey, dateKeyInTimezone, previousCalendarDayRange } from "./time";
import { getWebhookIngestionHealth } from "./webhooks";
import { getWorkerHealth } from "./workerHealth";

export { extractLinkedIssueNumbers } from "@mo-devflow/shared";
export { calendarDayRangeInTimezone, dateKeyInTimezone, previousCalendarDayRange } from "./time";

interface RowData extends RowDataPacket {
  [key: string]: unknown;
}

function stringify(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asNumber(value: unknown): number {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "bigint") {
    return Number(value);
  }
  if (typeof value === "string") {
    return Number(value);
  }
  return 0;
}

function asBoolean(value: unknown): boolean {
  return asNumber(value) === 1;
}

export interface DashboardViewer {
  authenticated: boolean;
}

function mergeUnique(left: string[], right: string[]): string[] {
  return Array.from(new Set([...left, ...right]));
}

function isDuplicateError(error: unknown): boolean {
  const err = error as { code?: string; errno?: number; message?: string };
  return err.code === "ER_DUP_ENTRY" || err.errno === 1062 || (err.message ?? "").includes("Duplicate entry");
}

export function visibleClassesForDashboard(profile: RepoProfile, viewer: DashboardViewer): VisibilityClass[] {
  if (!viewer.authenticated && !profile.access.anonymousRead) {
    return [];
  }
  return viewer.authenticated ? ["anonymous_readable", "logged_in_readable"] : ["anonymous_readable"];
}

export function cacheStaleHoursFromEnv(env: Record<string, string | undefined> = process.env): number {
  const parsed = Number(env.MO_DEVFLOW_CACHE_STALE_HOURS ?? "6");
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 6;
  }
  return Math.max(0.25, parsed);
}

export function buildSyncHealthSummary(rows: Array<Record<string, unknown>>): SyncHealth[] {
  return rows.map((row) => ({
    layer: asString(row.sync_layer),
    status: asString(row.status),
    lastSuccessfulAt: fromSqlDate(row.last_successful_at),
    lastAttemptedAt: fromSqlDate(row.started_at),
    errorMessage: row.error_message ? asString(row.error_message) : null,
    rateLimitRemaining:
      row.rate_limit_remaining === null || row.rate_limit_remaining === undefined
        ? null
        : asNumber(row.rate_limit_remaining)
  }));
}

export function isPersonalNeedsTriageIssue(input: {
  lifecycleState: string;
  severity: string | null;
}, criticalLabels: string[]): boolean {
  return input.lifecycleState === "needs-triage" && !criticalLabels.includes(input.severity ?? "");
}

function normalizedLogin(login: string): string {
  return login.trim().toLowerCase();
}

function normalizedLoginSet(logins: string[]): Set<string> {
  return new Set(logins.map(normalizedLogin).filter(Boolean));
}

function criticalIssueOwnerScopeFromSet(ownerLogin: string | null, watchedLogins: Set<string>): CriticalIssueOwnerScope {
  if (!ownerLogin) {
    return "unowned";
  }
  const normalizedOwner = normalizedLogin(ownerLogin);
  if (!normalizedOwner) {
    return "unowned";
  }
  return watchedLogins.has(normalizedOwner) ? "watched" : "non_watched";
}

export function criticalIssueOwnerScope(ownerLogin: string | null, watchedUsers: string[]): CriticalIssueOwnerScope {
  return criticalIssueOwnerScopeFromSet(ownerLogin, normalizedLoginSet(watchedUsers));
}

export function criticalIssueOwnershipCounts(
  criticalIssues: Array<{ ownerLogin: string | null }>,
  watchedUsers: string[]
): { unownedCriticalIssues: number; nonWatchedCriticalIssues: number } {
  const watchedLogins = normalizedLoginSet(watchedUsers);
  return {
    unownedCriticalIssues: criticalIssues.filter(
      (issue) => criticalIssueOwnerScopeFromSet(issue.ownerLogin, watchedLogins) === "unowned"
    ).length,
    nonWatchedCriticalIssues: criticalIssues.filter(
      (issue) => criticalIssueOwnerScopeFromSet(issue.ownerLogin, watchedLogins) === "non_watched"
    ).length
  };
}

export function profileConfigurationWarnings(profile: RepoProfile): ProfileConfigurationWarning[] {
  const warnings: ProfileConfigurationWarning[] = [];
  if (profile.people.watchedUsers.length === 0) {
    warnings.push({
      key: "profile:watched_users_empty",
      severity: "warning",
      title: "Watched users are not configured",
      description:
        "Personal action lists, per-person PR flow, and individual analytics are empty until people.watched_users is configured in the repository profile.",
      action: "Add GitHub logins under people.watched_users in the active repo profile."
    });
  }

  const handoffSignals = profile.testing.handoffSignals;
  const hasTestingSignal =
    handoffSignals.labels.length > 0 ||
    handoffSignals.reviewerUsers.length > 0 ||
    handoffSignals.assigneeUsers.length > 0 ||
    handoffSignals.comments.length > 0;
  if (!hasTestingSignal) {
    warnings.push({
      key: "profile:testing_handoff_unconfigured",
      severity: "warning",
      title: "Testing handoff rules are not configured",
      description:
        "Testing queue and tester turnover views cannot reflect the real workflow until a handoff label, reviewer, assignee, or comment signal is configured.",
      action: "Configure testing.handoff_signals and people.testers for the repo workflow."
    });
  }

  return warnings;
}

function visibilityClause(alias: string, classes: VisibilityClass[]): { sql: string; params: string[] } {
  if (classes.length === 0) {
    return { sql: "1 = 0", params: [] };
  }
  return {
    sql: `${alias}.visibility_class IN (${visibilityClassListSql(classes)})`,
    params: []
  };
}

function visibilityClassListSql(classes: VisibilityClass[]): string {
  return classes.map((value) => `'${value}'`).join(", ");
}

function sqlStringLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export async function upsertRepoProfile(profile: RepoProfile): Promise<number> {
  const pool = getPool();
  const now = nowSql();
  try {
    await pool.execute(
      `INSERT INTO repo_profiles(
        profile_key, owner, name, local_path, timezone, week_start, anonymous_read,
        critical_scope, config_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        profile.key,
        profile.repo.owner,
        profile.repo.name,
        profile.repo.localPath ?? null,
        profile.reporting.timezone,
        profile.reporting.weekStart,
        profile.access.anonymousRead ? 1 : 0,
        profile.access.criticalScope,
        stringify(profile.raw),
        now,
        now
      ]
    );
  } catch (error) {
    if (!isDuplicateError(error)) {
      throw error;
    }
    await pool.execute(
      `UPDATE repo_profiles
       SET owner = ?,
           name = ?,
           local_path = ?,
           timezone = ?,
           week_start = ?,
           anonymous_read = ?,
           critical_scope = ?,
           config_json = ?,
           updated_at = ?
       WHERE profile_key = ?`,
      [
        profile.repo.owner,
        profile.repo.name,
        profile.repo.localPath ?? null,
        profile.reporting.timezone,
        profile.reporting.weekStart,
        profile.access.anonymousRead ? 1 : 0,
        profile.access.criticalScope,
        stringify(profile.raw),
        now,
        profile.key
      ]
    );
  }
  const [rows] = await pool.execute<RowData[]>("SELECT id FROM repo_profiles WHERE profile_key = ?", [
    profile.key
  ]);
  return asNumber(rows[0]?.id);
}

export async function getRepoId(profileKey: string): Promise<number | null> {
  const [rows] = await getPool().execute<RowData[]>("SELECT id FROM repo_profiles WHERE profile_key = ?", [
    profileKey
  ]);
  return rows[0] ? asNumber(rows[0].id) : null;
}

export async function recordSyncRun(input: {
  repoId: number;
  syncLayer: string;
  status: "success" | "failed" | "partial" | "blocked";
  sourceAuthType: string;
  startedAt: string;
  finishedAt?: string;
  cursorValue?: string | null;
  errorMessage?: string | null;
  rateLimitRemaining?: number | null;
  raw?: unknown;
}): Promise<void> {
  await getPool().execute(
    `INSERT INTO sync_runs(
      repo_id, sync_layer, status, source_auth_type, started_at, finished_at,
      cursor_value, error_message, rate_limit_remaining, raw_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.repoId,
      input.syncLayer,
      input.status,
      input.sourceAuthType,
      sqlDate(input.startedAt),
      sqlDate(input.finishedAt ?? new Date().toISOString()),
      input.cursorValue ?? null,
      input.errorMessage ?? null,
      input.rateLimitRemaining ?? null,
      input.raw ? stringify(input.raw) : null
    ]
  );
}

export async function upsertIssue(repoId: number, issue: NormalizedIssue): Promise<void> {
  const now = nowSql();
  await getPool().execute("DELETE FROM issues WHERE repo_id = ? AND number = ?", [repoId, issue.number]);
  await getPool().execute(
    `INSERT INTO issues(
      repo_id, github_id, number, title, body, state, author_login, html_url,
      created_at, updated_at, closed_at, labels_json, assignees_json,
      owner_login, owner_reason, lifecycle_state, severity, ai_effort_label,
      is_pull_request, source_auth_type, visibility_class, is_complete,
      sync_error, raw_payload, last_synced_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      repoId,
      String(issue.githubId),
      issue.number,
      issue.title,
      issue.body,
      issue.state,
      issue.authorLogin,
      issue.htmlUrl,
      sqlDate(issue.createdAt),
      sqlDate(issue.updatedAt),
      sqlDate(issue.closedAt),
      stringify(issue.labels),
      stringify(issue.assignees),
      issue.ownerLogin,
      issue.ownerReason,
      issue.lifecycleState,
      issue.severity,
      issue.aiEffortLabel,
      issue.isPullRequest ? 1 : 0,
      issue.sourceAuthType,
      issue.visibilityClass,
      issue.isComplete ? 1 : 0,
      null,
      stringify(issue.rawPayload),
      now
    ]
  );
}

export async function listCachedIssuesForRules(repoId: number): Promise<NormalizedIssue[]> {
  const [rows] = await getPool().execute<RowData[]>(
    `SELECT *
     FROM issues
     WHERE repo_id = ? AND state = 'open' AND is_pull_request = 0`,
    [repoId]
  );

  return rows.map((row) => ({
    githubId: asNumber(row.github_id),
    number: asNumber(row.number),
    title: asString(row.title),
    body: asString(row.body),
    state: "open",
    authorLogin: asString(row.author_login),
    htmlUrl: asString(row.html_url),
    createdAt: fromSqlDate(row.created_at) ?? new Date().toISOString(),
    updatedAt: fromSqlDate(row.updated_at) ?? new Date().toISOString(),
    closedAt: fromSqlDate(row.closed_at),
    labels: parseJsonArray(asString(row.labels_json)),
    assignees: parseJsonArray(asString(row.assignees_json)),
    ownerLogin: row.owner_login ? asString(row.owner_login) : null,
    ownerReason: row.owner_reason ? asString(row.owner_reason) : null,
    lifecycleState: asString(row.lifecycle_state) as NormalizedIssue["lifecycleState"],
    severity: row.severity ? asString(row.severity) : null,
    aiEffortLabel: row.ai_effort_label ? asString(row.ai_effort_label) : null,
    isPullRequest: false,
    sourceAuthType: asString(row.source_auth_type) as NormalizedIssue["sourceAuthType"],
    visibilityClass: asString(row.visibility_class) as NormalizedIssue["visibilityClass"],
    isComplete: asNumber(row.is_complete) === 1,
    rawPayload: parseJsonRecord(asString(row.raw_payload), {})
  }));
}

export async function upsertPullRequest(repoId: number, pr: NormalizedPullRequest): Promise<NormalizedPullRequest> {
  const now = nowSql();
  let next = pr;
  if (pr.state === "open" && !pr.detailSyncedAt && !pr.detailError) {
    const [rows] = await getPool().execute<RowData[]>(
      `SELECT last_human_action_at, review_decision, merge_state_status, ci_state,
              latest_review_state, latest_review_submitted_at, latest_commit_at,
              detail_synced_at, detail_error, attention_flags_json
       FROM pull_requests
       WHERE repo_id = ? AND number = ?`,
      [repoId, pr.number]
    );
    const previous = rows[0];
    if (previous?.detail_synced_at) {
      next = {
        ...pr,
        lastHumanActionAt: fromSqlDate(previous.last_human_action_at) ?? pr.lastHumanActionAt,
        reviewDecision: previous.review_decision ? asString(previous.review_decision) : null,
        mergeStateStatus: previous.merge_state_status ? asString(previous.merge_state_status) : null,
        ciState: previous.ci_state ? asString(previous.ci_state) : null,
        latestReviewState: previous.latest_review_state ? asString(previous.latest_review_state) : null,
        latestReviewSubmittedAt: fromSqlDate(previous.latest_review_submitted_at),
        latestCommitAt: fromSqlDate(previous.latest_commit_at),
        detailSyncedAt: fromSqlDate(previous.detail_synced_at),
        detailError: previous.detail_error ? asString(previous.detail_error) : null,
        attentionFlags: mergeUnique(pr.attentionFlags, parseJsonArray(asString(previous.attention_flags_json)))
      };
    }
  }
  await getPool().execute("DELETE FROM pull_requests WHERE repo_id = ? AND number = ?", [repoId, pr.number]);
  await getPool().execute(
    `INSERT INTO pull_requests(
      repo_id, github_id, number, title, state, author_login, owner_login, html_url,
      created_at, updated_at, closed_at, merged_at, draft, head_ref, base_ref,
      labels_json, assignees_json, requested_reviewers_json, age_hours, last_human_action_at,
      last_system_action_at, review_decision, merge_state_status, ci_state,
      latest_review_state, latest_review_submitted_at, latest_commit_at,
      detail_synced_at, detail_error, testing_state, testing_testers_json,
      testing_signals_json, testing_queue_age_hours, attention_flags_json, source_auth_type,
      visibility_class, is_complete, sync_error, raw_payload, last_synced_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      repoId,
      String(next.githubId),
      next.number,
      next.title,
      next.state,
      next.authorLogin,
      next.ownerLogin,
      next.htmlUrl,
      sqlDate(next.createdAt),
      sqlDate(next.updatedAt),
      sqlDate(next.closedAt),
      sqlDate(next.mergedAt),
      next.draft ? 1 : 0,
      next.headRef,
      next.baseRef,
      stringify(next.labels),
      stringify(next.assignees),
      stringify(next.requestedReviewers),
      next.ageHours,
      sqlDate(next.lastHumanActionAt),
      sqlDate(next.lastSystemActionAt),
      next.reviewDecision,
      next.mergeStateStatus,
      next.ciState,
      next.latestReviewState,
      sqlDate(next.latestReviewSubmittedAt),
      sqlDate(next.latestCommitAt),
      sqlDate(next.detailSyncedAt),
      next.detailError,
      next.testingState,
      stringify(next.testingTesters),
      stringify(next.testingSignals),
      next.testingQueueAgeHours,
      stringify(next.attentionFlags),
      next.sourceAuthType,
      next.visibilityClass,
      next.isComplete ? 1 : 0,
      null,
      stringify(next.rawPayload),
      now
    ]
  );
  return next;
}

export async function upsertAttentionItem(input: {
  repoId: number;
  objectType: string;
  objectNumber?: number | null;
  ruleKey: string;
  severity: string;
  relatedLogin?: string | null;
  targetRecipient?: string | null;
  dedupeKey: string;
  evidenceSummary: string;
  dashboardUrl?: string | null;
}): Promise<void> {
  const now = nowSql();
  try {
    await getPool().execute(
      `INSERT INTO attention_items(
        repo_id, object_type, object_number, rule_key, severity, related_login,
        target_recipient, dedupe_key, first_detected_at, last_detected_at,
        resolved_at, evidence_summary, dashboard_url, notification_state
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, 'not_sent')`,
      [
        input.repoId,
        input.objectType,
        input.objectNumber ?? null,
        input.ruleKey,
        input.severity,
        input.relatedLogin ?? null,
        input.targetRecipient ?? null,
        input.dedupeKey,
        now,
        now,
        input.evidenceSummary,
        input.dashboardUrl ?? null
      ]
    );
  } catch (error) {
    if (!isDuplicateError(error)) {
      throw error;
    }
    await getPool().execute(
      `UPDATE attention_items
       SET severity = ?,
           related_login = ?,
           target_recipient = ?,
           last_detected_at = ?,
           resolved_at = NULL,
           evidence_summary = ?,
           dashboard_url = ?
       WHERE dedupe_key = ?`,
      [
        input.severity,
        input.relatedLogin ?? null,
        input.targetRecipient ?? null,
        now,
        input.evidenceSummary,
        input.dashboardUrl ?? null,
        input.dedupeKey
      ]
    );
  }
}

export const issueAttentionRuleKeys = ["critical_no_human_action"] as const;
export const pullRequestAttentionRuleKeys = [
  "no_human_action_24h",
  "requested_changes",
  "ci_failed",
  "merge_conflict",
  "testing_stalled"
] as const;
export const snapshotManagedAttentionRuleKeys = [
  ...issueAttentionRuleKeys,
  ...pullRequestAttentionRuleKeys
] as const;

export interface AttentionResolutionRow {
  objectType: string;
  objectNumber: number | null;
  ruleKey: string;
  dedupeKey: string;
}

export function attentionItemsToResolve(input: {
  rows: AttentionResolutionRow[];
  activeDedupeKeys: ReadonlySet<string>;
  managedRuleKeys: readonly string[];
  objectType?: string;
  objectNumber?: number;
}): string[] {
  const managedRuleKeys = new Set(input.managedRuleKeys);
  return input.rows
    .filter((row) => managedRuleKeys.has(row.ruleKey))
    .filter((row) => !input.activeDedupeKeys.has(row.dedupeKey))
    .filter((row) => !input.objectType || row.objectType === input.objectType)
    .filter((row) => input.objectNumber === undefined || row.objectNumber === input.objectNumber)
    .map((row) => row.dedupeKey);
}

export async function resolveStaleAttentionItems(input: {
  repoId: number;
  activeDedupeKeys: Iterable<string>;
  managedRuleKeys: readonly string[];
  objectType?: string;
  objectNumber?: number;
}): Promise<number> {
  const managedRuleKeys = Array.from(new Set(input.managedRuleKeys));
  if (managedRuleKeys.length === 0) {
    return 0;
  }
  const activeDedupeKeys = Array.from(new Set(input.activeDedupeKeys));
  const params: Array<string | number> = [nowSql(), input.repoId, ...managedRuleKeys];
  let sql = `UPDATE attention_items
             SET resolved_at = ?
             WHERE repo_id = ?
               AND resolved_at IS NULL
               AND rule_key IN (${managedRuleKeys.map(() => "?").join(", ")})`;
  if (input.objectType) {
    sql += " AND object_type = ?";
    params.push(input.objectType);
  }
  if (input.objectNumber !== undefined) {
    sql += " AND object_number = ?";
    params.push(input.objectNumber);
  }
  if (activeDedupeKeys.length > 0) {
    sql += ` AND dedupe_key NOT IN (${activeDedupeKeys.map(() => "?").join(", ")})`;
    params.push(...activeDedupeKeys);
  }
  const [result] = await getPool().execute(sql, params);
  return Number((result as ResultSetHeader).affectedRows ?? 0);
}

function workflowViolationDedupeKey(repoId: number, violation: WorkflowViolation): string {
  return `${repoId}:${violation.objectType}:${violation.objectNumber}:${violation.ruleKey}`;
}

function aiDriftDedupeKey(repoId: number, signal: AiDriftSignal): string {
  return `${repoId}:${signal.objectType}:${signal.objectNumber}:${signal.ruleKey}`;
}

export async function replaceWorkflowViolations(repoId: number, violations: WorkflowViolation[]): Promise<void> {
  const now = nowSql();
  const activeDedupeKeys = violations.map((violation) => workflowViolationDedupeKey(repoId, violation));

  for (let index = 0; index < violations.length; index += 1) {
    const violation = violations[index]!;
    const dedupeKey = activeDedupeKeys[index]!;
    try {
      await getPool().execute(
        `INSERT INTO workflow_violations(
          repo_id, object_type, object_number, title, html_url, rule_key, severity,
          related_login, dedupe_key, first_detected_at, last_detected_at,
          resolved_at, evidence_summary, suggested_action, fixable
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
        [
          repoId,
          violation.objectType,
          violation.objectNumber,
          violation.title,
          violation.htmlUrl,
          violation.ruleKey,
          violation.severity,
          violation.relatedLogin,
          dedupeKey,
          now,
          now,
          violation.evidenceSummary,
          violation.suggestedAction,
          violation.fixable ? 1 : 0
        ]
      );
    } catch (error) {
      if (!isDuplicateError(error)) {
        throw error;
      }
      await getPool().execute(
        `UPDATE workflow_violations
         SET title = ?,
             html_url = ?,
             severity = ?,
             related_login = ?,
             last_detected_at = ?,
             resolved_at = NULL,
             evidence_summary = ?,
             suggested_action = ?,
             fixable = ?
         WHERE dedupe_key = ?`,
        [
          violation.title,
          violation.htmlUrl,
          violation.severity,
          violation.relatedLogin,
          now,
          violation.evidenceSummary,
          violation.suggestedAction,
          violation.fixable ? 1 : 0,
          dedupeKey
        ]
      );
    }
  }

  if (activeDedupeKeys.length === 0) {
    await getPool().execute(
      "UPDATE workflow_violations SET resolved_at = ? WHERE repo_id = ? AND resolved_at IS NULL",
      [now, repoId]
    );
    return;
  }

  await getPool().execute(
    `UPDATE workflow_violations
     SET resolved_at = ?
     WHERE repo_id = ?
       AND resolved_at IS NULL
       AND dedupe_key NOT IN (${activeDedupeKeys.map(() => "?").join(", ")})`,
    [now, repoId, ...activeDedupeKeys]
  );
}

export async function replaceAiDriftSignals(repoId: number, signals: AiDriftSignal[]): Promise<void> {
  const now = nowSql();
  const activeDedupeKeys = signals.map((signal) => aiDriftDedupeKey(repoId, signal));

  for (let index = 0; index < signals.length; index += 1) {
    const signal = signals[index]!;
    const dedupeKey = activeDedupeKeys[index]!;
    try {
      await getPool().execute(
        `INSERT INTO ai_drift_signals(
          repo_id, object_type, object_number, title, html_url, rule_key, severity,
          owner_login, ai_effort_label, expected_hours, actual_hours, dedupe_key,
          first_detected_at, last_detected_at, resolved_at, evidence_summary,
          suggested_action, source_completeness
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
        [
          repoId,
          signal.objectType,
          signal.objectNumber,
          signal.title,
          signal.htmlUrl,
          signal.ruleKey,
          signal.severity,
          signal.ownerLogin,
          signal.aiEffortLabel,
          signal.expectedHours,
          signal.actualHours,
          dedupeKey,
          now,
          now,
          signal.evidenceSummary,
          signal.suggestedAction,
          signal.sourceCompleteness
        ]
      );
    } catch (error) {
      if (!isDuplicateError(error)) {
        throw error;
      }
      await getPool().execute(
        `UPDATE ai_drift_signals
         SET title = ?,
             html_url = ?,
             severity = ?,
             owner_login = ?,
             ai_effort_label = ?,
             expected_hours = ?,
             actual_hours = ?,
             last_detected_at = ?,
             resolved_at = NULL,
             evidence_summary = ?,
             suggested_action = ?,
             source_completeness = ?
         WHERE dedupe_key = ?`,
        [
          signal.title,
          signal.htmlUrl,
          signal.severity,
          signal.ownerLogin,
          signal.aiEffortLabel,
          signal.expectedHours,
          signal.actualHours,
          now,
          signal.evidenceSummary,
          signal.suggestedAction,
          signal.sourceCompleteness,
          dedupeKey
        ]
      );
    }
  }

  if (activeDedupeKeys.length === 0) {
    await getPool().execute(
      "UPDATE ai_drift_signals SET resolved_at = ? WHERE repo_id = ? AND resolved_at IS NULL",
      [now, repoId]
    );
    return;
  }

  await getPool().execute(
    `UPDATE ai_drift_signals
     SET resolved_at = ?
     WHERE repo_id = ?
       AND resolved_at IS NULL
       AND dedupe_key NOT IN (${activeDedupeKeys.map(() => "?").join(", ")})`,
    [now, repoId, ...activeDedupeKeys]
  );
}

export async function runWithJobLease<T>(
  jobKey: string,
  jobType: string,
  handler: () => Promise<T>,
  options: {
    leaseSeconds?: number;
    nextRunAt?: string;
  } = {}
): Promise<T | null> {
  const pool = getPool();
  const now = nowSql();
  const leaseOwner = `${process.pid}-${Math.random().toString(16).slice(2)}`;
  const leaseExpiresAt =
    sqlDate(new Date(Date.now() + (options.leaseSeconds ?? 600) * 1000)) ?? now;
  try {
    await pool.execute(
      `INSERT INTO jobs(
        job_key, job_type, status, attempts, next_run_at, lease_owner,
        lease_expires_at, last_error, payload_json, created_at, updated_at
      ) VALUES (?, ?, 'pending', 0, ?, NULL, NULL, NULL, NULL, ?, ?)`,
      [jobKey, jobType, now, now, now]
    );
  } catch (error) {
    if (!isDuplicateError(error)) {
      throw error;
    }
  }
  const [result] = await pool.execute(
    `UPDATE jobs
     SET status = 'running',
         lease_owner = ?,
         lease_expires_at = ?,
         attempts = attempts + 1,
         updated_at = ?
     WHERE job_key = ?
       AND (lease_expires_at IS NULL OR lease_expires_at < ? OR status IN ('pending', 'failed', 'complete'))`,
    [leaseOwner, leaseExpiresAt, now, jobKey, now]
  );
  const changedRows = Number((result as ResultSetHeader).affectedRows ?? 0);
  if (changedRows === 0) {
    return null;
  }
  try {
    const value = await handler();
    await pool.execute(
      `UPDATE jobs
       SET status = 'complete',
           lease_owner = NULL,
           lease_expires_at = NULL,
           last_error = NULL,
           next_run_at = ?,
           updated_at = ?
       WHERE job_key = ? AND lease_owner = ?`,
      [sqlDate(options.nextRunAt ?? new Date().toISOString()), nowSql(), jobKey, leaseOwner]
    );
    return value;
  } catch (error) {
    await pool.execute(
      `UPDATE jobs
       SET status = 'failed',
           lease_owner = NULL,
           lease_expires_at = NULL,
           last_error = ?,
           updated_at = UTC_TIMESTAMP()
       WHERE job_key = ? AND lease_owner = ?`,
      [error instanceof Error ? error.message : String(error), jobKey, leaseOwner]
    );
    throw error;
  }
}

function inRange(value: unknown, start: Date, end: Date): boolean {
  const iso = fromSqlDate(value);
  if (!iso) {
    return false;
  }
  const time = new Date(iso).getTime();
  return time >= start.getTime() && time < end.getTime();
}

function issueAgeHours(row: RowData): number {
  return Math.max(
    0,
    Math.round(((Date.now() - new Date(fromSqlDate(row.created_at) ?? new Date()).getTime()) / 3_600_000) * 10) / 10
  );
}

function linkedIssueNumbersForPullRequestRow(row: RowData): number[] {
  const rawPayload = parseJsonRecord<Record<string, unknown>>(asString(row.raw_payload), {});
  const body = typeof rawPayload.body === "string" ? rawPayload.body : "";
  return extractLinkedIssueNumbers(`${asString(row.title)}\n${body}`);
}

function toCriticalIssueLinkedPullRequestView(row: RowData): CriticalIssueLinkedPullRequestView {
  return {
    number: asNumber(row.number),
    title: asString(row.title),
    htmlUrl: asString(row.html_url),
    state: asString(row.state) === "closed" ? "closed" : "open",
    ownerLogin: asString(row.owner_login),
    ageHours: asNumber(row.age_hours),
    lastHumanActionAt: fromSqlDate(row.last_human_action_at) ?? new Date().toISOString(),
    reviewDecision: row.review_decision ? asString(row.review_decision) : null,
    mergeStateStatus: row.merge_state_status ? asString(row.merge_state_status) : null,
    ciState: row.ci_state ? asString(row.ci_state) : null,
    testingState: row.testing_state
      ? (asString(row.testing_state) as CriticalIssueLinkedPullRequestView["testingState"])
      : "not_ready",
    testingTesters: parseJsonArray(asString(row.testing_testers_json)),
    testingQueueAgeHours:
      row.testing_queue_age_hours === null || row.testing_queue_age_hours === undefined
        ? null
        : asNumber(row.testing_queue_age_hours),
    attentionFlags: parseJsonArray(asString(row.attention_flags_json)),
    isComplete: asNumber(row.is_complete) === 1
  };
}

function linkedPullRequestsByIssueNumber(
  rows: RowData[],
  issueNumbers: Set<number>
): Map<number, CriticalIssueLinkedPullRequestView[]> {
  const linked = new Map<number, CriticalIssueLinkedPullRequestView[]>();
  for (const row of rows) {
    const matchedNumbers = linkedIssueNumbersForPullRequestRow(row).filter((number) => issueNumbers.has(number));
    if (matchedNumbers.length === 0) {
      continue;
    }
    const view = toCriticalIssueLinkedPullRequestView(row);
    for (const issueNumber of matchedNumbers) {
      const existing = linked.get(issueNumber) ?? [];
      if (!existing.some((pr) => pr.number === view.number)) {
        existing.push(view);
      }
      linked.set(issueNumber, existing.slice(0, 8));
    }
  }
  return linked;
}

function blockerForPrFlag(pr: CriticalIssueLinkedPullRequestView, flag: string): CriticalIssueBlockerView {
  const message = (value: string): string =>
    pr.isComplete ? value : `${value} Partial PR evidence until detail backfill completes.`;
  if (flag === "merge_conflict") {
    return {
      key: `pr:${pr.number}:merge_conflict`,
      severity: "critical",
      message: message(`PR #${pr.number} has a merge conflict.`),
      relatedPrNumber: pr.number
    };
  }
  if (flag === "ci_failed") {
    return {
      key: `pr:${pr.number}:ci_failed`,
      severity: "warning",
      message: message(`PR #${pr.number} has failing CI.`),
      relatedPrNumber: pr.number
    };
  }
  if (flag === "requested_changes") {
    return {
      key: `pr:${pr.number}:requested_changes`,
      severity: "warning",
      message: message(`PR #${pr.number} has unresolved requested changes.`),
      relatedPrNumber: pr.number
    };
  }
  if (flag === "no_human_action_24h") {
    return {
      key: `pr:${pr.number}:no_human_action_24h`,
      severity: "warning",
      message: message(`PR #${pr.number} has no recent human action.`),
      relatedPrNumber: pr.number
    };
  }
  if (flag === "testing_stalled") {
    return {
      key: `pr:${pr.number}:testing_stalled`,
      severity: "warning",
      message: message(`PR #${pr.number} is stalled in testing handoff.`),
      relatedPrNumber: pr.number
    };
  }
  return {
    key: `pr:${pr.number}:${flag}`,
    severity: "warning",
    message: message(`PR #${pr.number} needs attention: ${flag}.`),
    relatedPrNumber: pr.number
  };
}

export function criticalIssueBlockersFromCache(input: {
  ownerLogin: string | null;
  aiEffortLabel: string | null;
  isComplete: boolean;
  syncError: string | null;
  linkedPullRequests: CriticalIssueLinkedPullRequestView[];
}): CriticalIssueBlockerView[] {
  const blockers: CriticalIssueBlockerView[] = [];
  if (!input.ownerLogin) {
    blockers.push({
      key: "issue:unowned",
      severity: "critical",
      message: "Critical issue has no owner in cache.",
      relatedPrNumber: null
    });
  }
  if (!input.aiEffortLabel) {
    blockers.push({
      key: "issue:missing_ai_effort",
      severity: "warning",
      message: "Critical issue has no AI effort label.",
      relatedPrNumber: null
    });
  }
  if (input.syncError) {
    blockers.push({
      key: "issue:sync_error",
      severity: "warning",
      message: "Issue sync has an error; cache evidence may be stale.",
      relatedPrNumber: null
    });
  }
  if (!input.isComplete) {
    blockers.push({
      key: "issue:partial_cache",
      severity: "info",
      message: "Issue evidence is partial until detail backfill completes.",
      relatedPrNumber: null
    });
  }
  if (input.linkedPullRequests.length === 0) {
    blockers.push({
      key: "issue:no_linked_pr_in_cache",
      severity: "info",
      message: "No linked PR is visible in cache.",
      relatedPrNumber: null
    });
  }
  for (const pr of input.linkedPullRequests) {
    for (const flag of pr.attentionFlags) {
      blockers.push(blockerForPrFlag(pr, flag));
    }
  }
  return blockers.slice(0, 12);
}

function toCriticalIssueView(
  row: RowData,
  linkedPullRequests: CriticalIssueLinkedPullRequestView[] = [],
  watchedUsers: string[] = []
): CriticalIssueView {
  const ownerLogin = row.owner_login ? asString(row.owner_login) : null;
  const aiEffortLabel = row.ai_effort_label ? asString(row.ai_effort_label) : null;
  const syncError = row.sync_error ? asString(row.sync_error) : null;
  const isComplete = asNumber(row.is_complete) === 1;
  return {
    number: asNumber(row.number),
    title: asString(row.title),
    htmlUrl: asString(row.html_url),
    severity: row.severity ? asString(row.severity) : null,
    ownerLogin,
    ownerScope: criticalIssueOwnerScope(ownerLogin, watchedUsers),
    ownerReason: row.owner_reason ? asString(row.owner_reason) : null,
    lifecycleState: asString(row.lifecycle_state) as CriticalIssueView["lifecycleState"],
    aiEffortLabel,
    ageHours: issueAgeHours(row),
    sourceUpdatedAt: fromSqlDate(row.updated_at) ?? new Date().toISOString(),
    lastSyncedAt: fromSqlDate(row.last_synced_at) ?? new Date().toISOString(),
    syncError,
    isComplete,
    labels: parseJsonArray(asString(row.labels_json)),
    linkedPullRequests,
    blockers: criticalIssueBlockersFromCache({
      ownerLogin,
      aiEffortLabel,
      isComplete,
      syncError,
      linkedPullRequests
    })
  };
}

function toPersonalIssueView(row: RowData): PersonalIssueView {
  return {
    number: asNumber(row.number),
    title: asString(row.title),
    htmlUrl: asString(row.html_url),
    severity: row.severity ? asString(row.severity) : null,
    lifecycleState: asString(row.lifecycle_state) as PersonalIssueView["lifecycleState"],
    ageHours: issueAgeHours(row),
    lastSyncedAt: fromSqlDate(row.last_synced_at) ?? new Date().toISOString(),
    isComplete: asNumber(row.is_complete) === 1,
    labels: parseJsonArray(asString(row.labels_json))
  };
}

function toPendingPrView(row: RowData): PendingPrView {
  return {
    number: asNumber(row.number),
    title: asString(row.title),
    htmlUrl: asString(row.html_url),
    ownerLogin: asString(row.owner_login),
    draft: asNumber(row.draft) === 1,
    ageHours: asNumber(row.age_hours),
    lastHumanActionAt: fromSqlDate(row.last_human_action_at) ?? new Date().toISOString(),
    reviewDecision: row.review_decision ? asString(row.review_decision) : null,
    mergeStateStatus: row.merge_state_status ? asString(row.merge_state_status) : null,
    ciState: row.ci_state ? asString(row.ci_state) : null,
    latestReviewState: row.latest_review_state ? asString(row.latest_review_state) : null,
    latestReviewSubmittedAt: fromSqlDate(row.latest_review_submitted_at),
    latestCommitAt: fromSqlDate(row.latest_commit_at),
    detailSyncedAt: fromSqlDate(row.detail_synced_at),
    detailError: row.detail_error ? asString(row.detail_error) : null,
    testingState: row.testing_state ? asString(row.testing_state) as PendingPrView["testingState"] : "not_ready",
    testingTesters: parseJsonArray(asString(row.testing_testers_json)),
    testingSignals: parseJsonArray(asString(row.testing_signals_json)),
    testingQueueAgeHours:
      row.testing_queue_age_hours === null || row.testing_queue_age_hours === undefined
        ? null
        : asNumber(row.testing_queue_age_hours),
    attentionFlags: parseJsonArray(asString(row.attention_flags_json)),
    isComplete: asNumber(row.is_complete) === 1
  };
}

function toPersonalPullRequestView(row: RowData): PersonalPullRequestView {
  return {
    ...toPendingPrView(row),
    state: asString(row.state) === "closed" ? "closed" : "open",
    createdAt: fromSqlDate(row.created_at) ?? new Date().toISOString(),
    mergedAt: fromSqlDate(row.merged_at)
  };
}

function recentDateKeys(days: number, timezone: string): string[] {
  const keys: string[] = [];
  const now = Date.now();
  for (let offset = Math.max(days, 1) - 1; offset >= 0; offset -= 1) {
    const key = dateKeyInTimezone(new Date(now - offset * 24 * 60 * 60 * 1000).toISOString(), timezone);
    if (key) {
      keys.push(key);
    }
  }
  return Array.from(new Set(keys)).slice(-days);
}

function newMetricPoint(date: string, scopeType: "team" | "person", scopeKey: string): DailyMetricPoint {
  return {
    date,
    scopeType,
    scopeKey,
    prsCreated: 0,
    prsMerged: 0,
    issuesOpened: 0,
    issuesClosed: 0,
    issuesDeferred: 0,
    workflowViolationsDetected: 0,
    sourceCompleteness: "partial_cache",
    generatedAt: new Date().toISOString()
  };
}

function metricKey(date: string, scopeType: "team" | "person", scopeKey: string): string {
  return `${date}:${scopeType}:${scopeKey}`;
}

function bumpMetric(
  metrics: Map<string, DailyMetricPoint>,
  dateKeys: Set<string>,
  date: string | null,
  scopeType: "team" | "person",
  scopeKey: string,
  field: keyof Pick<
    DailyMetricPoint,
    "prsCreated" | "prsMerged" | "issuesOpened" | "issuesClosed" | "issuesDeferred" | "workflowViolationsDetected"
  >
): void {
  if (!date || !dateKeys.has(date)) {
    return;
  }
  const key = metricKey(date, scopeType, scopeKey);
  const point = metrics.get(key);
  if (point) {
    point[field] += 1;
  }
}

function utcDateFromKey(dateKey: string): Date {
  return new Date(`${dateKey}T00:00:00.000Z`);
}

function dateKeyFromUtcDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function addMonthsToDateKey(dateKey: string, months: number): string {
  const value = utcDateFromKey(dateKey);
  value.setUTCMonth(value.getUTCMonth() + months);
  return dateKeyFromUtcDate(value);
}

function weekStartDateKey(dateKey: string, weekStart: RepoProfile["reporting"]["weekStart"]): string {
  const value = utcDateFromKey(dateKey);
  const day = value.getUTCDay();
  const offset = weekStart === "Monday" ? (day === 0 ? 6 : day - 1) : day;
  value.setUTCDate(value.getUTCDate() - offset);
  return dateKeyFromUtcDate(value);
}

function monthStartDateKey(dateKey: string): string {
  return `${dateKey.slice(0, 7)}-01`;
}

function metricPeriodBounds(
  dateKey: string,
  period: AggregatedMetricPoint["period"],
  weekStart: RepoProfile["reporting"]["weekStart"]
): { start: string; end: string; label: string } {
  const start = period === "week" ? weekStartDateKey(dateKey, weekStart) : monthStartDateKey(dateKey);
  const end = period === "week" ? addDaysToDateKey(start, 7) : addMonthsToDateKey(start, 1);
  const label =
    period === "week"
      ? `${start.slice(5)}-${addDaysToDateKey(end, -1).slice(5)}`
      : start.slice(0, 7);
  return { start, end, label };
}

function latestIso(left: string, right: string): string {
  return new Date(left).getTime() >= new Date(right).getTime() ? left : right;
}

export function aggregateMetricPoints(
  points: DailyMetricPoint[],
  period: AggregatedMetricPoint["period"],
  weekStart: RepoProfile["reporting"]["weekStart"]
): AggregatedMetricPoint[] {
  const aggregates = new Map<string, AggregatedMetricPoint>();

  for (const point of points) {
    const bounds = metricPeriodBounds(point.date, period, weekStart);
    const key = `${period}:${bounds.start}:${point.scopeType}:${point.scopeKey}`;
    const existing = aggregates.get(key);
    if (!existing) {
      aggregates.set(key, {
        ...point,
        date: bounds.start,
        period,
        periodStart: bounds.start,
        periodEnd: bounds.end,
        label: bounds.label
      });
      continue;
    }

    existing.prsCreated += point.prsCreated;
    existing.prsMerged += point.prsMerged;
    existing.issuesOpened += point.issuesOpened;
    existing.issuesClosed += point.issuesClosed;
    existing.issuesDeferred += point.issuesDeferred;
    existing.workflowViolationsDetected += point.workflowViolationsDetected;
    existing.generatedAt = latestIso(existing.generatedAt, point.generatedAt);
    existing.sourceCompleteness =
      existing.sourceCompleteness === "complete_cache" && point.sourceCompleteness === "complete_cache"
        ? "complete_cache"
        : "partial_cache";
  }

  return Array.from(aggregates.values()).sort((left, right) => {
    const dateOrder = left.periodStart.localeCompare(right.periodStart);
    if (dateOrder !== 0) {
      return dateOrder;
    }
    const scopeOrder = left.scopeType.localeCompare(right.scopeType);
    if (scopeOrder !== 0) {
      return scopeOrder;
    }
    return left.scopeKey.localeCompare(right.scopeKey);
  });
}

export async function recomputeDailyMetricsFromCache(
  repoId: number,
  profile: RepoProfile,
  days = 30
): Promise<number> {
  const pool = getPool();
  const keys = recentDateKeys(days, profile.reporting.timezone);
  const keySet = new Set(keys);
  const metrics = new Map<string, DailyMetricPoint>();
  const people = profile.people.watchedUsers;

  for (const date of keys) {
    const team = newMetricPoint(date, "team", "all");
    metrics.set(metricKey(date, "team", "all"), team);
    for (const login of people) {
      const person = newMetricPoint(date, "person", login);
      metrics.set(metricKey(date, "person", login), person);
    }
  }

  const [prRows] = await pool.execute<RowData[]>(
    `SELECT owner_login, created_at, merged_at
     FROM pull_requests
     WHERE repo_id = ?`,
    [repoId]
  );
  for (const row of prRows) {
    const owner = asString(row.owner_login);
    const createdDate = dateKeyInTimezone(row.created_at, profile.reporting.timezone);
    const mergedDate = dateKeyInTimezone(row.merged_at, profile.reporting.timezone);
    bumpMetric(metrics, keySet, createdDate, "team", "all", "prsCreated");
    bumpMetric(metrics, keySet, mergedDate, "team", "all", "prsMerged");
    if (people.includes(owner)) {
      bumpMetric(metrics, keySet, createdDate, "person", owner, "prsCreated");
      bumpMetric(metrics, keySet, mergedDate, "person", owner, "prsMerged");
    }
  }

  const [issueRows] = await pool.execute<RowData[]>(
    `SELECT owner_login, created_at, closed_at, lifecycle_state
     FROM issues
     WHERE repo_id = ? AND is_pull_request = 0`,
    [repoId]
  );
  for (const row of issueRows) {
    const owner = row.owner_login ? asString(row.owner_login) : "";
    const createdDate = dateKeyInTimezone(row.created_at, profile.reporting.timezone);
    const closedDate = dateKeyInTimezone(row.closed_at, profile.reporting.timezone);
    bumpMetric(metrics, keySet, createdDate, "team", "all", "issuesOpened");
    bumpMetric(metrics, keySet, closedDate, "team", "all", "issuesClosed");
    if (row.lifecycle_state === "deferred") {
      bumpMetric(metrics, keySet, createdDate, "team", "all", "issuesDeferred");
    }
    if (people.includes(owner)) {
      bumpMetric(metrics, keySet, createdDate, "person", owner, "issuesOpened");
      bumpMetric(metrics, keySet, closedDate, "person", owner, "issuesClosed");
      if (row.lifecycle_state === "deferred") {
        bumpMetric(metrics, keySet, createdDate, "person", owner, "issuesDeferred");
      }
    }
  }

  const [violationRows] = await pool.execute<RowData[]>(
    `SELECT related_login, first_detected_at
     FROM workflow_violations
     WHERE repo_id = ? AND resolved_at IS NULL`,
    [repoId]
  );
  for (const row of violationRows) {
    const login = row.related_login ? asString(row.related_login) : "";
    const detectedDate = dateKeyInTimezone(row.first_detected_at, profile.reporting.timezone);
    bumpMetric(metrics, keySet, detectedDate, "team", "all", "workflowViolationsDetected");
    if (people.includes(login)) {
      bumpMetric(metrics, keySet, detectedDate, "person", login, "workflowViolationsDetected");
    }
  }

  const generatedAt = nowSql();
  await pool.execute("DELETE FROM daily_metrics WHERE repo_id = ?", [repoId]);
  for (const point of metrics.values()) {
    await pool.execute(
      `INSERT INTO daily_metrics(
        repo_id, metric_date, scope_type, scope_key, prs_created, prs_merged,
        issues_opened, issues_closed, issues_deferred, workflow_violations_detected,
        source_completeness, generated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        repoId,
        point.date,
        point.scopeType,
        point.scopeKey,
        point.prsCreated,
        point.prsMerged,
        point.issuesOpened,
        point.issuesClosed,
        point.issuesDeferred,
        point.workflowViolationsDetected,
        point.sourceCompleteness,
        generatedAt
      ]
    );
  }

  return metrics.size;
}

export async function getDashboardSummary(
  profile: RepoProfile,
  repoId: number,
  viewer: DashboardViewer = { authenticated: false }
): Promise<DashboardSummary> {
  const pool = getPool();
  const visibleClasses = visibleClassesForDashboard(profile, viewer);
  const criticalVisibility = visibilityClause("i", visibleClasses);
  const prVisibility = visibilityClause("p", visibleClasses);
  const issueListVisibility = visibilityClause("i", visibleClasses);
  const allPrVisibility = visibilityClause("p", visibleClasses);
  const partialIssueVisibility = visibilityClause("i", visibleClasses);
  const partialPrVisibility = visibilityClause("p", visibleClasses);
  const staleIssueVisibility = visibilityClause("i", visibleClasses);
  const stalePrVisibility = visibilityClause("p", visibleClasses);
  const violationIssueVisibility = visibilityClause("i", visibleClasses);
  const violationPrVisibility = visibilityClause("p", visibleClasses);
  const driftIssueVisibility = visibilityClause("i", visibleClasses);
  const driftPrVisibility = visibilityClause("p", visibleClasses);
  const personalIssueVisibility = visibilityClause("i", visibleClasses);
  const personalPrVisibility = visibilityClause("p", visibleClasses);
  const linkedPrVisibility = visibilityClause("p", visibleClasses);
  const { start, end } = previousCalendarDayRange(profile.reporting.timezone);
  const startSql = sqlDate(start) ?? "1970-01-01 00:00:00";
  const endSql = sqlDate(end) ?? "1970-01-01 00:00:00";
  const watchedUserPlaceholders = profile.people.watchedUsers.map(() => "?").join(", ");
  const hiddenIssueExpression =
    visibleClasses.length === 0
      ? "COUNT(*)"
      : `SUM(CASE WHEN visibility_class IN (${visibilityClassListSql(visibleClasses)}) THEN 0 ELSE 1 END)`;
  const hiddenPrExpression =
    visibleClasses.length === 0
      ? "COUNT(*)"
      : `SUM(CASE WHEN visibility_class IN (${visibilityClassListSql(visibleClasses)}) THEN 0 ELSE 1 END)`;
  const staleThresholdHours = cacheStaleHoursFromEnv();
  const staleCutoff = sqlDate(new Date(Date.now() - staleThresholdHours * 3_600_000)) ?? "1970-01-01 00:00:00";
  const [criticalRows] = await pool.execute<RowData[]>(
    `SELECT * FROM issues i
     WHERE i.repo_id = ?
       AND i.state = 'open'
       AND i.severity IN (${profile.labels.critical.map(() => "?").join(", ")})
       AND ${criticalVisibility.sql}
     ORDER BY updated_at ASC
     LIMIT 100`,
    [repoId, ...profile.labels.critical, ...criticalVisibility.params]
  );
  const [prRows] = await pool.execute<RowData[]>(
    `SELECT * FROM pull_requests p
     WHERE p.repo_id = ? AND p.state = 'open'
       AND ${prVisibility.sql}
     ORDER BY updated_at ASC
     LIMIT 300`,
    [repoId, ...prVisibility.params]
  );
  const [issueRows] = await pool.execute<RowData[]>(
    `SELECT i.owner_login, i.lifecycle_state, i.severity, i.state
     FROM issues i
     WHERE i.repo_id = ? AND ${issueListVisibility.sql}`,
    [repoId, ...issueListVisibility.params]
  );
  const [allPrRows] = await pool.execute<RowData[]>(
    `SELECT p.owner_login, p.created_at, p.merged_at, p.state, p.attention_flags_json,
            p.testing_state, p.testing_testers_json, p.testing_queue_age_hours
     FROM pull_requests p
     WHERE p.repo_id = ? AND ${allPrVisibility.sql}`,
    [repoId, ...allPrVisibility.params]
  );
  const [syncRows] = await pool.execute<RowData[]>(
    `SELECT latest.sync_layer,
            latest.status,
            latest.started_at,
            latest.error_message,
            latest.rate_limit_remaining,
            summary.last_successful_at
     FROM sync_runs latest
     JOIN (
       SELECT sync_layer,
              MAX(id) AS latest_id,
              MAX(CASE WHEN status = 'success' THEN finished_at ELSE NULL END) AS last_successful_at
       FROM sync_runs
       WHERE repo_id = ?
       GROUP BY sync_layer
     ) summary ON summary.latest_id = latest.id
     WHERE latest.repo_id = ?
     ORDER BY latest.id DESC
     LIMIT 20`,
    [repoId, repoId]
  );
  const [partialRows] = await pool.execute<RowData[]>(
    `SELECT
       SUM(CASE WHEN is_complete = 0 THEN 1 ELSE 0 END) AS partial_count
     FROM (
       SELECT i.is_complete FROM issues i WHERE i.repo_id = ? AND ${partialIssueVisibility.sql}
       UNION ALL
       SELECT p.is_complete FROM pull_requests p WHERE p.repo_id = ? AND ${partialPrVisibility.sql}
     ) t`,
    [repoId, ...partialIssueVisibility.params, repoId, ...partialPrVisibility.params]
  );
  const [staleRows] = await pool.execute<RowData[]>(
    `SELECT
       SUM(CASE WHEN last_synced_at < ${sqlStringLiteral(staleCutoff)} THEN 1 ELSE 0 END) AS stale_count,
       MIN(last_synced_at) AS oldest_synced_at
     FROM (
       SELECT i.last_synced_at FROM issues i WHERE i.repo_id = ? AND ${staleIssueVisibility.sql}
       UNION ALL
       SELECT p.last_synced_at FROM pull_requests p WHERE p.repo_id = ? AND ${stalePrVisibility.sql}
     ) t`,
    [repoId, ...staleIssueVisibility.params, repoId, ...stalePrVisibility.params]
  );
  const [hiddenIssueRows] = await pool.execute<RowData[]>(
    `SELECT ${hiddenIssueExpression} AS hidden_issues FROM issues WHERE repo_id = ?`,
    [repoId]
  );
  const [hiddenPrRows] = await pool.execute<RowData[]>(
    `SELECT ${hiddenPrExpression} AS hidden_pull_requests FROM pull_requests WHERE repo_id = ?`,
    [repoId]
  );
  const [violationRows] = await pool.execute<RowData[]>(
    `SELECT v.*
     FROM workflow_violations v
     WHERE v.repo_id = ? AND v.resolved_at IS NULL
       AND (
         (v.object_type = 'issue' AND EXISTS (
           SELECT 1 FROM issues i
           WHERE i.repo_id = v.repo_id AND i.number = v.object_number AND ${violationIssueVisibility.sql}
         ))
         OR
         (v.object_type = 'pull_request' AND EXISTS (
           SELECT 1 FROM pull_requests p
           WHERE p.repo_id = v.repo_id AND p.number = v.object_number AND ${violationPrVisibility.sql}
         ))
       )
     ORDER BY
       CASE v.severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
       v.last_detected_at DESC
     LIMIT 100`,
    [repoId, ...violationIssueVisibility.params, ...violationPrVisibility.params]
  );
  const [metricRows] = await pool.execute<RowData[]>(
    `SELECT *
     FROM daily_metrics
     WHERE repo_id = ?
     ORDER BY metric_date ASC, scope_type ASC, scope_key ASC`,
    [repoId]
  );
  const [driftRows] = await pool.execute<RowData[]>(
    `SELECT d.*
     FROM ai_drift_signals d
     WHERE d.repo_id = ? AND d.resolved_at IS NULL
       AND (
         (d.object_type = 'issue' AND EXISTS (
           SELECT 1 FROM issues i
           WHERE i.repo_id = d.repo_id AND i.number = d.object_number AND ${driftIssueVisibility.sql}
         ))
         OR
         (d.object_type = 'pull_request' AND EXISTS (
           SELECT 1 FROM pull_requests p
           WHERE p.repo_id = d.repo_id AND p.number = d.object_number AND ${driftPrVisibility.sql}
         ))
       )
     ORDER BY
       CASE d.severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
       d.actual_hours DESC,
       d.last_detected_at DESC
     LIMIT 100`,
    [repoId, ...driftIssueVisibility.params, ...driftPrVisibility.params]
  );
  const [personalIssueRows] =
    profile.people.watchedUsers.length === 0
      ? [[] as RowData[]]
      : await pool.execute<RowData[]>(
          `SELECT *
           FROM issues i
           WHERE i.repo_id = ?
             AND i.state = 'open'
             AND i.owner_login IN (${watchedUserPlaceholders})
             AND (
               i.severity IN (${profile.labels.critical.map(() => "?").join(", ")})
               OR i.lifecycle_state IN ('needs-triage', 'deferred')
             )
             AND ${personalIssueVisibility.sql}
           ORDER BY i.updated_at ASC
           LIMIT 500`,
          [repoId, ...profile.people.watchedUsers, ...profile.labels.critical, ...personalIssueVisibility.params]
        );
  const [personalPrRows] =
    profile.people.watchedUsers.length === 0
      ? [[] as RowData[]]
      : await pool.execute<RowData[]>(
          `SELECT *
           FROM pull_requests p
           WHERE p.repo_id = ?
             AND p.owner_login IN (${watchedUserPlaceholders})
             AND (
               p.state = 'open'
               OR (p.created_at >= ? AND p.created_at < ?)
               OR (p.merged_at >= ? AND p.merged_at < ?)
             )
             AND ${personalPrVisibility.sql}
           ORDER BY p.updated_at DESC
           LIMIT 500`,
          [
            repoId,
            ...profile.people.watchedUsers,
            startSql,
            endSql,
            startSql,
            endSql,
            ...personalPrVisibility.params
          ]
        );
  const criticalIssueNumbers = new Set([
    ...criticalRows.map((row) => asNumber(row.number)),
    ...personalIssueRows
      .filter((row) => profile.labels.critical.includes(asString(row.severity)))
      .map((row) => asNumber(row.number))
  ]);
  const [linkedPrCandidateRows] =
    criticalIssueNumbers.size === 0
      ? [[] as RowData[]]
      : await pool.execute<RowData[]>(
          `SELECT *
           FROM pull_requests p
           WHERE p.repo_id = ?
             AND ${linkedPrVisibility.sql}
           ORDER BY CASE WHEN p.state = 'open' THEN 0 ELSE 1 END, p.updated_at DESC
           LIMIT 500`,
          [repoId, ...linkedPrVisibility.params]
        );
  const linkedPrsByIssueNumber = linkedPullRequestsByIssueNumber(linkedPrCandidateRows, criticalIssueNumbers);
  const criticalIssues: CriticalIssueView[] = criticalRows.map((row) =>
    toCriticalIssueView(row, linkedPrsByIssueNumber.get(asNumber(row.number)) ?? [], profile.people.watchedUsers)
  );
  const pendingPrs: PendingPrView[] = prRows.map(toPendingPrView);

  const workflowViolations: WorkflowViolationView[] = violationRows.map((row) => ({
    objectType: asString(row.object_type) as WorkflowViolationView["objectType"],
    objectNumber: asNumber(row.object_number),
    title: asString(row.title),
    htmlUrl: asString(row.html_url),
    ruleKey: asString(row.rule_key),
    severity: asString(row.severity) as WorkflowViolationView["severity"],
    relatedLogin: row.related_login ? asString(row.related_login) : null,
    evidenceSummary: asString(row.evidence_summary),
    suggestedAction: asString(row.suggested_action),
    fixable: asNumber(row.fixable) === 1,
    firstDetectedAt: fromSqlDate(row.first_detected_at) ?? new Date().toISOString(),
    lastDetectedAt: fromSqlDate(row.last_detected_at) ?? new Date().toISOString()
  }));

  const aiDriftSignals: AiDriftSignalView[] = driftRows.map((row) => ({
    objectType: asString(row.object_type) as AiDriftSignalView["objectType"],
    objectNumber: asNumber(row.object_number),
    title: asString(row.title),
    htmlUrl: asString(row.html_url),
    ruleKey: asString(row.rule_key),
    severity: asString(row.severity) as AiDriftSignalView["severity"],
    ownerLogin: row.owner_login ? asString(row.owner_login) : null,
    aiEffortLabel: row.ai_effort_label ? asString(row.ai_effort_label) : null,
    expectedHours: row.expected_hours === null || row.expected_hours === undefined ? null : asNumber(row.expected_hours),
    actualHours: row.actual_hours === null || row.actual_hours === undefined ? null : asNumber(row.actual_hours),
    evidenceSummary: asString(row.evidence_summary),
    suggestedAction: asString(row.suggested_action),
    sourceCompleteness: asString(row.source_completeness) as AiDriftSignalView["sourceCompleteness"],
    firstDetectedAt: fromSqlDate(row.first_detected_at) ?? new Date().toISOString(),
    lastDetectedAt: fromSqlDate(row.last_detected_at) ?? new Date().toISOString()
  }));

  const people: PersonSummary[] = profile.people.watchedUsers.map((login) => {
    const ownedIssues = issueRows.filter((row) => row.owner_login === login && row.state === "open");
    const ownedPrs = allPrRows.filter((row) => row.owner_login === login);
    return {
      login,
      activeCriticalIssues: ownedIssues.filter((row) =>
        profile.labels.critical.includes(asString(row.severity))
      ).length,
      needsTriageIssues: ownedIssues.filter(
        (row) =>
          isPersonalNeedsTriageIssue(
            {
              lifecycleState: asString(row.lifecycle_state),
              severity: row.severity ? asString(row.severity) : null
            },
            profile.labels.critical
          )
      ).length,
      deferredIssues: ownedIssues.filter((row) => row.lifecycle_state === "deferred").length,
      prsCreatedYesterday: ownedPrs.filter((row) => inRange(row.created_at, start, end)).length,
      prsMergedYesterday: ownedPrs.filter((row) => inRange(row.merged_at, start, end)).length,
      pendingPrs: ownedPrs.filter((row) => row.state === "open").length,
      attentionPrs: ownedPrs.filter((row) => parseJsonArray(asString(row.attention_flags_json)).length > 0).length
    };
  });

  const syncHealth: SyncHealth[] = buildSyncHealthSummary(syncRows);

  const dailyMetrics: DailyMetricPoint[] = metricRows.map((row) => ({
    date: asString(row.metric_date),
    scopeType: asString(row.scope_type) as DailyMetricPoint["scopeType"],
    scopeKey: asString(row.scope_key),
    prsCreated: asNumber(row.prs_created),
    prsMerged: asNumber(row.prs_merged),
    issuesOpened: asNumber(row.issues_opened),
    issuesClosed: asNumber(row.issues_closed),
    issuesDeferred: asNumber(row.issues_deferred),
    workflowViolationsDetected: asNumber(row.workflow_violations_detected),
    sourceCompleteness: asString(row.source_completeness) as DailyMetricPoint["sourceCompleteness"],
    generatedAt: fromSqlDate(row.generated_at) ?? new Date().toISOString()
  }));
  const weeklyMetrics = aggregateMetricPoints(dailyMetrics, "week", profile.reporting.weekStart);
  const monthlyMetrics = aggregateMetricPoints(dailyMetrics, "month", profile.reporting.weekStart);
  const hiddenIssues = asNumber(hiddenIssueRows[0]?.hidden_issues);
  const hiddenPullRequests = asNumber(hiddenPrRows[0]?.hidden_pull_requests);
  const hiddenObjects = hiddenIssues + hiddenPullRequests;
  const analyticsLimitedByVisibility = hiddenObjects > 0;
  const peopleByLogin = new Map(people.map((person) => [person.login, person]));
  const personalPrs = personalPrRows.map(toPersonalPullRequestView);
  const personalViews: PersonalActionView[] = profile.people.watchedUsers.map((login) => {
    const ownedIssues = personalIssueRows.filter((row) => asString(row.owner_login) === login);
    const ownedPrs = personalPrs.filter((pr) => pr.ownerLogin === login);
    const pendingOwnedPrs = ownedPrs.filter((pr) => pr.state === "open");
    return {
      login,
      summary:
        peopleByLogin.get(login) ?? {
          login,
          activeCriticalIssues: 0,
          needsTriageIssues: 0,
          deferredIssues: 0,
          prsCreatedYesterday: 0,
          prsMergedYesterday: 0,
          pendingPrs: 0,
          attentionPrs: 0
        },
      activeCriticalIssues: ownedIssues
        .filter((row) => profile.labels.critical.includes(asString(row.severity)))
        .map((row) =>
          toCriticalIssueView(row, linkedPrsByIssueNumber.get(asNumber(row.number)) ?? [], profile.people.watchedUsers)
        ),
      needsTriageIssues: ownedIssues
        .filter((row) =>
          isPersonalNeedsTriageIssue(
            {
              lifecycleState: asString(row.lifecycle_state),
              severity: row.severity ? asString(row.severity) : null
            },
            profile.labels.critical
          )
        )
        .map(toPersonalIssueView),
      deferredIssues: ownedIssues
        .filter((row) => asString(row.lifecycle_state) === "deferred")
        .map(toPersonalIssueView),
      pendingPrs: pendingOwnedPrs,
      attentionPrs: pendingOwnedPrs.filter((pr) => pr.attentionFlags.length > 0),
      testingPrs: pendingOwnedPrs.filter((pr) =>
        ["test_requested", "testing", "test_changes_requested"].includes(pr.testingState)
      ),
      prsCreatedYesterday: ownedPrs.filter((pr) => inRange(pr.createdAt, start, end)),
      prsMergedYesterday: ownedPrs.filter((pr) => inRange(pr.mergedAt, start, end)),
      analytics: analyticsLimitedByVisibility
        ? []
        : dailyMetrics.filter((point) => point.scopeType === "person" && point.scopeKey === login),
      analyticsWeekly: analyticsLimitedByVisibility
        ? []
        : weeklyMetrics.filter((point) => point.scopeType === "person" && point.scopeKey === login),
      analyticsMonthly: analyticsLimitedByVisibility
        ? []
        : monthlyMetrics.filter((point) => point.scopeType === "person" && point.scopeKey === login)
    };
  });

  const visibility: DashboardVisibility = {
    scope: viewer.authenticated ? "logged_in" : "anonymous",
    visibleClasses,
    hiddenIssues,
    hiddenPullRequests,
    hiddenObjects,
    note:
      hiddenObjects > 0
        ? `${hiddenObjects} cached GitHub objects are hidden from this view by repository visibility policy.`
        : null
  };
  const analytics: AnalyticsSummary = {
    periodDays: 30,
    sourceNote: analyticsLimitedByVisibility
      ? "Trend data is hidden because pre-aggregated metrics may include cached objects outside the current visibility scope."
      : "Trend data is derived from the local MatrixOne cache. It is partial until issue, PR, review, and timeline backfill are complete.",
    teamDaily: analyticsLimitedByVisibility ? [] : dailyMetrics.filter((point) => point.scopeType === "team"),
    teamWeekly: analyticsLimitedByVisibility ? [] : weeklyMetrics.filter((point) => point.scopeType === "team"),
    teamMonthly: analyticsLimitedByVisibility ? [] : monthlyMetrics.filter((point) => point.scopeType === "team"),
    peopleDaily: analyticsLimitedByVisibility ? [] : dailyMetrics.filter((point) => point.scopeType === "person"),
    peopleWeekly: analyticsLimitedByVisibility ? [] : weeklyMetrics.filter((point) => point.scopeType === "person"),
    peopleMonthly: analyticsLimitedByVisibility ? [] : monthlyMetrics.filter((point) => point.scopeType === "person")
  };
  const testingQueueRows = allPrRows.filter((row) =>
    ["test_requested", "testing", "test_changes_requested"].includes(asString(row.testing_state))
  );
  const queueAges = testingQueueRows
    .map((row) => asNumber(row.testing_queue_age_hours))
    .filter((value) => Number.isFinite(value) && value > 0);
  const testerKeys = new Set([
    ...profile.people.testers,
    ...testingQueueRows.flatMap((row) => parseJsonArray(asString(row.testing_testers_json)))
  ]);
  const testing: TestingSummary = {
    queuePrs: testingQueueRows.length,
    staleQueuePrs: testingQueueRows.filter(
      (row) => asNumber(row.testing_queue_age_hours) >= profile.thresholds.prNoActionAttentionHours
    ).length,
    averageQueueAgeHours:
      queueAges.length === 0
        ? null
        : Math.round((queueAges.reduce((sum, value) => sum + value, 0) / queueAges.length) * 10) / 10,
    testers: Array.from(testerKeys).map((login) => {
      const rows = testingQueueRows.filter((row) => parseJsonArray(asString(row.testing_testers_json)).includes(login));
      const ages = rows
        .map((row) => asNumber(row.testing_queue_age_hours))
        .filter((value) => Number.isFinite(value) && value > 0);
      return {
        login,
        queuePrs: rows.length,
        averageQueueAgeHours:
          ages.length === 0 ? null : Math.round((ages.reduce((sum, value) => sum + value, 0) / ages.length) * 10) / 10
      };
    })
  };
  const jobQueue = await getJobQueueHealth();
  const worker: WorkerHealth = await getWorkerHealth();
  const notifications = await getNotificationHealth(repoId, profile);
  const webhooks = await getWebhookIngestionHealth(repoId);
  const criticalOwnershipCounts = criticalIssueOwnershipCounts(criticalIssues, profile.people.watchedUsers);
  const oldestSyncedAt = fromSqlDate(staleRows[0]?.oldest_synced_at);
  const oldestCacheAgeHours = oldestSyncedAt
    ? Math.max(0, Math.round(((Date.now() - new Date(oldestSyncedAt).getTime()) / 3_600_000) * 10) / 10)
    : null;

  return {
    repo: {
      key: profile.key,
      owner: profile.repo.owner,
      name: profile.repo.name,
      timezone: profile.reporting.timezone
    },
    profileWarnings: profileConfigurationWarnings(profile),
    visibility,
    sync: {
      generatedAt: new Date().toISOString(),
      health: syncHealth,
      staleObjects: asNumber(staleRows[0]?.stale_count),
      staleThresholdHours,
      oldestCacheAgeHours,
      partialObjects: asNumber(partialRows[0]?.partial_count),
      jobQueue,
      worker
    },
    counts: {
      criticalIssues: criticalIssues.length,
      unownedCriticalIssues: criticalOwnershipCounts.unownedCriticalIssues,
      nonWatchedCriticalIssues: criticalOwnershipCounts.nonWatchedCriticalIssues,
      pendingPrs: pendingPrs.length,
      attentionPrs: pendingPrs.filter((pr) => pr.attentionFlags.length > 0).length,
      workflowViolations: workflowViolations.length,
      criticalWorkflowViolations: workflowViolations.filter((violation) => violation.severity === "critical").length,
      aiDriftSignals: aiDriftSignals.length,
      criticalAiDriftSignals: aiDriftSignals.filter((signal) => signal.severity === "critical").length
    },
    criticalIssues,
    people,
    personalViews,
    pendingPrs,
    workflowViolations,
    aiDriftSignals,
    analytics,
    testing,
    notifications,
    webhooks
  };
}
