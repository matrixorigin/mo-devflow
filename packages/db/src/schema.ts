import mysql from "mysql2/promise";
import type { RowDataPacket } from "mysql2";
import { getDbConfig } from "./client";

const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS schema_migrations (
    version VARCHAR(64) NOT NULL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    applied_at DATETIME NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS repo_profiles (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    profile_key VARCHAR(255) NOT NULL,
    owner VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    local_path TEXT,
    timezone VARCHAR(128) NOT NULL,
    week_start VARCHAR(32) NOT NULL,
    anonymous_read TINYINT NOT NULL,
    critical_scope VARCHAR(64) NOT NULL,
    config_json LONGTEXT NOT NULL,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    UNIQUE KEY uniq_repo_profiles_profile_key (profile_key)
  )`,
  `CREATE TABLE IF NOT EXISTS sync_runs (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    repo_id BIGINT NOT NULL,
    sync_layer VARCHAR(64) NOT NULL,
    status VARCHAR(32) NOT NULL,
    source_auth_type VARCHAR(64) NOT NULL,
    started_at DATETIME NOT NULL,
    finished_at DATETIME,
    cursor_value TEXT,
    error_message TEXT,
    rate_limit_remaining INT,
    raw_json LONGTEXT
  )`,
  `CREATE TABLE IF NOT EXISTS jobs (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    job_key VARCHAR(255) NOT NULL,
    job_type VARCHAR(128) NOT NULL,
    status VARCHAR(32) NOT NULL,
    attempts INT NOT NULL,
    next_run_at DATETIME NOT NULL,
    lease_owner VARCHAR(255),
    lease_expires_at DATETIME,
    last_error TEXT,
    payload_json LONGTEXT,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    UNIQUE KEY uniq_jobs_job_key (job_key)
  )`,
  `CREATE TABLE IF NOT EXISTS github_webhook_deliveries (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    repo_id BIGINT NOT NULL,
    delivery_id VARCHAR(128) NOT NULL,
    event_name VARCHAR(128) NOT NULL,
    action VARCHAR(128),
    status VARCHAR(32) NOT NULL,
    signature256 VARCHAR(256),
    headers_json LONGTEXT NOT NULL,
    payload_json LONGTEXT NOT NULL,
    raw_payload LONGTEXT NOT NULL,
    attempts INT NOT NULL DEFAULT 0,
    processing_owner VARCHAR(255),
    processing_started_at DATETIME,
    processing_expires_at DATETIME,
    processing_result_json LONGTEXT,
    duplicate_count INT NOT NULL DEFAULT 0,
    last_duplicate_at DATETIME,
    received_at DATETIME NOT NULL,
    processed_at DATETIME,
    error_message TEXT,
    UNIQUE KEY uniq_github_webhook_delivery (delivery_id)
  )`,
  `CREATE TABLE IF NOT EXISTS manual_refresh_requests (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    repo_id BIGINT NOT NULL,
    user_id BIGINT NOT NULL,
    github_login VARCHAR(255) NOT NULL,
    requested_layers_json LONGTEXT NOT NULL,
    queued_jobs_json LONGTEXT NOT NULL,
    status VARCHAR(32) NOT NULL,
    created_at DATETIME NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS worker_heartbeats (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    worker_id VARCHAR(255) NOT NULL,
    process_id INT NOT NULL,
    host VARCHAR(255) NOT NULL,
    phase VARCHAR(32) NOT NULL,
    heartbeat_at DATETIME NOT NULL,
    last_tick_started_at DATETIME,
    last_tick_finished_at DATETIME,
    last_error TEXT,
    details_json LONGTEXT,
    started_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    UNIQUE KEY uniq_worker_heartbeats_worker_id (worker_id)
  )`,
  `CREATE TABLE IF NOT EXISTS app_users (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    github_id VARCHAR(64) NOT NULL,
    github_login VARCHAR(255) NOT NULL,
    avatar_url TEXT,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    UNIQUE KEY uniq_app_users_github_id (github_id),
    UNIQUE KEY uniq_app_users_github_login (github_login)
  )`,
  `CREATE TABLE IF NOT EXISTS user_github_tokens (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT NOT NULL,
    encrypted_token LONGTEXT NOT NULL,
    token_iv VARCHAR(64) NOT NULL,
    token_auth_tag VARCHAR(64) NOT NULL,
    key_version VARCHAR(64) NOT NULL,
    scopes_json LONGTEXT NOT NULL,
    repo_permission VARCHAR(64) NOT NULL,
    last_validated_at DATETIME NOT NULL,
    revoked_at DATETIME,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    UNIQUE KEY uniq_user_github_tokens_user (user_id)
  )`,
  `CREATE TABLE IF NOT EXISTS user_sessions (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT NOT NULL,
    session_hash VARCHAR(128) NOT NULL,
    created_at DATETIME NOT NULL,
    last_seen_at DATETIME NOT NULL,
    expires_at DATETIME NOT NULL,
    revoked_at DATETIME,
    UNIQUE KEY uniq_user_sessions_hash (session_hash)
  )`,
  `CREATE TABLE IF NOT EXISTS write_action_previews (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    preview_id VARCHAR(64) NOT NULL,
    repo_id BIGINT NOT NULL,
    user_id BIGINT NOT NULL,
    github_login VARCHAR(255) NOT NULL,
    action_key VARCHAR(128) NOT NULL,
    object_type VARCHAR(64) NOT NULL,
    object_number BIGINT NOT NULL,
    rule_key VARCHAR(128) NOT NULL,
    status VARCHAR(32) NOT NULL,
    preview_json LONGTEXT NOT NULL,
    created_at DATETIME NOT NULL,
    expires_at DATETIME NOT NULL,
    UNIQUE KEY uniq_write_action_previews_id (preview_id)
  )`,
  `CREATE TABLE IF NOT EXISTS write_action_executions (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    preview_id VARCHAR(64) NOT NULL,
    repo_id BIGINT NOT NULL,
    user_id BIGINT NOT NULL,
    github_login VARCHAR(255) NOT NULL,
    action_key VARCHAR(128) NOT NULL,
    object_type VARCHAR(64) NOT NULL,
    object_number BIGINT NOT NULL,
    status VARCHAR(64) NOT NULL,
    operations_json LONGTEXT NOT NULL,
    before_state_json LONGTEXT,
    after_state_json LONGTEXT,
    github_response_json LONGTEXT,
    error_message TEXT,
    started_at DATETIME NOT NULL,
    finished_at DATETIME NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS issues (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    repo_id BIGINT NOT NULL,
    github_id VARCHAR(64) NOT NULL,
    number INT NOT NULL,
    title TEXT NOT NULL,
    body LONGTEXT,
    state VARCHAR(32) NOT NULL,
    author_login VARCHAR(255) NOT NULL,
    html_url TEXT NOT NULL,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    closed_at DATETIME,
    labels_json LONGTEXT NOT NULL,
    assignees_json LONGTEXT NOT NULL,
    owner_login VARCHAR(255),
    owner_reason VARCHAR(64),
    lifecycle_state VARCHAR(64) NOT NULL,
    severity VARCHAR(128),
    ai_effort_label VARCHAR(128),
    is_pull_request TINYINT NOT NULL,
    source_auth_type VARCHAR(64) NOT NULL,
    source_user_id BIGINT,
    visibility_class VARCHAR(64) NOT NULL,
    is_complete TINYINT NOT NULL,
    sync_error TEXT,
    raw_payload LONGTEXT NOT NULL,
    last_synced_at DATETIME NOT NULL,
    UNIQUE KEY uniq_issues_repo_number (repo_id, number)
  )`,
  `CREATE TABLE IF NOT EXISTS pull_requests (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    repo_id BIGINT NOT NULL,
    github_id VARCHAR(64) NOT NULL,
    number INT NOT NULL,
    title TEXT NOT NULL,
    state VARCHAR(32) NOT NULL,
    author_login VARCHAR(255) NOT NULL,
    owner_login VARCHAR(255) NOT NULL,
    html_url TEXT NOT NULL,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    closed_at DATETIME,
    merged_at DATETIME,
    draft TINYINT NOT NULL,
    head_ref TEXT,
    base_ref TEXT,
    labels_json LONGTEXT NOT NULL,
    assignees_json LONGTEXT NOT NULL,
    requested_reviewers_json LONGTEXT NOT NULL,
    age_hours DOUBLE NOT NULL,
    last_human_action_at DATETIME NOT NULL,
    last_system_action_at DATETIME,
    review_decision VARCHAR(64),
    merge_state_status VARCHAR(64),
    ci_state VARCHAR(64),
    latest_review_state VARCHAR(64),
    latest_review_submitted_at DATETIME,
    latest_commit_at DATETIME,
    detail_synced_at DATETIME,
    detail_error TEXT,
    testing_state VARCHAR(64) NOT NULL DEFAULT 'not_ready',
    testing_testers_json LONGTEXT NOT NULL,
    testing_signals_json LONGTEXT NOT NULL,
    testing_queue_age_hours DOUBLE,
    attention_flags_json LONGTEXT NOT NULL,
    linked_issue_numbers_json LONGTEXT NOT NULL,
    source_auth_type VARCHAR(64) NOT NULL,
    source_user_id BIGINT,
    visibility_class VARCHAR(64) NOT NULL,
    is_complete TINYINT NOT NULL,
    sync_error TEXT,
    raw_payload LONGTEXT NOT NULL,
    last_synced_at DATETIME NOT NULL,
    UNIQUE KEY uniq_pull_requests_repo_number (repo_id, number)
  )`,
  `CREATE TABLE IF NOT EXISTS pr_testing_events (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    repo_id BIGINT NOT NULL,
    pr_number INT NOT NULL,
    from_state VARCHAR(64) NOT NULL,
    to_state VARCHAR(64) NOT NULL,
    testing_testers_json LONGTEXT NOT NULL,
    testing_signals_json LONGTEXT NOT NULL,
    occurred_at DATETIME NOT NULL,
    source_completeness VARCHAR(64) NOT NULL,
    source_auth_type VARCHAR(64) NOT NULL,
    source_user_id BIGINT,
    visibility_class VARCHAR(64) NOT NULL,
    dedupe_key VARCHAR(512) NOT NULL,
    created_at DATETIME NOT NULL,
    UNIQUE KEY uniq_pr_testing_events_dedupe (dedupe_key)
  )`,
  `CREATE TABLE IF NOT EXISTS issue_comment_syncs (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    repo_id BIGINT NOT NULL,
    issue_number INT NOT NULL,
    source_auth_type VARCHAR(64) NOT NULL,
    source_user_id BIGINT,
    visibility_class VARCHAR(64) NOT NULL,
    is_complete TINYINT NOT NULL,
    sync_error TEXT,
    raw_json LONGTEXT,
    last_synced_at DATETIME NOT NULL,
    UNIQUE KEY uniq_issue_comment_syncs_issue (repo_id, issue_number)
  )`,
  `CREATE TABLE IF NOT EXISTS issue_comments (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    repo_id BIGINT NOT NULL,
    issue_number INT NOT NULL,
    github_id VARCHAR(64) NOT NULL,
    author_login VARCHAR(255) NOT NULL,
    body LONGTEXT NOT NULL,
    html_url TEXT NOT NULL,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    source_auth_type VARCHAR(64) NOT NULL,
    source_user_id BIGINT,
    visibility_class VARCHAR(64) NOT NULL,
    raw_payload LONGTEXT NOT NULL,
    last_synced_at DATETIME NOT NULL,
    UNIQUE KEY uniq_issue_comments_repo_github (repo_id, github_id)
  )`,
  `CREATE TABLE IF NOT EXISTS issue_timeline_events (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    repo_id BIGINT NOT NULL,
    issue_number INT NOT NULL,
    github_id VARCHAR(64) NOT NULL,
    event_type VARCHAR(64) NOT NULL,
    label_name VARCHAR(255),
    actor_login VARCHAR(255),
    occurred_at DATETIME NOT NULL,
    source_auth_type VARCHAR(64) NOT NULL,
    source_user_id BIGINT,
    visibility_class VARCHAR(64) NOT NULL,
    raw_payload LONGTEXT NOT NULL,
    last_synced_at DATETIME NOT NULL,
    UNIQUE KEY uniq_issue_timeline_events_repo_github (repo_id, github_id)
  )`,
  `CREATE TABLE IF NOT EXISTS issue_timeline_syncs (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    repo_id BIGINT NOT NULL,
    issue_number INT NOT NULL,
    source_auth_type VARCHAR(64) NOT NULL,
    source_user_id BIGINT,
    visibility_class VARCHAR(64) NOT NULL,
    is_complete TINYINT NOT NULL,
    sync_error TEXT,
    raw_json LONGTEXT,
    last_synced_at DATETIME NOT NULL,
    UNIQUE KEY uniq_issue_timeline_syncs_issue (repo_id, issue_number)
  )`,
  `CREATE TABLE IF NOT EXISTS attention_items (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    repo_id BIGINT NOT NULL,
    object_type VARCHAR(64) NOT NULL,
    object_number INT,
    rule_key VARCHAR(128) NOT NULL,
    severity VARCHAR(32) NOT NULL,
    related_login VARCHAR(255),
    target_recipient VARCHAR(255),
    dedupe_key VARCHAR(512) NOT NULL,
    first_detected_at DATETIME NOT NULL,
    last_detected_at DATETIME NOT NULL,
    resolved_at DATETIME,
    evidence_summary TEXT NOT NULL,
    dashboard_url TEXT NOT NULL,
    notification_state VARCHAR(64) NOT NULL,
    UNIQUE KEY uniq_attention_dedupe (dedupe_key)
  )`,
  `CREATE TABLE IF NOT EXISTS workflow_violations (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    repo_id BIGINT NOT NULL,
    object_type VARCHAR(64) NOT NULL,
    object_number INT NOT NULL,
    title TEXT NOT NULL,
    html_url TEXT NOT NULL,
    rule_key VARCHAR(128) NOT NULL,
    severity VARCHAR(32) NOT NULL,
    related_login VARCHAR(255),
    dedupe_key VARCHAR(512) NOT NULL,
    first_detected_at DATETIME NOT NULL,
    last_detected_at DATETIME NOT NULL,
    resolved_at DATETIME,
    evidence_summary TEXT NOT NULL,
    suggested_action TEXT NOT NULL,
    fixable TINYINT NOT NULL,
    UNIQUE KEY uniq_workflow_violation_dedupe (dedupe_key)
  )`,
  `CREATE TABLE IF NOT EXISTS daily_metrics (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    repo_id BIGINT NOT NULL,
    metric_date VARCHAR(10) NOT NULL,
    scope_type VARCHAR(32) NOT NULL,
    scope_key VARCHAR(255) NOT NULL,
    prs_created INT NOT NULL,
    prs_merged INT NOT NULL,
    issues_opened INT NOT NULL,
    issues_closed INT NOT NULL,
    issues_deferred INT NOT NULL,
    workflow_violations_detected INT NOT NULL,
    active_critical_issues INT NOT NULL,
    avg_active_critical_issue_age_hours DOUBLE,
    needs_triage_issues INT NOT NULL,
    avg_needs_triage_issue_age_hours DOUBLE,
    deferred_issues INT NOT NULL,
    avg_deferred_issue_age_hours DOUBLE,
    pending_prs INT NOT NULL,
    avg_pending_pr_age_hours DOUBLE,
    attention_prs INT NOT NULL,
    ci_failed_prs INT NOT NULL,
    requested_change_prs INT NOT NULL,
    review_waiting_prs INT NOT NULL,
    merge_conflict_prs INT NOT NULL,
    testing_queue_prs INT NOT NULL,
    avg_testing_queue_age_hours DOUBLE,
    source_completeness VARCHAR(64) NOT NULL,
    generated_at DATETIME NOT NULL,
    UNIQUE KEY uniq_daily_metrics_scope (repo_id, metric_date, scope_type, scope_key)
  )`,
  `CREATE TABLE IF NOT EXISTS ai_drift_signals (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    repo_id BIGINT NOT NULL,
    object_type VARCHAR(64) NOT NULL,
    object_number INT NOT NULL,
    title TEXT NOT NULL,
    html_url TEXT NOT NULL,
    rule_key VARCHAR(128) NOT NULL,
    severity VARCHAR(32) NOT NULL,
    owner_login VARCHAR(255),
    ai_effort_label VARCHAR(128),
    expected_hours DOUBLE,
    actual_hours DOUBLE,
    dedupe_key VARCHAR(512) NOT NULL,
    first_detected_at DATETIME NOT NULL,
    last_detected_at DATETIME NOT NULL,
    resolved_at DATETIME,
    evidence_summary TEXT NOT NULL,
    suggested_action TEXT NOT NULL,
    source_completeness VARCHAR(64) NOT NULL,
    UNIQUE KEY uniq_ai_drift_dedupe (dedupe_key)
  )`,
  `CREATE TABLE IF NOT EXISTS notification_deliveries (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    repo_id BIGINT,
    attention_item_id BIGINT,
    source_type VARCHAR(64),
    source_id BIGINT,
    rule_key VARCHAR(128),
    object_type VARCHAR(64),
    object_number INT,
    dedupe_key VARCHAR(512),
    channel VARCHAR(64) NOT NULL,
    recipient VARCHAR(255) NOT NULL,
    status VARCHAR(32) NOT NULL,
    dry_run TINYINT NOT NULL DEFAULT 0,
    payload_json LONGTEXT,
    provider_response LONGTEXT,
    error_message TEXT,
    attempted_at DATETIME NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS notification_acknowledgements (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    notification_delivery_id BIGINT NOT NULL,
    repo_id BIGINT NOT NULL,
    user_id BIGINT NOT NULL,
    github_login VARCHAR(255) NOT NULL,
    acknowledgement_source VARCHAR(64) NOT NULL,
    acknowledged_at DATETIME NOT NULL,
    UNIQUE KEY uniq_notification_ack_delivery (notification_delivery_id)
  )`
];

const indexStatements = [
  "CREATE INDEX idx_issues_repo_state ON issues(repo_id, state)",
  "CREATE INDEX idx_issues_repo_owner ON issues(repo_id, owner_login)",
  "CREATE INDEX idx_issues_repo_lifecycle ON issues(repo_id, lifecycle_state)",
  "CREATE INDEX idx_pull_requests_repo_state ON pull_requests(repo_id, state)",
  "CREATE INDEX idx_pull_requests_repo_owner ON pull_requests(repo_id, owner_login)",
  "CREATE INDEX idx_pr_testing_events_repo_pr ON pr_testing_events(repo_id, pr_number)",
  "CREATE INDEX idx_pr_testing_events_repo_occurred ON pr_testing_events(repo_id, occurred_at)",
  "CREATE INDEX idx_pr_testing_events_visibility_source ON pr_testing_events(repo_id, visibility_class, source_user_id)",
  "CREATE INDEX idx_jobs_status_next_run ON jobs(status, next_run_at)",
  "CREATE INDEX idx_jobs_lease_expires ON jobs(lease_expires_at)",
  "CREATE INDEX idx_github_webhook_repo_status ON github_webhook_deliveries(repo_id, status)",
  "CREATE INDEX idx_github_webhook_processing_expires ON github_webhook_deliveries(processing_expires_at)",
  "CREATE INDEX idx_github_webhook_received ON github_webhook_deliveries(received_at)",
  "CREATE INDEX idx_manual_refresh_repo_created ON manual_refresh_requests(repo_id, created_at)",
  "CREATE INDEX idx_manual_refresh_user_created ON manual_refresh_requests(user_id, created_at)",
  "CREATE INDEX idx_worker_heartbeats_heartbeat ON worker_heartbeats(heartbeat_at)",
  "CREATE INDEX idx_sync_runs_repo_layer ON sync_runs(repo_id, sync_layer)",
  "CREATE INDEX idx_issues_repo_visibility_source ON issues(repo_id, visibility_class, source_user_id)",
  "CREATE INDEX idx_pull_requests_repo_visibility_source ON pull_requests(repo_id, visibility_class, source_user_id)",
  "CREATE INDEX idx_issue_comment_syncs_repo_issue ON issue_comment_syncs(repo_id, issue_number)",
  "CREATE INDEX idx_issue_comments_repo_issue ON issue_comments(repo_id, issue_number)",
  "CREATE INDEX idx_issue_comments_repo_visibility_source ON issue_comments(repo_id, visibility_class, source_user_id)",
  "CREATE INDEX idx_issue_timeline_events_repo_issue ON issue_timeline_events(repo_id, issue_number)",
  "CREATE INDEX idx_issue_timeline_events_repo_label ON issue_timeline_events(repo_id, label_name, occurred_at)",
  "CREATE INDEX idx_issue_timeline_syncs_repo_issue ON issue_timeline_syncs(repo_id, issue_number)",
  "CREATE INDEX idx_issue_timeline_events_visibility_source ON issue_timeline_events(repo_id, visibility_class, source_user_id)",
  "CREATE INDEX idx_user_sessions_user ON user_sessions(user_id)",
  "CREATE INDEX idx_user_sessions_expires ON user_sessions(expires_at)",
  "CREATE INDEX idx_write_action_previews_repo ON write_action_previews(repo_id)",
  "CREATE INDEX idx_write_action_previews_user ON write_action_previews(user_id)",
  "CREATE INDEX idx_write_action_previews_expires ON write_action_previews(expires_at)",
  "CREATE INDEX idx_write_action_executions_preview ON write_action_executions(preview_id)",
  "CREATE INDEX idx_write_action_executions_user ON write_action_executions(user_id)",
  "CREATE INDEX idx_attention_repo_resolved ON attention_items(repo_id, resolved_at)",
  "CREATE INDEX idx_workflow_violations_repo_resolved ON workflow_violations(repo_id, resolved_at)",
  "CREATE INDEX idx_daily_metrics_repo_date ON daily_metrics(repo_id, metric_date)",
  "CREATE INDEX idx_ai_drift_repo_resolved ON ai_drift_signals(repo_id, resolved_at)",
  "CREATE INDEX idx_notification_deliveries_repo ON notification_deliveries(repo_id)",
  "CREATE INDEX idx_notification_deliveries_dedupe ON notification_deliveries(dedupe_key)",
  "CREATE INDEX idx_notification_deliveries_attempted ON notification_deliveries(attempted_at)",
  "CREATE INDEX idx_notification_ack_repo ON notification_acknowledgements(repo_id)",
  "CREATE INDEX idx_notification_ack_user ON notification_acknowledgements(user_id)"
];

interface SchemaMigrationContext {
  tablesExistedBeforeCreate: Set<string>;
}

interface SchemaMigration {
  version: string;
  name: string;
  run(connection: mysql.Connection, context: SchemaMigrationContext): Promise<void>;
}

const migrations: SchemaMigration[] = [
  {
    version: "0002",
    name: "cache_user_token_repo_permission",
    async run(connection, context) {
      if (context.tablesExistedBeforeCreate.has("user_github_tokens")) {
        await connection.query(
          "ALTER TABLE user_github_tokens ADD COLUMN repo_permission VARCHAR(64) NOT NULL DEFAULT 'unverified'"
        );
      }
    }
  },
  {
    version: "0003",
    name: "daily_metric_backlog_snapshots",
    async run(connection, context) {
      if (context.tablesExistedBeforeCreate.has("daily_metrics")) {
        await connection.query("ALTER TABLE daily_metrics ADD COLUMN active_critical_issues INT NOT NULL DEFAULT 0");
        await connection.query("ALTER TABLE daily_metrics ADD COLUMN avg_active_critical_issue_age_hours DOUBLE");
        await connection.query("ALTER TABLE daily_metrics ADD COLUMN needs_triage_issues INT NOT NULL DEFAULT 0");
        await connection.query("ALTER TABLE daily_metrics ADD COLUMN avg_needs_triage_issue_age_hours DOUBLE");
        await connection.query("ALTER TABLE daily_metrics ADD COLUMN deferred_issues INT NOT NULL DEFAULT 0");
        await connection.query("ALTER TABLE daily_metrics ADD COLUMN avg_deferred_issue_age_hours DOUBLE");
        await connection.query("ALTER TABLE daily_metrics ADD COLUMN pending_prs INT NOT NULL DEFAULT 0");
        await connection.query("ALTER TABLE daily_metrics ADD COLUMN avg_pending_pr_age_hours DOUBLE");
        await connection.query("ALTER TABLE daily_metrics ADD COLUMN attention_prs INT NOT NULL DEFAULT 0");
        await connection.query("ALTER TABLE daily_metrics ADD COLUMN testing_queue_prs INT NOT NULL DEFAULT 0");
        await connection.query("ALTER TABLE daily_metrics ADD COLUMN avg_testing_queue_age_hours DOUBLE");
      }
    }
  },
  {
    version: "0004",
    name: "daily_metric_pr_quality_snapshots",
    async run(connection, context) {
      if (context.tablesExistedBeforeCreate.has("daily_metrics")) {
        await connection.query("ALTER TABLE daily_metrics ADD COLUMN ci_failed_prs INT NOT NULL DEFAULT 0");
        await connection.query("ALTER TABLE daily_metrics ADD COLUMN requested_change_prs INT NOT NULL DEFAULT 0");
        await connection.query("ALTER TABLE daily_metrics ADD COLUMN review_waiting_prs INT NOT NULL DEFAULT 0");
        await connection.query("ALTER TABLE daily_metrics ADD COLUMN merge_conflict_prs INT NOT NULL DEFAULT 0");
      }
    }
  },
  {
    version: "0005",
    name: "issue_timeline_event_cache",
    async run() {
      // The CREATE TABLE/INDEX statements above are idempotent and create this cache for both fresh and existing DBs.
    }
  },
  {
    version: "0006",
    name: "pull_request_linked_issue_cache",
    async run(connection, context) {
      if (context.tablesExistedBeforeCreate.has("pull_requests")) {
        await connection.query("ALTER TABLE pull_requests ADD COLUMN linked_issue_numbers_json LONGTEXT");
        await connection.query(
          "UPDATE pull_requests SET linked_issue_numbers_json = '[]', is_complete = 0 WHERE state = 'open'"
        );
        await connection.query(
          "UPDATE pull_requests SET linked_issue_numbers_json = '[]' WHERE linked_issue_numbers_json IS NULL"
        );
        await connection.query("ALTER TABLE pull_requests MODIFY COLUMN linked_issue_numbers_json LONGTEXT NOT NULL");
      }
    }
  }
];

async function executeIgnoringDuplicateIndex(connection: mysql.Connection, statement: string): Promise<void> {
  try {
    await connection.query(statement);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.toLowerCase().includes("duplicate") && !message.toLowerCase().includes("already exists")) {
      throw error;
    }
  }
}

interface SchemaColumnRow extends RowDataPacket {
  table_name: string;
  column_name: string;
  column_type: string;
  is_nullable: string;
}

interface SchemaTableRow extends RowDataPacket {
  table_name: string;
}

interface SchemaMigrationRow extends RowDataPacket {
  version: string;
}

export interface ExpectedSchemaColumn {
  columnType: string;
  nullable: boolean;
}

export interface SchemaDrift {
  missingColumns: string[];
  unexpectedColumns: string[];
  typeMismatches: string[];
  nullabilityMismatches: string[];
}

const tableConstraintTokens = new Set(["PRIMARY", "UNIQUE", "KEY", "INDEX", "CONSTRAINT", "FOREIGN", "CHECK"]);

function normalizeColumnType(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ")
    .replace(/\b(BIGINT|INT|TINYINT|DATETIME|DOUBLE|TEXT)\(\d+\)/g, "$1")
    .replace(/\bLONGTEXT\b/g, "TEXT");
}

function columnTypeFromColumnDefinition(line: string): string {
  const [, remainder = ""] = line.match(/^`?[a-z_][a-z0-9_]*`?\s+(.+)$/i) ?? [];
  const typeMatch = remainder.match(/^[a-z]+(?:\s*\([^)]*\))?/i);
  return normalizeColumnType(typeMatch?.[0] ?? "");
}

export function expectedSchemaColumnSpecsFromStatements(
  statements: readonly string[] = schemaStatements
): Map<string, Map<string, ExpectedSchemaColumn>> {
  const expected = new Map<string, Map<string, ExpectedSchemaColumn>>();

  for (const statement of statements) {
    const tableMatch = statement.match(/CREATE TABLE IF NOT EXISTS\s+`?([a-z_][a-z0-9_]*)`?\s*\(/i);
    if (!tableMatch) {
      continue;
    }
    const tableName = tableMatch[1]!;
    const bodyStart = statement.indexOf("(");
    const bodyEnd = statement.lastIndexOf(")");
    const columns = new Map<string, ExpectedSchemaColumn>();
    for (const rawLine of statement.slice(bodyStart + 1, bodyEnd).split("\n")) {
      const line = rawLine.trim().replace(/,$/, "");
      const columnMatch = line.match(/^`?([a-z_][a-z0-9_]*)`?\s+/i);
      const token = columnMatch?.[1];
      if (!token || tableConstraintTokens.has(token.toUpperCase())) {
        continue;
      }
      columns.set(token, {
        columnType: columnTypeFromColumnDefinition(line),
        nullable: !/\bNOT\s+NULL\b/i.test(line) && !/\bPRIMARY\s+KEY\b/i.test(line)
      });
    }
    expected.set(tableName, columns);
  }

  return expected;
}

export function expectedSchemaColumnsFromStatements(
  statements: readonly string[] = schemaStatements
): Map<string, Set<string>> {
  const specs = expectedSchemaColumnSpecsFromStatements(statements);
  return new Map(Array.from(specs.entries()).map(([tableName, columns]) => [tableName, new Set(columns.keys())]));
}

export function detectSchemaDrift(
  expected: Map<string, Map<string, ExpectedSchemaColumn>>,
  actualRows: Array<{ table_name: string; column_name: string; column_type: string; is_nullable: string }>
): SchemaDrift {
  const actual = new Map<string, Map<string, ExpectedSchemaColumn>>();
  for (const row of actualRows) {
    const tableName = row.table_name;
    const columnName = row.column_name;
    const existing = actual.get(tableName) ?? new Map<string, ExpectedSchemaColumn>();
    existing.set(columnName, {
      columnType: normalizeColumnType(row.column_type),
      nullable: row.is_nullable.toUpperCase() === "YES"
    });
    actual.set(tableName, existing);
  }

  const missingColumns: string[] = [];
  const unexpectedColumns: string[] = [];
  const typeMismatches: string[] = [];
  const nullabilityMismatches: string[] = [];
  for (const [tableName, expectedColumns] of expected.entries()) {
    const actualColumns = actual.get(tableName) ?? new Map<string, ExpectedSchemaColumn>();
    for (const [expectedColumn, expectedSpec] of expectedColumns.entries()) {
      const actualSpec = actualColumns.get(expectedColumn);
      if (!actualSpec) {
        missingColumns.push(`${tableName}.${expectedColumn}`);
        continue;
      }
      if (actualSpec.columnType !== expectedSpec.columnType) {
        typeMismatches.push(
          `${tableName}.${expectedColumn} expected ${expectedSpec.columnType} but found ${actualSpec.columnType}`
        );
      }
      if (actualSpec.nullable !== expectedSpec.nullable) {
        nullabilityMismatches.push(
          `${tableName}.${expectedColumn} expected ${expectedSpec.nullable ? "NULL" : "NOT NULL"} but found ${
            actualSpec.nullable ? "NULL" : "NOT NULL"
          }`
        );
      }
    }
    for (const actualColumn of actualColumns.keys()) {
      if (!expectedColumns.has(actualColumn)) {
        unexpectedColumns.push(`${tableName}.${actualColumn}`);
      }
    }
  }

  return {
    missingColumns: missingColumns.sort(),
    unexpectedColumns: unexpectedColumns.sort(),
    typeMismatches: typeMismatches.sort(),
    nullabilityMismatches: nullabilityMismatches.sort()
  };
}

async function assertCurrentSchema(connection: mysql.Connection, database: string): Promise<void> {
  const expected = expectedSchemaColumnSpecsFromStatements();
  const tableNames = Array.from(expected.keys());
  const [rows] = await connection.query<SchemaColumnRow[]>(
    `SELECT table_name, column_name, column_type, is_nullable
     FROM information_schema.columns
     WHERE table_schema = ? AND table_name IN (${tableNames.map(() => "?").join(", ")})`,
    [database, ...tableNames]
  );
  const drift = detectSchemaDrift(expected, rows);
  if (
    drift.missingColumns.length === 0 &&
    drift.unexpectedColumns.length === 0 &&
    drift.typeMismatches.length === 0 &&
    drift.nullabilityMismatches.length === 0
  ) {
    return;
  }

  throw new Error(
    [
      `Database schema drift detected in ${database}.`,
      "This early-development migration refuses to repair existing tables implicitly.",
      "Reset the development database or add an explicit schema migration.",
      `Missing columns: ${drift.missingColumns.join(", ") || "none"}.`,
      `Unexpected columns: ${drift.unexpectedColumns.join(", ") || "none"}.`,
      `Type mismatches: ${drift.typeMismatches.join(", ") || "none"}.`,
      `Nullability mismatches: ${drift.nullabilityMismatches.join(", ") || "none"}.`
    ].join(" ")
  );
}

async function existingTableNames(connection: mysql.Connection, database: string): Promise<Set<string>> {
  const [rows] = await connection.query<SchemaTableRow[]>(
    `SELECT table_name
     FROM information_schema.tables
     WHERE table_schema = ?`,
    [database]
  );
  return new Set(rows.map((row) => row.table_name));
}

async function schemaMigrationApplied(connection: mysql.Connection, version: string): Promise<boolean> {
  const [rows] = await connection.query<SchemaMigrationRow[]>(
    "SELECT version FROM schema_migrations WHERE version = ? LIMIT 1",
    [version]
  );
  return rows.length > 0;
}

async function markSchemaMigration(connection: mysql.Connection, version: string, name: string): Promise<void> {
  await connection.query(
    `INSERT INTO schema_migrations(version, name, applied_at)
     VALUES(?, ?, UTC_TIMESTAMP())
     ON DUPLICATE KEY UPDATE applied_at = applied_at`,
    [version, name]
  );
}

async function applySchemaMigrations(connection: mysql.Connection, context: SchemaMigrationContext): Promise<void> {
  await markSchemaMigration(connection, "0001", "initial_mvp0_schema");
  for (const migration of migrations) {
    if (await schemaMigrationApplied(connection, migration.version)) {
      continue;
    }
    await migration.run(connection, context);
    await markSchemaMigration(connection, migration.version, migration.name);
  }
}

export async function migrate(): Promise<void> {
  const config = getDbConfig();
  const bootstrap = await mysql.createConnection({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    multipleStatements: false
  });

  try {
    await bootstrap.query(`CREATE DATABASE IF NOT EXISTS \`${config.database}\``);
  } finally {
    await bootstrap.end();
  }

  const connection = await mysql.createConnection({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    multipleStatements: false,
    timezone: "Z",
    dateStrings: true
  });

  try {
    const tablesExistedBeforeCreate = await existingTableNames(connection, config.database);
    for (const statement of schemaStatements) {
      await connection.query(statement);
    }
    await applySchemaMigrations(connection, { tablesExistedBeforeCreate });
    await assertCurrentSchema(connection, config.database);
    for (const statement of indexStatements) {
      await executeIgnoringDuplicateIndex(connection, statement);
    }
  } finally {
    await connection.end();
  }
}
