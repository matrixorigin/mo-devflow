import type {
  MetricSourceCompleteness,
  NotificationCandidate,
  NotificationDeliveryView,
  NotificationHealth,
  NotificationReadiness,
  NotificationSourceType,
  NotificationStatus,
  RepoProfile
} from "@mo-devflow/shared";
import { notificationStatusAllowsRetry, notificationStatusRequiresAcknowledgement } from "@mo-devflow/shared";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
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
  objectType: string,
  objectNumber: number | null = null,
  sourceId: number | null = null
): string {
  const urlForHash = (view: string, params: Record<string, string | number | null | undefined> = {}) => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== null && value !== undefined && String(value).length > 0) {
        query.set(key, String(value));
      }
    }
    const queryText = query.toString();
    return `${baseUrl}/#${view}${queryText ? `?${queryText}` : ""}`;
  };

  switch (sourceType) {
    case "workflow_violation":
      return urlForHash("violations", {
        source_id: sourceId,
        object_type: objectType,
        object_number: objectNumber
      });
    case "ai_drift_signal":
      return urlForHash("drift", {
        source_id: sourceId,
        object_type: objectType,
        object_number: objectNumber
      });
    case "attention_item":
      if (objectType === "pull_request") {
        return urlForHash("prs", { pr: objectNumber });
      }
      if (objectType === "issue") {
        return urlForHash("issues", { issue: objectNumber });
      }
      return urlForHash("overview");
    case "daily_digest":
    case "weekly_digest":
    case "monthly_digest":
      return urlForHash("analytics");
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
    `${deliveryAlias}.source_type IN ('daily_digest', 'weekly_digest', 'monthly_digest')`,
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
      `${deliveryAlias}.source_type IN ('daily_digest', 'weekly_digest', 'monthly_digest')`,
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

export function notificationImmediateLimit(limit: number): number {
  if (limit <= 1) {
    return 1;
  }
  const digestSlots = Math.min(3, Math.max(0, limit - 1));
  return Math.max(1, limit - digestSlots);
}

const digestMetricColumns = [
  "scope_type",
  "scope_key",
  "prs_created",
  "prs_merged",
  "issues_opened",
  "issues_closed",
  "issues_deferred",
  "workflow_violations_detected",
  "source_completeness",
  "generated_at"
].join(", ");

function dateKeySpanDays(start: string, end: string): number {
  const startMs = new Date(`${start}T00:00:00.000Z`).getTime();
  const endMs = new Date(`${end}T00:00:00.000Z`).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return 1;
  }
  return Math.max(1, Math.ceil((endMs - startMs) / 86_400_000));
}

function digestMetricRowLimit(days: number, people: readonly string[]): number {
  return Math.max(1, Math.ceil(days) * (people.length + 1) + 10);
}

const attentionCandidateColumns = [
  "a.id",
  "a.rule_key",
  "a.object_type",
  "a.object_number",
  "a.severity",
  "a.related_login",
  "a.dashboard_url",
  "a.evidence_summary",
  "a.first_detected_at",
  "a.last_detected_at"
].join(", ");

const workflowViolationCandidateColumns = [
  "v.id",
  "v.rule_key",
  "v.object_type",
  "v.object_number",
  "v.title",
  "v.html_url",
  "v.severity",
  "v.related_login",
  "v.evidence_summary",
  "v.first_detected_at",
  "v.last_detected_at"
].join(", ");

const aiDriftCandidateColumns = [
  "d.id",
  "d.rule_key",
  "d.object_type",
  "d.object_number",
  "d.title",
  "d.html_url",
  "d.severity",
  "d.owner_login",
  "d.evidence_summary",
  "d.first_detected_at",
  "d.last_detected_at"
].join(", ");

const notificationDeliveryRetryColumns = [
  "d.id",
  "d.attention_item_id",
  "d.source_type",
  "d.source_id",
  "d.rule_key",
  "d.object_type",
  "d.object_number",
  "d.dashboard_url",
  "d.dedupe_key",
  "d.channel",
  "d.recipient"
].join(", ");

