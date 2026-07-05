import type {
  AiDriftSignalView,
  NormalizedIssue,
  RepoProfile,
  WorkflowFixExecutionResult,
  WorkflowFixExecutionStatus,
  WorkflowFixOperation,
  WorkflowFixPreview,
  WorkflowViolationView,
  WriteActionKey,
  WriteActionExecutionView
} from "@mo-devflow/shared";
import { emptyNotificationTrace, parseJsonArray, parseJsonRecord } from "@mo-devflow/shared";
import { randomUUID } from "node:crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { fromSqlDate, getPool, sqlDate } from "./client";
import { notificationDeliveryVisibilityWhereSql } from "./notifications";
import { dashboardVisibilityFilter, type DashboardViewer } from "./visibility";

interface RowData extends RowDataPacket {
  [key: string]: unknown;
}

const auditCommentBodyRedaction = "[comment body hidden from dashboard audit]";

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

export async function getCachedIssueByNumber(input: {
  repoId: number;
  issueNumber: number;
  profile: RepoProfile;
  viewer: DashboardViewer;
}): Promise<NormalizedIssue | null> {
  const visibility = dashboardVisibilityFilter("i", input.profile, input.viewer);
  const [rows] = await getPool().execute<RowData[]>(
    `SELECT i.github_id, i.number, i.title, i.body, i.state, i.author_login, i.html_url,
            i.created_at, i.updated_at, i.closed_at, i.labels_json, i.assignees_json,
            i.owner_login, i.owner_reason, i.lifecycle_state, i.severity, i.ai_effort_label,
            i.source_auth_type, i.source_user_id, i.visibility_class, i.is_complete
     FROM issues i
     WHERE i.repo_id = ? AND i.number = ? AND i.is_pull_request = 0 AND ${visibility.sql}
     LIMIT 1`,
    [input.repoId, input.issueNumber, ...visibility.params]
  );
  const row = rows[0];
  if (!row) {
    return null;
  }
  return {
    githubId: asNumber(row.github_id),
    number: asNumber(row.number),
    title: asString(row.title),
    body: asString(row.body),
    state: asString(row.state) === "closed" ? "closed" : "open",
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
    sourceUserId: row.source_user_id === null || row.source_user_id === undefined ? null : asNumber(row.source_user_id),
    visibilityClass: asString(row.visibility_class) as NormalizedIssue["visibilityClass"],
    isComplete: asNumber(row.is_complete) === 1,
    rawPayload: {}
  };
}

export async function getActiveWorkflowViolation(input: {
  repoId: number;
  objectType: string;
  objectNumber: number;
  ruleKey: string;
  profile: RepoProfile;
  viewer: DashboardViewer;
}): Promise<WorkflowViolationView | null> {
  const issueVisibility = dashboardVisibilityFilter("i", input.profile, input.viewer);
  const pullRequestVisibility = dashboardVisibilityFilter("p", input.profile, input.viewer);
  const [rows] = await getPool().execute<RowData[]>(
    `SELECT id, object_type, object_number, title, html_url, rule_key, severity,
            related_login, evidence_summary, suggested_action, fixable,
            first_detected_at, last_detected_at
     FROM workflow_violations
     WHERE repo_id = ?
       AND object_type = ?
       AND object_number = ?
       AND rule_key = ?
       AND resolved_at IS NULL
       AND (
         (object_type = 'issue' AND EXISTS (
           SELECT 1 FROM issues i
           WHERE i.repo_id = workflow_violations.repo_id
             AND i.number = workflow_violations.object_number
             AND ${issueVisibility.sql}
         ))
         OR
         (object_type = 'pull_request' AND EXISTS (
           SELECT 1 FROM pull_requests p
           WHERE p.repo_id = workflow_violations.repo_id
             AND p.number = workflow_violations.object_number
             AND ${pullRequestVisibility.sql}
         ))
       )
     LIMIT 1`,
    [
      input.repoId,
      input.objectType,
      input.objectNumber,
      input.ruleKey,
      ...issueVisibility.params,
      ...pullRequestVisibility.params
    ]
  );
  const row = rows[0];
  if (!row) {
    return null;
  }
  return {
    sourceId: asNumber(row.id),
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
    lastDetectedAt: fromSqlDate(row.last_detected_at) ?? new Date().toISOString(),
    notification: emptyNotificationTrace()
  };
}

