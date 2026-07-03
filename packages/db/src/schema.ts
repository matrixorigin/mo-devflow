import mysql from "mysql2/promise";
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
    attention_flags_json LONGTEXT NOT NULL,
    source_auth_type VARCHAR(64) NOT NULL,
    visibility_class VARCHAR(64) NOT NULL,
    is_complete TINYINT NOT NULL,
    sync_error TEXT,
    raw_payload LONGTEXT NOT NULL,
    last_synced_at DATETIME NOT NULL,
    UNIQUE KEY uniq_pull_requests_repo_number (repo_id, number)
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
    dashboard_url TEXT,
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
  )`
];

const indexStatements = [
  "CREATE INDEX idx_issues_repo_state ON issues(repo_id, state)",
  "CREATE INDEX idx_issues_repo_owner ON issues(repo_id, owner_login)",
  "CREATE INDEX idx_issues_repo_lifecycle ON issues(repo_id, lifecycle_state)",
  "CREATE INDEX idx_pull_requests_repo_state ON pull_requests(repo_id, state)",
  "CREATE INDEX idx_pull_requests_repo_owner ON pull_requests(repo_id, owner_login)",
  "CREATE INDEX idx_sync_runs_repo_layer ON sync_runs(repo_id, sync_layer)",
  "CREATE INDEX idx_user_sessions_user ON user_sessions(user_id)",
  "CREATE INDEX idx_user_sessions_expires ON user_sessions(expires_at)",
  "CREATE INDEX idx_attention_repo_resolved ON attention_items(repo_id, resolved_at)",
  "CREATE INDEX idx_workflow_violations_repo_resolved ON workflow_violations(repo_id, resolved_at)",
  "CREATE INDEX idx_daily_metrics_repo_date ON daily_metrics(repo_id, metric_date)",
  "CREATE INDEX idx_ai_drift_repo_resolved ON ai_drift_signals(repo_id, resolved_at)",
  "CREATE INDEX idx_notification_deliveries_repo ON notification_deliveries(repo_id)",
  "CREATE INDEX idx_notification_deliveries_dedupe ON notification_deliveries(dedupe_key)",
  "CREATE INDEX idx_notification_deliveries_attempted ON notification_deliveries(attempted_at)"
];

const compatibilityStatements = [
  "ALTER TABLE issues MODIFY COLUMN github_id VARCHAR(64) NOT NULL",
  "ALTER TABLE pull_requests MODIFY COLUMN github_id VARCHAR(64) NOT NULL",
  "ALTER TABLE pull_requests ADD COLUMN review_decision VARCHAR(64)",
  "ALTER TABLE pull_requests ADD COLUMN merge_state_status VARCHAR(64)",
  "ALTER TABLE pull_requests ADD COLUMN ci_state VARCHAR(64)",
  "ALTER TABLE pull_requests ADD COLUMN latest_review_state VARCHAR(64)",
  "ALTER TABLE pull_requests ADD COLUMN latest_review_submitted_at DATETIME",
  "ALTER TABLE pull_requests ADD COLUMN latest_commit_at DATETIME",
  "ALTER TABLE pull_requests ADD COLUMN detail_synced_at DATETIME",
  "ALTER TABLE pull_requests ADD COLUMN detail_error TEXT",
  "ALTER TABLE notification_deliveries MODIFY COLUMN attention_item_id BIGINT",
  "ALTER TABLE notification_deliveries ADD COLUMN source_type VARCHAR(64)",
  "ALTER TABLE notification_deliveries ADD COLUMN source_id BIGINT",
  "ALTER TABLE notification_deliveries ADD COLUMN rule_key VARCHAR(128)",
  "ALTER TABLE notification_deliveries ADD COLUMN object_type VARCHAR(64)",
  "ALTER TABLE notification_deliveries ADD COLUMN object_number INT",
  "ALTER TABLE notification_deliveries ADD COLUMN dedupe_key VARCHAR(512)",
  "ALTER TABLE notification_deliveries ADD COLUMN dry_run TINYINT NOT NULL DEFAULT 0",
  "ALTER TABLE notification_deliveries ADD COLUMN payload_json LONGTEXT",
  "ALTER TABLE notification_deliveries ADD COLUMN repo_id BIGINT"
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
    for (const statement of schemaStatements) {
      await connection.query(statement);
    }
    for (const statement of compatibilityStatements) {
      await executeIgnoringDuplicateIndex(connection, statement);
    }
    for (const statement of indexStatements) {
      await executeIgnoringDuplicateIndex(connection, statement);
    }
    await connection.query(
      `INSERT INTO schema_migrations(version, name, applied_at)
       VALUES('0001', 'initial_mvp0_schema', UTC_TIMESTAMP())
       ON DUPLICATE KEY UPDATE applied_at = applied_at`
    );
  } finally {
    await connection.end();
  }
}