const notificationDeliveryHealthColumns = [
  "d.id",
  "d.source_type",
  "d.rule_key",
  "d.object_type",
  "d.object_number",
  "d.dashboard_url",
  "d.recipient",
  "d.channel",
  "d.status",
  "d.error_message",
  "d.attempted_at"
].join(", ");

export const PERMANENT_NOTIFICATION_FAILURE_COOLDOWN_HOURS = 24 * 365 * 10;
const TRANSIENT_NOTIFICATION_FAILURE_BASE_COOLDOWN_HOURS = 0.25;
export const notificationDeliveryCooldownStatuses: NotificationStatus[] = [
  "sent",
  "failed_transient",
  "failed_permanent",
  "retry_requested",
  "dry_run"
];

export function notificationDeliveryCooldownHours(
  deliveries: Array<{ status: NotificationStatus }>,
  configuredCooldownHours: number
): number | null {
  const latest = deliveries[0]?.status;
  if (!latest) {
    return null;
  }
  if (latest === "failed_permanent") {
    return PERMANENT_NOTIFICATION_FAILURE_COOLDOWN_HOURS;
  }
  if (latest === "failed_transient") {
    const transientFailures = deliveries.findIndex((delivery) => delivery.status !== "failed_transient");
    const failureCount = transientFailures === -1 ? deliveries.length : transientFailures;
    const backoffHours = TRANSIENT_NOTIFICATION_FAILURE_BASE_COOLDOWN_HOURS * 2 ** Math.max(0, failureCount - 1);
    return Math.min(Math.max(0, configuredCooldownHours), backoffHours);
  }
  if (latest === "sent" || latest === "dry_run") {
    return configuredCooldownHours;
  }
  return null;
}

export function notificationReadiness(input: {
  profile: RepoProfile;
  env?: Record<string, string | undefined>;
  missingEmployeeMappings: number;
}): NotificationReadiness {
  const env = input.env ?? process.env;
  const webhookEnvVar = input.profile.notifications.wecom.webhookUrlEnv ?? null;
  const webhookConfigured = Boolean(webhookEnvVar && env[webhookEnvVar]?.trim());
  const mappedEmployees = Object.values(input.profile.notifications.employees).filter(
    (employee) => employee.wecomUserId.trim().length > 0
  ).length;
  const blockers: string[] = [];
  const warnings: string[] = [];

  if (!input.profile.notifications.wecom.enabled) {
    blockers.push("WeCom delivery is disabled in the repository profile.");
  } else {
    if (!webhookEnvVar) {
      blockers.push("notifications.wecom.webhook_url_env is not configured in the repository profile.");
    } else if (!webhookConfigured) {
      blockers.push(`${webhookEnvVar} is not set in the API or worker environment.`);
    }
    if (!input.profile.notifications.routing.fallbackRecipient.trim()) {
      blockers.push("notifications routing fallback_recipient is empty.");
    }
  }

  if (input.missingEmployeeMappings > 0) {
    warnings.push(
      `${input.missingEmployeeMappings} owner-routed notification recipients are missing employee mappings and will use fallback routing.`
    );
  }

  const status = !input.profile.notifications.wecom.enabled
    ? "disabled"
    : blockers.length > 0
      ? "action_required"
      : warnings.length > 0
        ? "degraded"
        : "ready";

  return {
    status,
    blockers,
    warnings,
    webhookEnvVar,
    mappedEmployees,
    missingEmployeeMappings: input.missingEmployeeMappings,
    fallbackRecipient: input.profile.notifications.routing.fallbackRecipient
  };
}

function metricSourceCompleteness(value: unknown): MetricSourceCompleteness {
  return asString(value) === "complete_cache" ? "complete_cache" : "partial_cache";
}