export async function getActiveAiDriftSignal(input: {
  repoId: number;
  objectType: string;
  objectNumber: number;
  ruleKey: string;
  profile: RepoProfile;
  viewer: DashboardViewer;
}): Promise<AiDriftSignalView | null> {
  const issueVisibility = dashboardVisibilityFilter("i", input.profile, input.viewer);
  const pullRequestVisibility = dashboardVisibilityFilter("p", input.profile, input.viewer);
  const [rows] = await getPool().execute<RowData[]>(
    `SELECT id, object_type, object_number, title, html_url, rule_key, severity,
            owner_login, ai_effort_label, expected_hours, actual_hours,
            evidence_summary, suggested_action, source_completeness,
            first_detected_at, last_detected_at
     FROM ai_drift_signals
     WHERE repo_id = ?
       AND object_type = ?
       AND object_number = ?
       AND rule_key = ?
       AND resolved_at IS NULL
       AND (
         (object_type = 'issue' AND EXISTS (
           SELECT 1 FROM issues i
           WHERE i.repo_id = ai_drift_signals.repo_id
             AND i.number = ai_drift_signals.object_number
             AND ${issueVisibility.sql}
         ))
         OR
         (object_type = 'pull_request' AND EXISTS (
           SELECT 1 FROM pull_requests p
           WHERE p.repo_id = ai_drift_signals.repo_id
             AND p.number = ai_drift_signals.object_number
             AND ${pullRequestVisibility.sql}
         ))
       )
     LIMIT 1`,
    [
      input.repoId,
      input.objectType,
      input.objectNumber,
      input.ruleKey,
      ...issueVisibility.params,
      ...pullRequestVisibility.params
    ]
  );
  const row = rows[0];
  if (!row) {
    return null;
  }
  return {
    sourceId: asNumber(row.id),
    objectType: asString(row.object_type) as AiDriftSignalView["objectType"],
    objectNumber: asNumber(row.object_number),
    title: asString(row.title),
    htmlUrl: asString(row.html_url),
    ruleKey: asString(row.rule_key),
    severity: asString(row.severity) as AiDriftSignalView["severity"],
    ownerLogin: row.owner_login ? asString(row.owner_login) : null,
    aiEffortLabel: row.ai_effort_label ? asString(row.ai_effort_label) : null,
    expectedHours:
      row.expected_hours === null || row.expected_hours === undefined ? null : asNumber(row.expected_hours),
    actualHours: row.actual_hours === null || row.actual_hours === undefined ? null : asNumber(row.actual_hours),
    evidenceSummary: asString(row.evidence_summary),
    suggestedAction: asString(row.suggested_action),
    sourceCompleteness: asString(row.source_completeness) as AiDriftSignalView["sourceCompleteness"],
    firstDetectedAt: fromSqlDate(row.first_detected_at) ?? new Date().toISOString(),
    lastDetectedAt: fromSqlDate(row.last_detected_at) ?? new Date().toISOString(),
    notification: emptyNotificationTrace()
  };
}

export async function recordWorkflowFixPreview(input: {
  repoId: number;
  userId: number;
  githubLogin: string;
  preview: WorkflowFixPreview;
}): Promise<void> {
  await getPool().execute(
    `INSERT INTO write_action_previews(
      preview_id, repo_id, user_id, github_login, action_key,
      object_type, object_number, rule_key, status, preview_json,
      created_at, expires_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'previewed', ?, ?, ?)`,
    [
      input.preview.previewId,
      input.repoId,
      input.userId,
      input.githubLogin,
      input.preview.actionKey,
      input.preview.objectType,
      input.preview.objectNumber,
      input.preview.ruleKey,
      stringify(input.preview),
      sqlDate(input.preview.createdAt),
      sqlDate(input.preview.expiresAt)
    ]
  );
}

