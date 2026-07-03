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
  `CREATE TABLE IF NOT EXISTS notification_deliveries (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    attention_item_id BIGINT NOT NULL,
    channel VARCHAR(64) NOT NULL,
    recipient VARCHAR(255) NOT NULL,
    status VARCHAR(32) NOT NULL,
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
  "CREATE INDEX idx_attention_repo_resolved ON attention_items(repo_id, resolved_at)"
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
  "ALTER TABLE pull_requests ADD COLUMN detail_error TEXT"
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
