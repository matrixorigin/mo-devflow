import type {
  MetricSourceCompleteness,
  NotificationCandidate,
  NotificationDeliveryView,
  NotificationHealth,
  NotificationSourceType,
  NotificationStatus,
  RepoProfile
} from "@mo-devflow/shared";
import { notificationStatusRequiresAcknowledgement } from "@mo-devflow/shared";
import type { RowDataPacket } from "mysql2";
import { fromSqlDate, getPool, nowSql, sqlDate } from "./client";
import { addDaysToDateKey, dateKeyInTimezone } from "./time";
import { dashboardVisibilityFilter, visibleClassesForDashboard, type DashboardViewer } from "./visibility";

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

function isDuplicateError(error: unknown): boolean {
  const err = error as { code?: string; errno?: number; message?: string };
  return err.code === "ER_DUP_ENTRY" || err.errno === 1062 || (err.message ?? "").includes("Duplicate entry");
}

function githubObjectUrl(profile: RepoProfile, objectType: string, objectNumber: number | null): string | null {
  if (!objectNumber) {
    return null;
  }
  const segment = objectType === "pull_request" ? "pull" : "issues";
  return `https://github.com/${profile.repo.owner}/${profile.repo.name}/${segment}/${objectNumber}`;
}

function notificationObjectText(objectType: string, objectNumber: number | null): string {
  return objectNumber === null ? objectType : `${objectType} #${objectNumber}`;
}