export interface StoredWorkflowFixPreview {
  repoId: number;
  userId: number;
  githubLogin: string;
  status: string;
  preview: WorkflowFixPreview;
  expiresAt: string;
}

export async function getWorkflowFixPreviewForUser(input: {
  previewId: string;
  userId: number;
}): Promise<StoredWorkflowFixPreview | null> {
  const [rows] = await getPool().execute<RowData[]>(
    `SELECT repo_id, user_id, github_login, status, preview_json, expires_at
     FROM write_action_previews
     WHERE preview_id = ? AND user_id = ?
     LIMIT 1`,
    [input.previewId, input.userId]
  );
  const row = rows[0];
  if (!row) {
    return null;
  }
  return {
    repoId: asNumber(row.repo_id),
    userId: asNumber(row.user_id),
    githubLogin: asString(row.github_login),
    status: asString(row.status),
    preview: parseJsonRecord(asString(row.preview_json), {}) as WorkflowFixPreview,
    expiresAt: fromSqlDate(row.expires_at) ?? new Date(0).toISOString()
  };
}

export async function claimWorkflowFixPreviewForUser(input: { previewId: string; userId: number }): Promise<boolean> {
  const [result] = await getPool().execute<ResultSetHeader>(
    `UPDATE write_action_previews
     SET status = 'confirming'
     WHERE preview_id = ? AND user_id = ? AND status = 'previewed'`,
    [input.previewId, input.userId]
  );
  return result.affectedRows === 1;
}

export async function markWorkflowFixPreviewStatus(input: {
  previewId: string;
  userId: number;
  status: WorkflowFixExecutionStatus | "previewed" | "confirming";
}): Promise<void> {
  await getPool().execute("UPDATE write_action_previews SET status = ? WHERE preview_id = ? AND user_id = ?", [
    input.status,
    input.previewId,
    input.userId
  ]);
}