function emptyDigestTeamMetrics(): DailyDigestTeamMetrics {
  return {
    prsCreated: 0,
    prsMerged: 0,
    issuesOpened: 0,
    issuesClosed: 0,
    issuesDeferred: 0,
    workflowViolationsDetected: 0,
    sourceCompleteness: "complete_cache"
  };
}

function addDigestMetrics(target: DailyDigestTeamMetrics, row: RowData): void {
  target.prsCreated += asNumber(row.prs_created);
  target.prsMerged += asNumber(row.prs_merged);
  target.issuesOpened += asNumber(row.issues_opened);
  target.issuesClosed += asNumber(row.issues_closed);
  target.issuesDeferred += asNumber(row.issues_deferred);
  target.workflowViolationsDetected += asNumber(row.workflow_violations_detected);
  if (metricSourceCompleteness(row.source_completeness) === "partial_cache") {
    target.sourceCompleteness = "partial_cache";
  }
}

function latestGeneratedAt(rows: RowData[]): string {
  let latest: string | null = null;
  for (const row of rows) {
    const generatedAt = fromSqlDate(row.generated_at);
    if (!generatedAt) {
      continue;
    }
    if (!latest || new Date(generatedAt).getTime() > new Date(latest).getTime()) {
      latest = generatedAt;
    }
  }
  return latest ?? new Date().toISOString();
}

export function dailyDigestMetricDate(timezone: string, now = new Date()): string {
  const today = dateKeyInTimezone(now, timezone);
  if (!today) {
    throw new Error(`Unable to derive daily digest date in timezone ${timezone}.`);
  }
  return addDaysToDateKey(today, -1);
}

function dateFromDateKey(dateKey: string): Date {
  return new Date(`${dateKey}T00:00:00.000Z`);
}

function weekStartDateKey(dateKey: string, weekStart: RepoProfile["reporting"]["weekStart"]): string {
  const date = dateFromDateKey(dateKey);
  const day = date.getUTCDay();
  const offset = weekStart === "Monday" ? (day === 0 ? 6 : day - 1) : day;
  date.setUTCDate(date.getUTCDate() - offset);
  return date.toISOString().slice(0, 10);
}

function addMonthsToDateKey(dateKey: string, months: number): string {
  const date = dateFromDateKey(dateKey);
  date.setUTCMonth(date.getUTCMonth() + months);
  return date.toISOString().slice(0, 10);
}

function monthStartDateKey(dateKey: string): string {
  return `${dateKey.slice(0, 7)}-01`;
}

export function weeklyDigestPeriod(
  timezone: string,
  weekStart: RepoProfile["reporting"]["weekStart"],
  now = new Date()
): { start: string; end: string; label: string } {
  const today = dateKeyInTimezone(now, timezone);
  if (!today) {
    throw new Error(`Unable to derive weekly digest period in timezone ${timezone}.`);
  }
  const currentWeekStart = weekStartDateKey(today, weekStart);
  const start = addDaysToDateKey(currentWeekStart, -7);
  const end = currentWeekStart;
  return {
    start,
    end,
    label: `${start} to ${addDaysToDateKey(end, -1)}`
  };
}