export function notificationDashboardBaseUrlFromEnv(env: Record<string, string | undefined> = process.env): string {
  const rawUrl = env.MO_DEVFLOW_DASHBOARD_URL?.trim() || `http://localhost:${env.MO_DEVFLOW_WEB_PORT ?? "5173"}`;
  const url = new URL(rawUrl);
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

export function notificationDashboardUrl(
  baseUrl: string,
  sourceType: NotificationSourceType,
  objectType: string
): string {
  switch (sourceType) {
    case "workflow_violation":
      return `${baseUrl}/#violations`;
    case "ai_drift_signal":
      return `${baseUrl}/#drift`;
    case "attention_item":
      return objectType === "pull_request" ? `${baseUrl}/#prs` : `${baseUrl}/#overview`;
    case "daily_digest":
      return `${baseUrl}/#analytics`;
  }
}

function notificationSeverity(value: unknown): NotificationCandidate["severity"] {
  const severity = asString(value);
  if (severity === "critical" || severity === "warning" || severity === "info") {
    return severity;
  }
  return "warning";
}

function normalizedLogin(login: string): string {
  return login.trim().toLowerCase();
}

export function notificationRecipient(profile: RepoProfile, login: string | null): string {
  const loginKey = login ? normalizedLogin(login) : "";
  if (loginKey) {
    for (const [configuredLogin, employee] of Object.entries(profile.notifications.employees)) {
      if (normalizedLogin(configuredLogin) === loginKey && employee.wecomUserId.trim()) {
        return employee.wecomUserId;
      }
    }
  }
  return profile.notifications.routing.fallbackRecipient;
}

export function notificationRecipientScope(
  profile: RepoProfile,
  recipient: unknown
): NotificationDeliveryView["recipientScope"] {
  return asString(recipient) === profile.notifications.routing.fallbackRecipient ? "fallback" : "mapped_employee";
}

export function activeNotificationDeliverySourceWhereSql(deliveryAlias: "d" = "d"): string {
  return [
    "(",
    `${deliveryAlias}.source_type = 'daily_digest'`,
    `OR (${deliveryAlias}.source_type = 'attention_item' AND EXISTS (SELECT 1 FROM attention_items ai WHERE ai.repo_id = ${deliveryAlias}.repo_id AND ai.id = ${deliveryAlias}.source_id AND ai.resolved_at IS NULL))`,
    `OR (${deliveryAlias}.source_type = 'workflow_violation' AND EXISTS (SELECT 1 FROM workflow_violations wv WHERE wv.repo_id = ${deliveryAlias}.repo_id AND wv.id = ${deliveryAlias}.source_id AND wv.resolved_at IS NULL))`,
    `OR (${deliveryAlias}.source_type = 'ai_drift_signal' AND EXISTS (SELECT 1 FROM ai_drift_signals ad WHERE ad.repo_id = ${deliveryAlias}.repo_id AND ad.id = ${deliveryAlias}.source_id AND ad.resolved_at IS NULL))`,
    ")"
  ].join(" ");
}

export function notificationDeliveryVisibilityWhereSql(
  deliveryAlias: "d",
  profile: RepoProfile,
  viewer: DashboardViewer
): { sql: string; params: number[] } {
  const visibleClasses = visibleClassesForDashboard(profile, viewer);
  if (visibleClasses.length === 0) {
    return { sql: "1 = 0", params: [] };
  }

  const issueVisibility = dashboardVisibilityFilter("i", profile, viewer);
  const pullRequestVisibility = dashboardVisibilityFilter("p", profile, viewer);

  return {
    sql: [
      "(",
      `${deliveryAlias}.source_type = 'daily_digest'`,
      `OR ${deliveryAlias}.object_number IS NULL`,
      `OR (${deliveryAlias}.object_type = 'issue' AND EXISTS (SELECT 1 FROM issues i WHERE i.repo_id = ${deliveryAlias}.repo_id AND i.number = ${deliveryAlias}.object_number AND ${issueVisibility.sql}))`,
      `OR (${deliveryAlias}.object_type = 'pull_request' AND EXISTS (SELECT 1 FROM pull_requests p WHERE p.repo_id = ${deliveryAlias}.repo_id AND p.number = ${deliveryAlias}.object_number AND ${pullRequestVisibility.sql}))`,
      ")"
    ].join(" "),
    params: [...issueVisibility.params, ...pullRequestVisibility.params]
  };
}

export function notificationSourceObjectVisibilityWhereSql(
  sourceAlias: string,
  profile: RepoProfile,
  viewer: DashboardViewer = { authenticated: true, userId: null }
): { sql: string; params: number[] } {
  const issueVisibility = dashboardVisibilityFilter("i", profile, viewer);
  const pullRequestVisibility = dashboardVisibilityFilter("p", profile, viewer);

  return {
    sql: [
      "(",
      `${sourceAlias}.object_number IS NULL`,
      `OR (${sourceAlias}.object_type = 'issue' AND EXISTS (SELECT 1 FROM issues i WHERE i.repo_id = ${sourceAlias}.repo_id AND i.number = ${sourceAlias}.object_number AND ${issueVisibility.sql}))`,
      `OR (${sourceAlias}.object_type = 'pull_request' AND EXISTS (SELECT 1 FROM pull_requests p WHERE p.repo_id = ${sourceAlias}.repo_id AND p.number = ${sourceAlias}.object_number AND ${pullRequestVisibility.sql}))`,
      ")"
    ].join(" "),
    params: [...issueVisibility.params, ...pullRequestVisibility.params]
  };
}

export function excludedAttentionSourceWhereSql(
  attentionAlias: string,
  sourceIds: number[]
): { sql: string; params: number[] } {
  if (sourceIds.length === 0) {
    return { sql: "1 = 1", params: [] };
  }
  return {
    sql: `${attentionAlias}.id NOT IN (${sourceIds.map(() => "?").join(", ")})`,
    params: sourceIds
  };
}

function metricSourceCompleteness(value: unknown): MetricSourceCompleteness {
  return asString(value) === "complete_cache" ? "complete_cache" : "partial_cache";
}

export function dailyDigestMetricDate(timezone: string, now = new Date()): string {
  const today = dateKeyInTimezone(now, timezone);
  if (!today) {
    throw new Error(`Unable to derive daily digest date in timezone ${timezone}.`);
  }
  return addDaysToDateKey(today, -1);
}

export interface DailyDigestTeamMetrics {
  prsCreated: number;
  prsMerged: number;
  issuesOpened: number;
  issuesClosed: number;
  issuesDeferred: number;
  workflowViolationsDetected: number;
  sourceCompleteness: MetricSourceCompleteness;
}

export interface DailyDigestPersonMetrics {
  login: string;
  prsCreated: number;
  prsMerged: number;
  workflowViolationsDetected: number;
}

export function buildCriticalNotificationEscalationCandidate(input: {
  profile: RepoProfile;
  sourceId: number;
  ruleKey: string;
  objectType: string;
  objectNumber: number | null;
  dashboardUrl: string;
  htmlUrl: string | null;
  relatedLogin: string | null;
  evidenceSummary: string;
  firstDetectedAt: string;
  lastDetectedAt: string;
  lastSentAt: string;
  escalationHours: number;
}): NotificationCandidate {
  const objectText = notificationObjectText(input.objectType, input.objectNumber);
  return {
    sourceType: "attention_item",
    sourceId: input.sourceId,
    ruleKey: `${input.ruleKey}:escalation`,
    severity: "critical",
    objectType: input.objectType,
    objectNumber: input.objectNumber,
    title: `Escalation: ${objectText}`,
    htmlUrl: input.htmlUrl,
    dashboardUrl: input.dashboardUrl,
    relatedLogin: input.relatedLogin,
    recipient: input.profile.notifications.routing.fallbackRecipient,
    dedupeKey: `notification:attention_item_escalation:${input.sourceId}:${input.ruleKey}`,
    evidenceSummary:
      `${input.evidenceSummary}\nEscalation: the previous critical notification sent at ${input.lastSentAt} ` +
      `has remained unacknowledged for at least ${input.escalationHours}h.`,
    firstDetectedAt: input.firstDetectedAt,
    lastDetectedAt: input.lastDetectedAt
  };
}

export function buildDailyDigestNotificationCandidate(input: {
  profile: RepoProfile;
  metricDate: string;
  team: DailyDigestTeamMetrics;
  people: DailyDigestPersonMetrics[];
  generatedAt: string;
}): NotificationCandidate {
  const peopleSummary = input.people.length
    ? `\nWatched users: ${input.people
        .map(
          (person) =>
            `${person.login}: ${person.prsCreated} created, ${person.prsMerged} merged, ${person.workflowViolationsDetected} violations`
        )
        .join("; ")}.`
    : "";
  return {
    sourceType: "daily_digest",
    sourceId: 0,
    ruleKey: "daily_maintainer_digest",
    severity: "info",
    objectType: "digest",
    objectNumber: null,
    title: `Daily digest for ${input.profile.key} on ${input.metricDate}`,
    htmlUrl: `https://github.com/${input.profile.repo.owner}/${input.profile.repo.name}`,
    dashboardUrl: notificationDashboardUrl(notificationDashboardBaseUrlFromEnv(), "daily_digest", "digest"),
    relatedLogin: null,
    recipient: input.profile.notifications.routing.fallbackRecipient,
    dedupeKey: `notification:daily_digest:${input.profile.key}:${input.metricDate}`,
    evidenceSummary:
      `Team: ${input.team.prsCreated} PRs created, ${input.team.prsMerged} merged, ` +
      `${input.team.issuesOpened} issues opened, ${input.team.issuesClosed} closed, ${input.team.issuesDeferred} deferred.\n` +
      `Workflow violations detected: ${input.team.workflowViolationsDetected}.` +
      peopleSummary +
      `\nCache completeness: ${input.team.sourceCompleteness}.`,
    firstDetectedAt: input.generatedAt,
    lastDetectedAt: input.generatedAt
  };
}

async function getDailyDigestCandidate(
  repoId: number,
  profile: RepoProfile
): Promise<NotificationCandidate | null> {
  const metricDate = dailyDigestMetricDate(profile.reporting.timezone);
  const [metricRows] = await getPool().execute<RowData[]>(
    `SELECT *
     FROM daily_metrics
     WHERE repo_id = ? AND metric_date = ?
     ORDER BY scope_type ASC, scope_key ASC`,
    [repoId, metricDate]
  );
  const teamRow = metricRows.find((row) => asString(row.scope_type) === "team" && asString(row.scope_key) === "all");
  if (!teamRow) {
    return null;
  }
  const watchedUsers = new Set(profile.people.watchedUsers);
  const people = metricRows
    .filter((row) => asString(row.scope_type) === "person" && watchedUsers.has(asString(row.scope_key)))
    .map((row) => ({
      login: asString(row.scope_key),
      prsCreated: asNumber(row.prs_created),
      prsMerged: asNumber(row.prs_merged),
      workflowViolationsDetected: asNumber(row.workflow_violations_detected)
    }));

  return buildDailyDigestNotificationCandidate({
    profile,
    metricDate,
    team: {
      prsCreated: asNumber(teamRow.prs_created),
      prsMerged: asNumber(teamRow.prs_merged),
      issuesOpened: asNumber(teamRow.issues_opened),
      issuesClosed: asNumber(teamRow.issues_closed),
      issuesDeferred: asNumber(teamRow.issues_deferred),
      workflowViolationsDetected: asNumber(teamRow.workflow_violations_detected),
      sourceCompleteness: metricSourceCompleteness(teamRow.source_completeness)
    },
    people,
    generatedAt: fromSqlDate(teamRow.generated_at) ?? new Date().toISOString()
  });
}

export async function listNotificationCandidates(
  repoId: number,
  profile: RepoProfile,
  limit = 50
): Promise<NotificationCandidate[]> {
  if (limit <= 0) {
    return [];
  }
  const candidates: NotificationCandidate[] = [];
  const immediateLimit = limit > 1 ? limit - 1 : 1;
  const dashboardBaseUrl = notificationDashboardBaseUrlFromEnv();
  const escalationHours = profile.notifications.routing.escalateAfterHours;
  const escalationCutoff = sqlDate(new Date(Date.now() - escalationHours * 3_600_000));
  const attentionVisibility = notificationSourceObjectVisibilityWhereSql("a", profile);
  const escalatedAttentionIds: number[] = [];
  if (escalationCutoff) {
    const [escalationRows] = await getPool().execute<RowData[]>(
      `SELECT a.*, d.attempted_at AS last_sent_at
       FROM attention_items a
       JOIN (
         SELECT source_id, MAX(attempted_at) AS last_sent_at
         FROM notification_deliveries
         WHERE repo_id = ? AND source_type = 'attention_item' AND status = 'sent'
         GROUP BY source_id
       ) latest_sent ON latest_sent.source_id = a.id
       JOIN notification_deliveries d
         ON d.repo_id = a.repo_id
        AND d.source_type = 'attention_item'
        AND d.source_id = a.id
        AND d.status = 'sent'
        AND d.attempted_at = latest_sent.last_sent_at
       LEFT JOIN notification_acknowledgements ack ON ack.notification_delivery_id = d.id
       WHERE a.repo_id = ?
         AND a.resolved_at IS NULL
         AND a.severity = 'critical'
         AND ack.id IS NULL
         AND d.attempted_at <= ?
         AND ${attentionVisibility.sql}
       ORDER BY d.attempted_at ASC, a.last_detected_at DESC
       LIMIT ?`,
      [repoId, repoId, escalationCutoff, ...attentionVisibility.params, immediateLimit]
    );
    for (const row of escalationRows) {
      const objectNumber = row.object_number === null || row.object_number === undefined ? null : asNumber(row.object_number);
      const relatedLogin = row.related_login ? asString(row.related_login) : null;
      const sourceId = asNumber(row.id);
      escalatedAttentionIds.push(sourceId);
      candidates.push(
        buildCriticalNotificationEscalationCandidate({
          profile,
          sourceId,
          ruleKey: asString(row.rule_key),
          objectType: asString(row.object_type),
          objectNumber,
          dashboardUrl: asString(row.dashboard_url),
          htmlUrl: githubObjectUrl(profile, asString(row.object_type), objectNumber),
          relatedLogin,
          evidenceSummary: asString(row.evidence_summary),
          firstDetectedAt: fromSqlDate(row.first_detected_at) ?? new Date().toISOString(),
          lastDetectedAt: fromSqlDate(row.last_detected_at) ?? new Date().toISOString(),
          lastSentAt: fromSqlDate(row.last_sent_at) ?? new Date().toISOString(),
          escalationHours
        })
      );
    }
  }

  const remainingAfterEscalations = Math.max(0, immediateLimit - candidates.length);
  const attentionExclusion = excludedAttentionSourceWhereSql("a", escalatedAttentionIds);
  const [attentionRows] = await getPool().execute<RowData[]>(
    `SELECT *
     FROM attention_items a
     WHERE a.repo_id = ?
       AND a.resolved_at IS NULL
       AND ${attentionVisibility.sql}
       AND ${attentionExclusion.sql}
     ORDER BY
       CASE a.severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
       a.last_detected_at DESC
     LIMIT ?`,
    [repoId, ...attentionVisibility.params, ...attentionExclusion.params, remainingAfterEscalations]
  );
  for (const row of attentionRows) {
    const objectNumber = row.object_number === null || row.object_number === undefined ? null : asNumber(row.object_number);
    const relatedLogin = row.related_login ? asString(row.related_login) : null;
    candidates.push({
      sourceType: "attention_item",
      sourceId: asNumber(row.id),
      ruleKey: asString(row.rule_key),
      severity: notificationSeverity(row.severity),
      objectType: asString(row.object_type),
      objectNumber,
      title: notificationObjectText(asString(row.object_type), objectNumber),
      htmlUrl: githubObjectUrl(profile, asString(row.object_type), objectNumber),
      dashboardUrl: asString(row.dashboard_url),
      relatedLogin,
      recipient: notificationRecipient(profile, relatedLogin),
      dedupeKey: `notification:attention_item:${asNumber(row.id)}:${asString(row.rule_key)}`,
      evidenceSummary: asString(row.evidence_summary),
      firstDetectedAt: fromSqlDate(row.first_detected_at) ?? new Date().toISOString(),
      lastDetectedAt: fromSqlDate(row.last_detected_at) ?? new Date().toISOString()
    });
  }

  const remainingAfterAttention = Math.max(0, immediateLimit - candidates.length);
  if (remainingAfterAttention > 0) {
    const violationVisibility = notificationSourceObjectVisibilityWhereSql("v", profile);
    const [violationRows] = await getPool().execute<RowData[]>(
      `SELECT *
       FROM workflow_violations v
       WHERE v.repo_id = ? AND v.resolved_at IS NULL AND ${violationVisibility.sql}
       ORDER BY
         CASE v.severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
         v.last_detected_at DESC
       LIMIT ?`,
      [repoId, ...violationVisibility.params, remainingAfterAttention]
    );
    for (const row of violationRows) {
      const objectNumber = asNumber(row.object_number);
      const relatedLogin = row.related_login ? asString(row.related_login) : null;
      candidates.push({
        sourceType: "workflow_violation",
        sourceId: asNumber(row.id),
        ruleKey: asString(row.rule_key),
        severity: notificationSeverity(row.severity),
        objectType: asString(row.object_type),
        objectNumber,
        title: asString(row.title),
        htmlUrl: asString(row.html_url),
        dashboardUrl: notificationDashboardUrl(dashboardBaseUrl, "workflow_violation", asString(row.object_type)),
        relatedLogin,
        recipient: notificationRecipient(profile, relatedLogin),
        dedupeKey: `notification:workflow_violation:${asNumber(row.id)}:${asString(row.rule_key)}`,
        evidenceSummary: asString(row.evidence_summary),
        firstDetectedAt: fromSqlDate(row.first_detected_at) ?? new Date().toISOString(),
        lastDetectedAt: fromSqlDate(row.last_detected_at) ?? new Date().toISOString()
      });
    }
  }

  const remainingAfterViolations = Math.max(0, immediateLimit - candidates.length);
  if (remainingAfterViolations > 0) {
    const driftVisibility = notificationSourceObjectVisibilityWhereSql("d", profile);
    const [driftRows] = await getPool().execute<RowData[]>(
      `SELECT *
       FROM ai_drift_signals d
       WHERE d.repo_id = ? AND d.resolved_at IS NULL AND ${driftVisibility.sql}
       ORDER BY
         CASE d.severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
         d.actual_hours DESC,
         d.last_detected_at DESC
       LIMIT ?`,
      [repoId, ...driftVisibility.params, remainingAfterViolations]
    );
    for (const row of driftRows) {
      const objectNumber = asNumber(row.object_number);
      const ownerLogin = row.owner_login ? asString(row.owner_login) : null;
      candidates.push({
        sourceType: "ai_drift_signal",
        sourceId: asNumber(row.id),
        ruleKey: asString(row.rule_key),
        severity: notificationSeverity(row.severity),
        objectType: asString(row.object_type),
        objectNumber,
        title: asString(row.title),
        htmlUrl: asString(row.html_url),
        dashboardUrl: notificationDashboardUrl(dashboardBaseUrl, "ai_drift_signal", asString(row.object_type)),
        relatedLogin: ownerLogin,
        recipient: notificationRecipient(profile, ownerLogin),
        dedupeKey: `notification:ai_drift_signal:${asNumber(row.id)}:${asString(row.rule_key)}`,
        evidenceSummary: asString(row.evidence_summary),
        firstDetectedAt: fromSqlDate(row.first_detected_at) ?? new Date().toISOString(),
        lastDetectedAt: fromSqlDate(row.last_detected_at) ?? new Date().toISOString()
      });
    }
  }

  if (candidates.length < limit) {
    const digest = await getDailyDigestCandidate(repoId, profile);
    if (digest) {
      candidates.push(digest);
    }
  }

  return candidates;
}

export async function isNotificationInCooldown(
  dedupeKey: string,
  cooldownHours: number,
  statuses?: NotificationStatus[]
): Promise<boolean> {
  if (cooldownHours <= 0) {
    return false;
  }
  const statusFilter = statuses && statuses.length > 0 ? ` AND status IN (${statuses.map(() => "?").join(", ")})` : "";
  const [rows] = await getPool().execute<RowData[]>(
    `SELECT attempted_at
     FROM notification_deliveries
     WHERE dedupe_key = ?
       ${statusFilter}
     ORDER BY attempted_at DESC
     LIMIT 1`,
    statuses && statuses.length > 0 ? [dedupeKey, ...statuses] : [dedupeKey]
  );
  const attemptedAt = fromSqlDate(rows[0]?.attempted_at);
  if (!attemptedAt) {
    return false;
  }
  return Date.now() - new Date(attemptedAt).getTime() < cooldownHours * 3_600_000;
}

export async function recordNotificationDelivery(input: {
  repoId: number;
  candidate: NotificationCandidate;
  channel: string;
  status: NotificationStatus;
  dryRun: boolean;
  payload?: unknown;
  providerResponse?: unknown;
  errorMessage?: string | null;
}): Promise<void> {
  await getPool().execute(
    `INSERT INTO notification_deliveries(
      repo_id, attention_item_id, source_type, source_id, rule_key, object_type, object_number,
      dedupe_key, channel, recipient, status, dry_run, payload_json,
      provider_response, error_message, attempted_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.repoId,
      input.candidate.sourceType === "attention_item" ? input.candidate.sourceId : null,
      input.candidate.sourceType,
      input.candidate.sourceId,
      input.candidate.ruleKey,
      input.candidate.objectType,
      input.candidate.objectNumber,
      input.candidate.dedupeKey,
      input.channel,
      input.candidate.recipient,
      input.status,
      input.dryRun ? 1 : 0,
      input.payload ? stringify(input.payload) : null,
      input.providerResponse ? stringify(input.providerResponse) : null,
      input.errorMessage ?? null,
      nowSql()
    ]
  );
}

export type NotificationAcknowledgementResult =
  | {
      outcome: "acknowledged";
      deliveryId: number;
      acknowledgedAt: string;
      acknowledgedBy: string;
    }
  | {
      outcome: "not_acknowledgeable";
      deliveryId: number;
      deliveryStatus: NotificationStatus;
    }
  | {
      outcome: "not_found";
    };

export async function acknowledgeNotificationDelivery(input: {
  repoId: number;
  deliveryId: number;
  userId: number;
  githubLogin: string;
  profile: RepoProfile;
  viewer: DashboardViewer;
}): Promise<NotificationAcknowledgementResult> {
  const pool = getPool();
  const visibility = notificationDeliveryVisibilityWhereSql("d", input.profile, input.viewer);
  const [deliveryRows] = await pool.execute<RowData[]>(
    `SELECT *
     FROM notification_deliveries d
     WHERE d.id = ? AND d.repo_id = ? AND ${visibility.sql}
     LIMIT 1`,
    [input.deliveryId, input.repoId, ...visibility.params]
  );
  const delivery = deliveryRows[0];
  if (!delivery) {
    return { outcome: "not_found" };
  }

  const deliveryStatus = asString(delivery.status) as NotificationStatus;
  if (!notificationStatusRequiresAcknowledgement(deliveryStatus)) {
    return {
      outcome: "not_acknowledgeable",
      deliveryId: asNumber(delivery.id),
      deliveryStatus
    };
  }

  const acknowledgedAt = nowSql();
  try {
    await pool.execute(
      `INSERT INTO notification_acknowledgements(
        notification_delivery_id, repo_id, user_id, github_login,
        acknowledgement_source, acknowledged_at
      ) VALUES (?, ?, ?, ?, 'product_ui', ?)`,
      [input.deliveryId, input.repoId, input.userId, input.githubLogin, acknowledgedAt]
    );
  } catch (error) {
    if (!isDuplicateError(error)) {
      throw error;
    }
  }
  const [ackRows] = await pool.execute<RowData[]>(
    `SELECT github_login, acknowledged_at
     FROM notification_acknowledgements
     WHERE notification_delivery_id = ?
     LIMIT 1`,
    [input.deliveryId]
  );
  const acknowledgement = ackRows[0];

  return {
    outcome: "acknowledged",
    deliveryId: asNumber(delivery.id),
    acknowledgedAt: fromSqlDate(acknowledgement?.acknowledged_at) ?? fromSqlDate(acknowledgedAt) ?? new Date().toISOString(),
    acknowledgedBy: acknowledgement?.github_login ? asString(acknowledgement.github_login) : input.githubLogin
  };
}

export async function getNotificationHealth(input: {
  repoId: number;
  profile: RepoProfile;
  viewer: DashboardViewer;
}): Promise<NotificationHealth> {
  const activeSourceWhere = activeNotificationDeliverySourceWhereSql("d");
  const visibility = notificationDeliveryVisibilityWhereSql("d", input.profile, input.viewer);
  const [deliveryRows] = await getPool().execute<RowData[]>(
    `SELECT
       d.*,
       a.acknowledged_at,
       a.github_login AS acknowledged_by
     FROM notification_deliveries d
     LEFT JOIN notification_acknowledgements a ON a.notification_delivery_id = d.id
     WHERE d.repo_id = ? AND ${visibility.sql}
     ORDER BY d.attempted_at DESC
     LIMIT 20`,
    [input.repoId, ...visibility.params]
  );
  const [deliveryFailureRows] = await getPool().execute<RowData[]>(
    `SELECT COUNT(*) AS failed_count
     FROM notification_deliveries d
     WHERE d.repo_id = ? AND d.status = 'failed'
       AND ${activeSourceWhere}
       AND ${visibility.sql}`,
    [input.repoId, ...visibility.params]
  );
  const [unacknowledgedRows] = await getPool().execute<RowData[]>(
    `SELECT COUNT(*) AS unacknowledged_count
     FROM notification_deliveries d
     LEFT JOIN notification_acknowledgements a ON a.notification_delivery_id = d.id
     WHERE d.repo_id = ?
       AND d.status = 'sent'
       AND a.id IS NULL
       AND ${activeSourceWhere}
       AND ${visibility.sql}`,
    [input.repoId, ...visibility.params]
  );
  const escalationHours = input.profile.notifications.routing.escalateAfterHours;
  const escalationCutoff = sqlDate(new Date(Date.now() - escalationHours * 3_600_000));
  const escalationVisibility = notificationSourceObjectVisibilityWhereSql("a", input.profile, input.viewer);
  const [escalationRows] = await getPool().execute<RowData[]>(
    `SELECT COUNT(DISTINCT a.id) AS escalation_count
     FROM attention_items a
     JOIN (
       SELECT source_id, MAX(attempted_at) AS last_sent_at
       FROM notification_deliveries
       WHERE repo_id = ? AND source_type = 'attention_item' AND status = 'sent'
       GROUP BY source_id
     ) latest_sent ON latest_sent.source_id = a.id
     JOIN notification_deliveries d
       ON d.repo_id = a.repo_id
      AND d.source_type = 'attention_item'
      AND d.source_id = a.id
      AND d.status = 'sent'
      AND d.attempted_at = latest_sent.last_sent_at
     LEFT JOIN notification_acknowledgements ack ON ack.notification_delivery_id = d.id
     WHERE a.repo_id = ?
       AND a.resolved_at IS NULL
       AND a.severity = 'critical'
       AND ack.id IS NULL
       AND d.attempted_at <= ?
       AND ${escalationVisibility.sql}`,
    [input.repoId, input.repoId, escalationCutoff, ...escalationVisibility.params]
  );

  const lastDeliveries: NotificationDeliveryView[] = deliveryRows.map((row) => ({
    id: asNumber(row.id),
    sourceType: asString(row.source_type) as NotificationDeliveryView["sourceType"],
    ruleKey: asString(row.rule_key),
    objectType: asString(row.object_type),
    objectNumber: row.object_number === null || row.object_number === undefined ? null : asNumber(row.object_number),
    recipientScope: notificationRecipientScope(input.profile, row.recipient),
    channel: asString(row.channel),
    status: asString(row.status) as NotificationDeliveryView["status"],
    errorMessage: row.error_message ? asString(row.error_message) : null,
    attemptedAt: fromSqlDate(row.attempted_at) ?? new Date().toISOString(),
    acknowledgedAt: fromSqlDate(row.acknowledged_at),
    acknowledgedBy: row.acknowledged_by ? asString(row.acknowledged_by) : null
  }));

  return {
    enabled: input.profile.notifications.wecom.enabled,
    channel: "wecom",
    webhookConfigured: Boolean(
      input.profile.notifications.wecom.webhookUrlEnv && process.env[input.profile.notifications.wecom.webhookUrlEnv]
    ),
    cooldownHours: input.profile.notifications.routing.cooldownHours,
    escalateAfterHours: escalationHours,
    failedDeliveries: asNumber(deliveryFailureRows[0]?.failed_count),
    unacknowledgedDeliveries: asNumber(unacknowledgedRows[0]?.unacknowledged_count),
    escalationPendingDeliveries: asNumber(escalationRows[0]?.escalation_count),
    lastDeliveries
  };
}