export async function recordWorkflowFixExecution(input: {
  repoId: number;
  userId: number;
  githubLogin: string;
  preview: WorkflowFixPreview;
  result: WorkflowFixExecutionResult;
  githubResponse?: unknown;
}): Promise<void> {
  await getPool().execute(
    `INSERT INTO write_action_executions(
      preview_id, repo_id, user_id, github_login, action_key, object_type,
      object_number, status, operations_json, before_state_json, after_state_json, github_response_json, error_message,
      started_at, finished_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.preview.previewId,
      input.repoId,
      input.userId,
      input.githubLogin,
      input.preview.actionKey,
      input.preview.objectType,
      input.preview.objectNumber,
      input.result.status,
      stringify(input.result.executedOperations),
      input.result.beforeState ? stringify(input.result.beforeState) : null,
      input.result.afterState ? stringify(input.result.afterState) : null,
      input.githubResponse ? stringify(input.githubResponse) : null,
      input.result.errorMessage,
      sqlDate(input.result.executedAt),
      sqlDate(input.result.executedAt)
    ]
  );
}

export async function recordProductWriteActionExecution(input: {
  repoId: number;
  userId: number;
  githubLogin: string;
  actionKey: WriteActionKey;
  objectType: WriteActionExecutionView["objectType"];
  objectNumber: number;
  status: WriteActionExecutionView["status"];
  operations?: WorkflowFixOperation[];
  errorMessage?: string | null;
  occurredAt?: string;
}): Promise<void> {
  const occurredAt = input.occurredAt ?? new Date().toISOString();
  const previewId = `audit:${randomUUID()}`;
  await getPool().execute(
    `INSERT INTO write_action_executions(
      preview_id, repo_id, user_id, github_login, action_key, object_type,
      object_number, status, operations_json, before_state_json, after_state_json, github_response_json, error_message,
      started_at, finished_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, ?)`,
    [
      previewId,
      input.repoId,
      input.userId,
      input.githubLogin,
      input.actionKey,
      input.objectType,
      input.objectNumber,
      input.status,
      stringify(input.operations ?? []),
      input.errorMessage ?? null,
      sqlDate(occurredAt),
      sqlDate(occurredAt)
    ]
  );
}

export function workflowFixOperationsFromJson(value: string | null | undefined): WorkflowFixOperation[] {
  const parsed = parseJsonRecord<unknown>(value, []);
  if (!Array.isArray(parsed)) {
    return [];
  }

  const operations: WorkflowFixOperation[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const operation = item as Record<string, unknown>;
    if (
      (operation.type === "add_label" || operation.type === "remove_label") &&
      typeof operation.label === "string" &&
      operation.label.trim()
    ) {
      operations.push({ type: operation.type, label: operation.label });
    }
    if (operation.type === "add_comment" && typeof operation.body === "string" && operation.body.trim()) {
      operations.push({ type: "add_comment", body: auditCommentBodyRedaction });
    }
  }
  return operations;
}

export function writeActionExecutionViewFromRow(row: Record<string, unknown>): WriteActionExecutionView {
  return {
    id: asNumber(row.id),
    previewId: asString(row.preview_id),
    githubLogin: asString(row.github_login),
    actionKey: asString(row.action_key) as WriteActionExecutionView["actionKey"],
    objectType: asString(row.object_type) as WriteActionExecutionView["objectType"],
    objectNumber: asNumber(row.object_number),
    title: asString(row.object_title),
    htmlUrl: row.object_html_url ? asString(row.object_html_url) : null,
    status: asString(row.status) as WriteActionExecutionView["status"],
    executedOperations: workflowFixOperationsFromJson(asString(row.operations_json)),
    errorMessage: row.error_message ? asString(row.error_message) : null,
    startedAt: fromSqlDate(row.started_at) ?? new Date(0).toISOString(),
    finishedAt: fromSqlDate(row.finished_at) ?? new Date(0).toISOString()
  };
}

export async function listWriteActionExecutionsForDashboard(input: {
  repoId: number;
  profile: RepoProfile;
  viewer: DashboardViewer;
  limit?: number;
}): Promise<WriteActionExecutionView[]> {
  if (!input.viewer.authenticated) {
    return [];
  }

  const limit = Math.min(100, Math.max(1, Math.floor(input.limit ?? 50)));
  const issueVisibility = dashboardVisibilityFilter("i", input.profile, input.viewer);
  const pullRequestVisibility = dashboardVisibilityFilter("p", input.profile, input.viewer);
  const notificationVisibility = notificationDeliveryVisibilityWhereSql("d", input.profile, input.viewer);
  const [rows] = await getPool().execute<RowData[]>(
    `SELECT
       e.id,
       e.preview_id,
       e.github_login,
       e.action_key,
       e.object_type,
       e.object_number,
       e.status,
       e.operations_json,
       e.error_message,
       e.started_at,
       e.finished_at,
       CASE
         WHEN e.object_type = 'notification_probe' THEN 'Notification test'
         ELSE COALESCE(i.title, p.title, CONCAT(e.object_type, ' #', e.object_number))
       END AS object_title,
       COALESCE(i.html_url, p.html_url) AS object_html_url
     FROM write_action_executions e
     LEFT JOIN issues i
       ON e.object_type = 'issue'
      AND i.repo_id = e.repo_id
      AND i.number = e.object_number
      AND i.is_pull_request = 0
     LEFT JOIN pull_requests p
       ON e.object_type = 'pull_request'
      AND p.repo_id = e.repo_id
      AND p.number = e.object_number
     WHERE e.repo_id = ?
       AND (
         (e.object_type = 'issue' AND i.id IS NOT NULL AND ${issueVisibility.sql})
         OR
         (e.object_type = 'pull_request' AND p.id IS NOT NULL AND ${pullRequestVisibility.sql})
         OR
         (e.object_type = 'notification_delivery' AND EXISTS (
           SELECT 1
           FROM notification_deliveries d
           WHERE d.id = e.object_number
             AND d.repo_id = e.repo_id
             AND ${notificationVisibility.sql}
         ))
         OR e.object_type = 'notification_probe'
       )
     ORDER BY e.finished_at DESC, e.id DESC
     LIMIT ${limit}`,
    [input.repoId, ...issueVisibility.params, ...pullRequestVisibility.params, ...notificationVisibility.params]
  );

  return rows.map(writeActionExecutionViewFromRow);
}