export function monthlyDigestPeriod(timezone: string, now = new Date()): { start: string; end: string; label: string } {
  const today = dateKeyInTimezone(now, timezone);
  if (!today) {
    throw new Error(`Unable to derive monthly digest period in timezone ${timezone}.`);
  }
  const currentMonthStart = monthStartDateKey(today);
  const start = addMonthsToDateKey(currentMonthStart, -1);
  return {
    start,
    end: currentMonthStart,
    label: start.slice(0, 7)
  };
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

interface DigestPeriod {
  start: string;
  end: string;
  label: string;
}

function digestEvidenceSummary(team: DailyDigestTeamMetrics, people: DailyDigestPersonMetrics[]): string {
  const peopleSummary = people.length
    ? `\nWatched users: ${people
        .map(
          (person) =>
            `${person.login}: ${person.prsCreated} created, ${person.prsMerged} merged, ${person.workflowViolationsDetected} violations`
        )
        .join("; ")}.`
    : "";
  return (
    `Team: ${team.prsCreated} PRs created, ${team.prsMerged} merged, ` +
    `${team.issuesOpened} issues opened, ${team.issuesClosed} closed, ${team.issuesDeferred} deferred.\n` +
    `Workflow violations detected: ${team.workflowViolationsDetected}.` +
    peopleSummary +
    `\nCache completeness: ${team.sourceCompleteness}.`
  );
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
    evidenceSummary: digestEvidenceSummary(input.team, input.people),
    firstDetectedAt: input.generatedAt,
    lastDetectedAt: input.generatedAt
  };
}

export function buildWeeklyDigestNotificationCandidate(input: {
  profile: RepoProfile;
  period: DigestPeriod;
  team: DailyDigestTeamMetrics;
  people: DailyDigestPersonMetrics[];
  generatedAt: string;
}): NotificationCandidate {
  return {
    sourceType: "weekly_digest",
    sourceId: 0,
    ruleKey: "weekly_maintainer_digest",
    severity: "info",
    objectType: "digest",
    objectNumber: null,
    title: `Weekly digest for ${input.profile.key} on ${input.period.label}`,
    htmlUrl: `https://github.com/${input.profile.repo.owner}/${input.profile.repo.name}`,
    dashboardUrl: notificationDashboardUrl(notificationDashboardBaseUrlFromEnv(), "weekly_digest", "digest"),
    relatedLogin: null,
    recipient: input.profile.notifications.routing.fallbackRecipient,
    dedupeKey: `notification:weekly_digest:${input.profile.key}:${input.period.start}`,
    evidenceSummary: digestEvidenceSummary(input.team, input.people),
    firstDetectedAt: input.generatedAt,
    lastDetectedAt: input.generatedAt
  };
}

export function buildMonthlyDigestNotificationCandidate(input: {
  profile: RepoProfile;
  period: DigestPeriod;
  team: DailyDigestTeamMetrics;
  people: DailyDigestPersonMetrics[];
  generatedAt: string;
}): NotificationCandidate {
  return {
    sourceType: "monthly_digest",
    sourceId: 0,
    ruleKey: "monthly_maintainer_digest",
    severity: "info",
    objectType: "digest",
    objectNumber: null,
    title: `Monthly digest for ${input.profile.key} on ${input.period.label}`,
    htmlUrl: `https://github.com/${input.profile.repo.owner}/${input.profile.repo.name}`,
    dashboardUrl: notificationDashboardUrl(notificationDashboardBaseUrlFromEnv(), "monthly_digest", "digest"),
    relatedLogin: null,
    recipient: input.profile.notifications.routing.fallbackRecipient,
    dedupeKey: `notification:monthly_digest:${input.profile.key}:${input.period.start}`,
    evidenceSummary: digestEvidenceSummary(input.team, input.people),
    firstDetectedAt: input.generatedAt,
    lastDetectedAt: input.generatedAt
  };
}

