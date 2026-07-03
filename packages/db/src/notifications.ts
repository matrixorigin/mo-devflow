import type {
  MetricSourceCompleteness,
  NotificationCandidate,
  NotificationDeliveryView,
  NotificationHealth,
  NotificationStatus,
  RepoProfile
} from "@mo-devflow/shared";
import type { RowDataPacket } from "mysql2";
import { fromSqlDate, getPool, nowSql } from "./client";

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

function notificationSeverity(value: unknown): NotificationCandidate["severity"] {
  const severity = asString(value);
  if (severity === "critical" || severity === "warning" || severity === "info") {
    return severity;
  }
  return "warning";
}

function notificationRecipient(profile: RepoProfile, login: string | null): string {
  if (login && profile.notifications.employees[login]?.wecomUserId) {
    return profile.notifications.employees[login].wecomUserId;
  }
  return profile.notifications.routing.fallbackRecipient;
}

function recipientScope(profile: RepoProfile, recipient: unknown): NotificationDeliveryView["recipientScope"] {
  return asString(recipient) === profile.notifications.routing.fallbackRecipient ? "fallback" : "mapped_employee";
}

function metricSourceCompleteness(value: unknown): MetricSourceCompleteness {
  return asString(value) === "complete_cache" ? "complete_cache" : "partial_cache";
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

async function getLatestDailyDigestCandidate(
  repoId: number,
  profile: RepoProfile
): Promise<NotificationCandidate | null> {
  const [dateRows] = await getPool().execute<RowData[]>(
    "SELECT MAX(metric_date) AS metric_date FROM daily_metrics WHERE repo_id = ?",
    [repoId]
  );
  const metricDate = dateRows[0]?.metric_date ? asString(dateRows[0].metric_date) : "";
  if (!metricDate) {
    return null;
  }
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
  const [attentionRows] = await getPool().execute<RowData[]>(
    `SELECT *
     FROM attention_items
     WHERE repo_id = ? AND resolved_at IS NULL
     ORDER BY
       CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
       last_detected_at DESC
     LIMIT ?`,
    [repoId, immediateLimit]
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
      title: `${asString(row.object_type)} ${objectNumber ?? ""}`.trim(),
      htmlUrl: githubObjectUrl(profile, asString(row.object_type), objectNumber),
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
    const [violationRows] = await getPool().execute<RowData[]>(
      `SELECT *
       FROM workflow_violations
       WHERE repo_id = ? AND resolved_at IS NULL
       ORDER BY
         CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
         last_detected_at DESC
       LIMIT ?`,
      [repoId, remainingAfterAttention]
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
    const [driftRows] = await getPool().execute<RowData[]>(
      `SELECT *
       FROM ai_drift_signals
       WHERE repo_id = ? AND resolved_at IS NULL
       ORDER BY
         CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
         actual_hours DESC,
         last_detected_at DESC
       LIMIT ?`,
      [repoId, remainingAfterViolations]
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
    const digest = await getLatestDailyDigestCandidate(repoId, profile);
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

export async function acknowledgeNotificationDelivery(input: {
  repoId: number;
  deliveryId: number;
  userId: number;
  githubLogin: string;
}): Promise<{ deliveryId: number; acknowledgedAt: string; acknowledgedBy: string } | null> {
  const pool = getPool();
  const [deliveryRows] = await pool.execute<RowData[]>(
    `SELECT *
     FROM notification_deliveries
     WHERE id = ? AND repo_id = ?
     LIMIT 1`,
    [input.deliveryId, input.repoId]
  );
  const delivery = deliveryRows[0];
  if (!delivery) {
    return null;
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
    deliveryId: asNumber(delivery.id),
    acknowledgedAt: fromSqlDate(acknowledgement?.acknowledged_at) ?? fromSqlDate(acknowledgedAt) ?? new Date().toISOString(),
    acknowledgedBy: acknowledgement?.github_login ? asString(acknowledgement.github_login) : input.githubLogin
  };
}

export async function getNotificationHealth(repoId: number, profile: RepoProfile): Promise<NotificationHealth> {
  const [deliveryRows] = await getPool().execute<RowData[]>(
    `SELECT
       d.*,
       a.acknowledged_at,
       a.github_login AS acknowledged_by
     FROM notification_deliveries d
     LEFT JOIN notification_acknowledgements a ON a.notification_delivery_id = d.id
     WHERE d.repo_id = ?
     ORDER BY d.attempted_at DESC
     LIMIT 20`,
    [repoId]
  );
  const [deliveryFailureRows] = await getPool().execute<RowData[]>(
    `SELECT COUNT(*) AS failed_count
     FROM notification_deliveries
     WHERE repo_id = ? AND status = 'failed'`,
    [repoId]
  );
  const [unacknowledgedRows] = await getPool().execute<RowData[]>(
    `SELECT COUNT(*) AS unacknowledged_count
     FROM notification_deliveries d
     LEFT JOIN notification_acknowledgements a ON a.notification_delivery_id = d.id
     WHERE d.repo_id = ?
       AND a.id IS NULL`,
    [repoId]
  );

  const lastDeliveries: NotificationDeliveryView[] = deliveryRows.map((row) => ({
    id: asNumber(row.id),
    sourceType: asString(row.source_type) as NotificationDeliveryView["sourceType"],
    ruleKey: asString(row.rule_key),
    objectType: asString(row.object_type),
    objectNumber: row.object_number === null || row.object_number === undefined ? null : asNumber(row.object_number),
    recipientScope: recipientScope(profile, row.recipient),
    channel: asString(row.channel),
    status: asString(row.status) as NotificationDeliveryView["status"],
    errorMessage: row.error_message ? asString(row.error_message) : null,
    attemptedAt: fromSqlDate(row.attempted_at) ?? new Date().toISOString(),
    acknowledgedAt: fromSqlDate(row.acknowledged_at),
    acknowledgedBy: row.acknowledged_by ? asString(row.acknowledged_by) : null
  }));

  return {
    enabled: profile.notifications.wecom.enabled,
    channel: "wecom",
    webhookConfigured: Boolean(profile.notifications.wecom.webhookUrlEnv && process.env[profile.notifications.wecom.webhookUrlEnv]),
    cooldownHours: profile.notifications.routing.cooldownHours,
    failedDeliveries: asNumber(deliveryFailureRows[0]?.failed_count),
    unacknowledgedDeliveries: asNumber(unacknowledgedRows[0]?.unacknowledged_count),
    lastDeliveries
  };
}
