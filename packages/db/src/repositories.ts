import type {
  CriticalIssueView,
  DashboardSummary,
  NormalizedIssue,
  NormalizedPullRequest,
  PendingPrView,
  PersonSummary,
  RepoProfile,
  SyncHealth
} from "@mo-devflow/shared";
import { parseJsonArray } from "@mo-devflow/shared";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { fromSqlDate, getPool, nowSql, sqlDate } from "./client";

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
      assignees_json, requested_reviewers_json, age_hours, last_human_action_at,
      last_system_action_at, review_decision, merge_state_status, ci_state,
      latest_review_state, latest_review_submitted_at, latest_commit_at,
      detail_synced_at, detail_error, attention_flags_json, source_auth_type,
      visibility_class, is_complete, sync_error, raw_payload, last_synced_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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

export async function runWithJobLease<T>(
  jobKey: string,
  jobType: string,
  handler: () => Promise<T>
): Promise<T | null> {
  const pool = getPool();
  const now = nowSql();
  const leaseOwner = `${process.pid}-${Math.random().toString(16).slice(2)}`;
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
         lease_expires_at = DATE_ADD(UTC_TIMESTAMP(), INTERVAL 10 MINUTE),
         attempts = attempts + 1,
         updated_at = UTC_TIMESTAMP()
     WHERE job_key = ?
       AND (lease_expires_at IS NULL OR lease_expires_at < UTC_TIMESTAMP() OR status IN ('pending', 'failed', 'complete'))`,
    [leaseOwner, jobKey]
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
           updated_at = UTC_TIMESTAMP()
       WHERE job_key = ? AND lease_owner = ?`,
      [jobKey, leaseOwner]
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
    `SELECT owner_login, created_at, merged_at, state, attention_flags_json FROM pull_requests WHERE repo_id = ?`,
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
    attentionFlags: parseJsonArray(asString(row.attention_flags_json)),
    isComplete: asNumber(row.is_complete) === 1
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
      partialObjects: asNumber(partialRows[0]?.partial_count)
    },
    counts: {
      criticalIssues: criticalIssues.length,
      unownedCriticalIssues: criticalIssues.filter((issue) => !issue.ownerLogin).length,
      pendingPrs: pendingPrs.length,
      attentionPrs: pendingPrs.filter((pr) => pr.attentionFlags.length > 0).length
    },
    criticalIssues,
    people,
    pendingPrs
  };
}