async function getDailyDigestCandidate(repoId: number, profile: RepoProfile): Promise<NotificationCandidate | null> {
  const metricDate = dailyDigestMetricDate(profile.reporting.timezone);
  const [metricRows] = await getPool().execute<RowData[]>(
    `SELECT ${digestMetricColumns}
     FROM daily_metrics
     WHERE repo_id = ? AND metric_date = ?
     ORDER BY scope_type ASC, scope_key ASC
     LIMIT ?`,
    [repoId, metricDate, digestMetricRowLimit(1, profile.people.watchedUsers)]
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

async function getPeriodDigestMetrics(
  repoId: number,
  profile: RepoProfile,
  period: DigestPeriod
): Promise<{ team: DailyDigestTeamMetrics; people: DailyDigestPersonMetrics[]; generatedAt: string } | null> {
  const [metricRows] = await getPool().execute<RowData[]>(
    `SELECT ${digestMetricColumns}
     FROM daily_metrics
     WHERE repo_id = ? AND metric_date >= ? AND metric_date < ?
     ORDER BY metric_date ASC, scope_type ASC, scope_key ASC
     LIMIT ?`,
    [
      repoId,
      period.start,
      period.end,
      digestMetricRowLimit(dateKeySpanDays(period.start, period.end), profile.people.watchedUsers)
    ]
  );
  const teamRows = metricRows.filter((row) => asString(row.scope_type) === "team" && asString(row.scope_key) === "all");
  if (teamRows.length === 0) {
    return null;
  }

  const team = emptyDigestTeamMetrics();
  for (const row of teamRows) {
    addDigestMetrics(team, row);
  }

  const watchedUsers = new Set(profile.people.watchedUsers);
  const peopleByLogin = new Map<string, DailyDigestPersonMetrics>();
  for (const row of metricRows) {
    const login = asString(row.scope_key);
    if (asString(row.scope_type) !== "person" || !watchedUsers.has(login)) {
      continue;
    }
    const person = peopleByLogin.get(login) ?? {
      login,
      prsCreated: 0,
      prsMerged: 0,
      workflowViolationsDetected: 0
    };
    person.prsCreated += asNumber(row.prs_created);
    person.prsMerged += asNumber(row.prs_merged);
    person.workflowViolationsDetected += asNumber(row.workflow_violations_detected);
    peopleByLogin.set(login, person);
  }

  return {
    team,
    people: Array.from(peopleByLogin.values()).sort((left, right) => left.login.localeCompare(right.login)),
    generatedAt: latestGeneratedAt(metricRows)
  };
}

async function getWeeklyDigestCandidate(repoId: number, profile: RepoProfile): Promise<NotificationCandidate | null> {
  const period = weeklyDigestPeriod(profile.reporting.timezone, profile.reporting.weekStart);
  const metrics = await getPeriodDigestMetrics(repoId, profile, period);
  if (!metrics) {
    return null;
  }
  return buildWeeklyDigestNotificationCandidate({
    profile,
    period,
    ...metrics
  });
}

async function getMonthlyDigestCandidate(repoId: number, profile: RepoProfile): Promise<NotificationCandidate | null> {
  const period = monthlyDigestPeriod(profile.reporting.timezone);
  const metrics = await getPeriodDigestMetrics(repoId, profile, period);
  if (!metrics) {
    return null;
  }
  return buildMonthlyDigestNotificationCandidate({
    profile,
    period,
    ...metrics
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
  const immediateLimit = notificationImmediateLimit(limit);
  const dashboardBaseUrl = notificationDashboardBaseUrlFromEnv();
  const escalationHours = profile.notifications.routing.escalateAfterHours;
  const escalationCutoff = sqlDate(new Date(Date.now() - escalationHours * 3_600_000));
  const attentionVisibility = notificationSourceObjectVisibilityWhereSql("a", profile);
  const escalatedAttentionIds: number[] = [];
  if (escalationCutoff) {
    const [escalationRows] = await getPool().execute<RowData[]>(
      `SELECT ${attentionCandidateColumns}, d.attempted_at AS last_sent_at
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
      const objectNumber =
        row.object_number === null || row.object_number === undefined ? null : asNumber(row.object_number);
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
    `SELECT ${attentionCandidateColumns}
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
    const objectNumber =
      row.object_number === null || row.object_number === undefined ? null : asNumber(row.object_number);
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
      `SELECT ${workflowViolationCandidateColumns}
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
        dashboardUrl: notificationDashboardUrl(
          dashboardBaseUrl,
          "workflow_violation",
          asString(row.object_type),
          objectNumber,
          asNumber(row.id)
        ),
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
      `SELECT ${aiDriftCandidateColumns}
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
        dashboardUrl: notificationDashboardUrl(
          dashboardBaseUrl,
          "ai_drift_signal",
          asString(row.object_type),
          objectNumber,
          asNumber(row.id)
        ),
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

  if (candidates.length < limit) {
    const digest = await getWeeklyDigestCandidate(repoId, profile);
    if (digest) {
      candidates.push(digest);
    }
  }

  if (candidates.length < limit) {
    const digest = await getMonthlyDigestCandidate(repoId, profile);
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

export async function notificationDeliveryCooldownHoursForDedupe(
  dedupeKey: string,
  configuredCooldownHours: number
): Promise<number | null> {
  const [rows] = await getPool().execute<RowData[]>(
    `SELECT status
     FROM notification_deliveries
     WHERE dedupe_key = ?
       AND status IN (${notificationDeliveryCooldownStatuses.map(() => "?").join(", ")})
     ORDER BY attempted_at DESC
     LIMIT 8`,
    [dedupeKey, ...notificationDeliveryCooldownStatuses]
  );
  return notificationDeliveryCooldownHours(
    rows.map((row) => ({ status: asString(row.status) as NotificationStatus })),
    configuredCooldownHours
  );
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
      dashboard_url, dedupe_key, channel, recipient, status, dry_run, payload_json,
      provider_response, error_message, attempted_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.repoId,
      input.candidate.sourceType === "attention_item" ? input.candidate.sourceId : null,
      input.candidate.sourceType,
      input.candidate.sourceId,
      input.candidate.ruleKey,
      input.candidate.objectType,
      input.candidate.objectNumber,
      input.candidate.dashboardUrl,
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

export type NotificationRetryRequestResult =
  | {
      outcome: "requested";
      deliveryId: number;
      retryDeliveryId: number;
      deliveryStatus: NotificationStatus;
      dedupeKey: string;
    }
  | {
      outcome: "not_retryable";
      deliveryId: number;
      deliveryStatus: NotificationStatus;
    }
  | {
      outcome: "source_resolved";
      deliveryId: number;
      deliveryStatus: NotificationStatus;
    }
  | {
      outcome: "not_found";
    };

export async function requestNotificationDeliveryRetry(input: {
  repoId: number;
  deliveryId: number;
  githubLogin: string;
  profile: RepoProfile;
  viewer: DashboardViewer;
}): Promise<NotificationRetryRequestResult> {
  const visibility = notificationDeliveryVisibilityWhereSql("d", input.profile, input.viewer);
  const activeSourceWhere = activeNotificationDeliverySourceWhereSql("d");
  const [deliveryRows] = await getPool().execute<RowData[]>(
    `SELECT
       ${notificationDeliveryRetryColumns},
       CASE WHEN ${activeSourceWhere} THEN 1 ELSE 0 END AS source_active,
       (
         SELECT nd.id
         FROM notification_deliveries nd
         WHERE nd.repo_id = d.repo_id AND nd.dedupe_key = d.dedupe_key
         ORDER BY nd.id DESC
         LIMIT 1
       ) AS latest_id,
       (
         SELECT nd.status
         FROM notification_deliveries nd
         WHERE nd.repo_id = d.repo_id AND nd.dedupe_key = d.dedupe_key
         ORDER BY nd.id DESC
         LIMIT 1
       ) AS latest_status
     FROM notification_deliveries d
     WHERE d.id = ? AND d.repo_id = ? AND ${visibility.sql}
     LIMIT 1`,
    [input.deliveryId, input.repoId, ...visibility.params]
  );
  const delivery = deliveryRows[0];
  if (!delivery) {
    return { outcome: "not_found" };
  }

  const deliveryStatus = asString(delivery.latest_status) as NotificationStatus;
  if (asNumber(delivery.source_active) !== 1) {
    return {
      outcome: "source_resolved",
      deliveryId: asNumber(delivery.id),
      deliveryStatus
    };
  }
  if (asNumber(delivery.latest_id) !== asNumber(delivery.id) || !notificationStatusAllowsRetry(deliveryStatus)) {
    return {
      outcome: "not_retryable",
      deliveryId: asNumber(delivery.id),
      deliveryStatus
    };
  }

  const attemptedAt = nowSql();
  const retryInsertValues: Array<string | number | null> = [
    input.repoId,
    delivery.attention_item_id === null || delivery.attention_item_id === undefined
      ? null
      : asNumber(delivery.attention_item_id),
    delivery.source_type === null || delivery.source_type === undefined ? null : asString(delivery.source_type),
    delivery.source_id === null || delivery.source_id === undefined ? null : asNumber(delivery.source_id),
    asString(delivery.rule_key),
    asString(delivery.object_type),
    delivery.object_number === null || delivery.object_number === undefined ? null : asNumber(delivery.object_number),
    asString(delivery.dashboard_url),
    asString(delivery.dedupe_key),
    asString(delivery.channel),
    asString(delivery.recipient),
    `Manual retry requested by ${input.githubLogin} for delivery #${asNumber(delivery.id)} after ${deliveryStatus}.`,
    attemptedAt
  ];
  const [result] = await getPool().execute<ResultSetHeader>(
    `INSERT INTO notification_deliveries(
      repo_id, attention_item_id, source_type, source_id, rule_key, object_type, object_number,
      dashboard_url, dedupe_key, channel, recipient, status, dry_run, payload_json,
      provider_response, error_message, attempted_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'retry_requested', 0, NULL, NULL, ?, ?)`,
    retryInsertValues
  );

  return {
    outcome: "requested",
    deliveryId: asNumber(delivery.id),
    retryDeliveryId: Number(result.insertId),
    deliveryStatus,
    dedupeKey: asString(delivery.dedupe_key)
  };
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
    `SELECT id, status
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
    acknowledgedAt:
      fromSqlDate(acknowledgement?.acknowledged_at) ?? fromSqlDate(acknowledgedAt) ?? new Date().toISOString(),
    acknowledgedBy: acknowledgement?.github_login ? asString(acknowledgement.github_login) : input.githubLogin
  };
}

export async function getNotificationHealth(input: {
  repoId: number;
  profile: RepoProfile;
  viewer: DashboardViewer;
  missingEmployeeMappings?: number;
}): Promise<NotificationHealth> {
  const activeSourceWhere = activeNotificationDeliverySourceWhereSql("d");
  const visibility = notificationDeliveryVisibilityWhereSql("d", input.profile, input.viewer);
  const [deliveryRows] = await getPool().execute<RowData[]>(
    `SELECT
       ${notificationDeliveryHealthColumns},
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
     JOIN (
       SELECT dedupe_key, MAX(id) AS latest_id
       FROM notification_deliveries
       WHERE repo_id = ?
       GROUP BY dedupe_key
     ) latest_delivery ON latest_delivery.latest_id = d.id
     WHERE d.repo_id = ? AND d.status IN ('failed_transient', 'failed_permanent')
       AND ${activeSourceWhere}
       AND ${visibility.sql}`,
    [input.repoId, input.repoId, ...visibility.params]
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
    dashboardUrl: asString(row.dashboard_url),
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
    readiness: notificationReadiness({
      profile: input.profile,
      missingEmployeeMappings: input.missingEmployeeMappings ?? 0
    }),
    cooldownHours: input.profile.notifications.routing.cooldownHours,
    escalateAfterHours: escalationHours,
    failedDeliveries: asNumber(deliveryFailureRows[0]?.failed_count),
    unacknowledgedDeliveries: asNumber(unacknowledgedRows[0]?.unacknowledged_count),
    escalationPendingDeliveries: asNumber(escalationRows[0]?.escalation_count),
    lastDeliveries
  };
}
