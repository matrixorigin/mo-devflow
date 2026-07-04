import type {
  NormalizedIssue,
  WorkflowFixExecutionResult,
  WorkflowFixExecutionStatus,
  WorkflowFixPreview,
  WorkflowViolationView
} from "@mo-devflow/shared";
import { parseJsonArray, parseJsonRecord } from "@mo-devflow/shared";
import type { RowDataPacket } from "mysql2";
import { fromSqlDate, getPool, sqlDate } from "./client";

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

export async function getCachedIssueByNumber(repoId: number, issueNumber: number): Promise<NormalizedIssue | null> {
  const [rows] = await getPool().execute<RowData[]>(
    `SELECT *
     FROM issues
     WHERE repo_id = ? AND number = ? AND is_pull_request = 0
     LIMIT 1`,
    [repoId, issueNumber]
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
    rawPayload: parseJsonRecord(asString(row.raw_payload), {})
  };
}

export async function getActiveWorkflowViolation(input: {
  repoId: number;
  objectType: string;
  objectNumber: number;
  ruleKey: string;
}): Promise<WorkflowViolationView | null> {
  const [rows] = await getPool().execute<RowData[]>(
    `SELECT *
     FROM workflow_violations
     WHERE repo_id = ?
       AND object_type = ?
       AND object_number = ?
       AND rule_key = ?
       AND resolved_at IS NULL
     LIMIT 1`,
    [input.repoId, input.objectType, input.objectNumber, input.ruleKey]
  );
  const row = rows[0];
  if (!row) {
    return null;
  }
  return {
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

export async function markWorkflowFixPreviewStatus(input: {
  previewId: string;
  userId: number;
  status: WorkflowFixExecutionStatus | "previewed";
}): Promise<void> {
  await getPool().execute(
    "UPDATE write_action_previews SET status = ? WHERE preview_id = ? AND user_id = ?",
    [input.status, input.previewId, input.userId]
  );
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
