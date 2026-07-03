import type {
  AiDriftSignal,
  AiDriftSignalView,
  AnalyticsSummary,
  CriticalIssueView,
  DailyMetricPoint,
  DashboardSummary,
  NormalizedIssue,
  NormalizedPullRequest,
  PendingPrView,
  PersonSummary,
  RepoProfile,
  SyncHealth,
  TestingSummary,
  WorkflowViolation,
  WorkflowViolationView
} from "@mo-devflow/shared";
import { parseJsonArray, parseJsonRecord } from "@mo-devflow/shared";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { fromSqlDate, getPool, nowSql, sqlDate } from "./client";
import { getJobQueueHealth } from "./jobs";
import { getNotificationHealth } from "./notifications";
import { getWebhookIngestionHealth } from "./webhooks";

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

function mergeUnique(left: string[], right: string[]): string[] {
  return Array.from(new Set([...left, ...right]));
}

function isDuplicateError(error: unknown): boolean {
  const err = error as { code?: string; errno?: number; message?: string };
  return err.code === "ER_DUP_ENTRY" || err.errno === 1062 || (err.message ?? "").includes("Duplicate entry");
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
  status: "success" | "failed" | "partial";
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

export async function upsertPullRequest(repoId: number, pr: NormalizedPullRequest): Promise<void> {
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

function yesterdayRange(timezone: string): { start: Date; end: Date } {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  const parts = formatter.formatToParts(now);
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  const day = Number(parts.find((part) => part.type === "day")?.value);
  const todayUtc = new Date(Date.UTC(year, month - 1, day));
  const start = new Date(todayUtc.getTime() - 24 * 60 * 60 * 1000);
  const end = todayUtc;
  return { start, end };
}

function inRange(value: unknown, start: Date, end: Date): boolean {
  const iso = fromSqlDate(value);
  if (!iso) {
    return false;
  }
  const time = new Date(iso).getTime();
  return time >= start.getTime() && time < end.getTime();
}

function dateKeyInTimezone(value: unknown, timezone: string): string | null {
  const iso = fromSqlDate(value);
  if (!iso) {
    return null;
  }
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) {
    return null;
  }
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
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

export async function getDashboardSummary(profile: RepoProfile, repoId: number): Promise<DashboardSummary> {
  const pool = getPool();
  const [criticalRows] = await pool.execute<RowData[]>(
    `SELECT * FROM issues
     WHERE repo_id = ?
       AND state = 'open'
       AND severity IN (${profile.labels.critical.map(() => "?").join(", ")})
     ORDER BY updated_at ASC
     LIMIT 100`,
    [repoId, ...profile.labels.critical]
  );
  const [prRows] = await pool.execute<RowData[]>(
    `SELECT * FROM pull_requests
     WHERE repo_id = ? AND state = 'open'
     ORDER BY updated_at ASC
     LIMIT 300`,
    [repoId]
  );
  const [issueRows] = await pool.execute<RowData[]>(
    `SELECT owner_login, lifecycle_state, severity, state FROM issues WHERE repo_id = ?`,
    [repoId]
  );
  const [allPrRows] = await pool.execute<RowData[]>(
    `SELECT owner_login, created_at, merged_at, state, attention_flags_json,
            testing_state, testing_testers_json, testing_queue_age_hours
     FROM pull_requests WHERE repo_id = ?`,
    [repoId]
  );
  const [syncRows] = await pool.execute<RowData[]>(
    `SELECT sync_layer, status, started_at, finished_at, error_message
     FROM sync_runs
     WHERE repo_id = ?
     ORDER BY id DESC
     LIMIT 20`,
    [repoId]
  );
  const [partialRows] = await pool.execute<RowData[]>(
    `SELECT
       SUM(CASE WHEN is_complete = 0 THEN 1 ELSE 0 END) AS partial_count
     FROM (
       SELECT is_complete FROM issues WHERE repo_id = ?
       UNION ALL
       SELECT is_complete FROM pull_requests WHERE repo_id = ?
     ) t`,
    [repoId, repoId]
  );
  const [violationRows] = await pool.execute<RowData[]>(
    `SELECT *
     FROM workflow_violations
     WHERE repo_id = ? AND resolved_at IS NULL
     ORDER BY
       CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
       last_detected_at DESC
     LIMIT 100`,
    [repoId]
  );
  const [metricRows] = await pool.execute<RowData[]>(
    `SELECT *
     FROM daily_metrics
     WHERE repo_id = ?
     ORDER BY metric_date ASC, scope_type ASC, scope_key ASC`,
    [repoId]
  );
  const [driftRows] = await pool.execute<RowData[]>(
    `SELECT *
     FROM ai_drift_signals
     WHERE repo_id = ? AND resolved_at IS NULL
     ORDER BY
       CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
       actual_hours DESC,
       last_detected_at DESC
     LIMIT 100`,
    [repoId]
  );

  const criticalIssues: CriticalIssueView[] = criticalRows.map((row) => ({
    number: asNumber(row.number),
    title: asString(row.title),
    htmlUrl: asString(row.html_url),
    severity: row.severity ? asString(row.severity) : null,
    ownerLogin: row.owner_login ? asString(row.owner_login) : null,
    ownerReason: row.owner_reason ? asString(row.owner_reason) : null,
    lifecycleState: asString(row.lifecycle_state) as CriticalIssueView["lifecycleState"],
    ageHours:
      Math.max(
        0,
        Math.round(
          ((Date.now() - new Date(fromSqlDate(row.created_at) ?? new Date()).getTime()) / 3_600_000) * 10
        ) / 10
      ),
    lastSyncedAt: fromSqlDate(row.last_synced_at) ?? new Date().toISOString(),
    isComplete: asNumber(row.is_complete) === 1,
    labels: parseJsonArray(asString(row.labels_json))
  }));

  const pendingPrs: PendingPrView[] = prRows.map((row) => ({
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
  }));

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

  const { start, end } = yesterdayRange(profile.reporting.timezone);
  const people: PersonSummary[] = profile.people.watchedUsers.map((login) => {
    const ownedIssues = issueRows.filter((row) => row.owner_login === login && row.state === "open");
    const ownedPrs = allPrRows.filter((row) => row.owner_login === login);
    return {
      login,
      activeCriticalIssues: ownedIssues.filter((row) =>
        profile.labels.critical.includes(asString(row.severity))
      ).length,
      needsTriageIssues: ownedIssues.filter(
        (row) => row.lifecycle_state === "needs-triage" && !profile.labels.critical.includes(asString(row.severity))
      ).length,
      deferredIssues: ownedIssues.filter((row) => row.lifecycle_state === "deferred").length,
      prsCreatedYesterday: ownedPrs.filter((row) => inRange(row.created_at, start, end)).length,
      prsMergedYesterday: ownedPrs.filter((row) => inRange(row.merged_at, start, end)).length,
      pendingPrs: ownedPrs.filter((row) => row.state === "open").length,
      attentionPrs: ownedPrs.filter((row) => parseJsonArray(asString(row.attention_flags_json)).length > 0).length
    };
  });

  const syncHealth: SyncHealth[] = syncRows.map((row) => ({
    layer: asString(row.sync_layer),
    status: asString(row.status),
    lastSuccessfulAt: row.status === "success" ? fromSqlDate(row.finished_at) : null,
    lastAttemptedAt: fromSqlDate(row.started_at),
    errorMessage: row.error_message ? asString(row.error_message) : null
  }));

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

  const analytics: AnalyticsSummary = {
    periodDays: 30,
    sourceNote:
      "Trend data is derived from the local MatrixOne cache. It is partial until issue, PR, review, and timeline backfill are complete.",
    teamDaily: dailyMetrics.filter((point) => point.scopeType === "team"),
    peopleDaily: dailyMetrics.filter((point) => point.scopeType === "person")
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
  const notifications = await getNotificationHealth(repoId, profile);
  const webhooks = await getWebhookIngestionHealth(repoId);

  return {
    repo: {
      key: profile.key,
      owner: profile.repo.owner,
      name: profile.repo.name,
      timezone: profile.reporting.timezone
    },
    sync: {
      generatedAt: new Date().toISOString(),
      health: syncHealth,
      staleObjects: 0,
      partialObjects: asNumber(partialRows[0]?.partial_count),
      jobQueue
    },
    counts: {
      criticalIssues: criticalIssues.length,
      unownedCriticalIssues: criticalIssues.filter((issue) => !issue.ownerLogin).length,
      pendingPrs: pendingPrs.length,
      attentionPrs: pendingPrs.filter((pr) => pr.attentionFlags.length > 0).length,
      workflowViolations: workflowViolations.length,
      criticalWorkflowViolations: workflowViolations.filter((violation) => violation.severity === "critical").length,
      aiDriftSignals: aiDriftSignals.length,
      criticalAiDriftSignals: aiDriftSignals.filter((signal) => signal.severity === "critical").length
    },
    criticalIssues,
    people,
    pendingPrs,
    workflowViolations,
    aiDriftSignals,
    analytics,
    testing,
    notifications,
    webhooks
  };
}
