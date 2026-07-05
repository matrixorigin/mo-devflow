import type { AuthenticatedUserView, ConnectedGitHubUserView, GitHubRepoPermission } from "@mo-devflow/shared";
import { buildGitHubWriteCapabilities, parseJsonArray } from "@mo-devflow/shared";
import type { RowDataPacket } from "mysql2";
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

function isDuplicateError(error: unknown): boolean {
  const err = error as { code?: string; errno?: number; message?: string };
  return err.code === "ER_DUP_ENTRY" || err.errno === 1062 || (err.message ?? "").includes("Duplicate entry");
}

export interface GitHubTokenBindingRecord {
  githubId: string;
  githubLogin: string;
  avatarUrl: string | null;
  encryptedToken: string;
  tokenIv: string;
  tokenAuthTag: string;
  keyVersion: string;
  scopes: string[];
  repoPermission: GitHubRepoPermission;
  lastValidatedAt: string;
}

export interface SessionRecord {
  userId: number;
  githubLogin: string;
  githubId: string;
  avatarUrl: string | null;
  tokenScopes: string[];
  tokenRepoPermission: GitHubRepoPermission;
  tokenLastValidatedAt: string | null;
  sessionExpiresAt: string;
}

export interface StoredGitHubTokenRecord {
  encryptedToken: string;
  tokenIv: string;
  tokenAuthTag: string;
  keyVersion: string;
  scopes: string[];
  repoPermission: GitHubRepoPermission;
  lastValidatedAt: string | null;
}

export async function upsertGitHubTokenBinding(input: GitHubTokenBindingRecord): Promise<number> {
  const now = nowSql();
  const pool = getPool();

  try {
    await pool.execute(
      `INSERT INTO app_users(github_id, github_login, avatar_url, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
      [input.githubId, input.githubLogin, input.avatarUrl, now, now]
    );
  } catch (error) {
    if (!isDuplicateError(error)) {
      throw error;
    }
    await pool.execute(
      `UPDATE app_users
       SET github_login = ?, avatar_url = ?, updated_at = ?
       WHERE github_id = ?`,
      [input.githubLogin, input.avatarUrl, now, input.githubId]
    );
  }

  const [users] = await pool.execute<RowData[]>("SELECT id FROM app_users WHERE github_id = ? LIMIT 1", [
    input.githubId
  ]);
  const userId = asNumber(users[0]?.id);
  if (!userId) {
    throw new Error("GitHub user upsert failed.");
  }

  try {
    await pool.execute(
      `INSERT INTO user_github_tokens(
        user_id, encrypted_token, token_iv, token_auth_tag, key_version,
        scopes_json, repo_permission, last_validated_at, revoked_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
      [
        userId,
        input.encryptedToken,
        input.tokenIv,
        input.tokenAuthTag,
        input.keyVersion,
        stringify(input.scopes),
        input.repoPermission,
        sqlDate(input.lastValidatedAt),
        now,
        now
      ]
    );
  } catch (error) {
    if (!isDuplicateError(error)) {
      throw error;
    }
    await pool.execute(
      `UPDATE user_github_tokens
       SET encrypted_token = ?,
           token_iv = ?,
           token_auth_tag = ?,
           key_version = ?,
           scopes_json = ?,
           repo_permission = ?,
           last_validated_at = ?,
           revoked_at = NULL,
           updated_at = ?
       WHERE user_id = ?`,
      [
        input.encryptedToken,
        input.tokenIv,
        input.tokenAuthTag,
        input.keyVersion,
        stringify(input.scopes),
        input.repoPermission,
        sqlDate(input.lastValidatedAt),
        now,
        userId
      ]
    );
  }

  return userId;
}

export async function listConnectedGitHubUsers(input: {
  currentUserId: number;
  limit?: number;
}): Promise<ConnectedGitHubUserView[]> {
  const limit = Math.max(1, Math.min(100, input.limit ?? 24));
  const [rows] = await getPool().execute<RowData[]>(
    `SELECT
       u.id AS user_id,
       u.github_id,
       u.github_login,
       u.avatar_url,
       t.repo_permission,
       t.last_validated_at,
       COALESCE(s.active_session_count, 0) AS active_session_count,
       s.last_seen_at
     FROM app_users u
     LEFT JOIN user_github_tokens t ON t.user_id = u.id AND t.revoked_at IS NULL
     LEFT JOIN (
       SELECT user_id, COUNT(*) AS active_session_count, MAX(last_seen_at) AS last_seen_at
       FROM user_sessions
       WHERE revoked_at IS NULL
         AND expires_at > UTC_TIMESTAMP()
       GROUP BY user_id
     ) s ON s.user_id = u.id
     ORDER BY COALESCE(s.last_seen_at, t.last_validated_at, u.updated_at) DESC, u.github_login ASC
     LIMIT ?`,
    [limit]
  );

  return rows.map((row) => {
    const tokenLastValidatedAt = fromSqlDate(row.last_validated_at);
    return {
      githubLogin: asString(row.github_login),
      githubId: asString(row.github_id),
      avatarUrl: row.avatar_url ? asString(row.avatar_url) : null,
      tokenConnected: tokenLastValidatedAt !== null,
      tokenRepoPermission: (asString(row.repo_permission) || "none") as GitHubRepoPermission,
      tokenLastValidatedAt,
      activeSessionCount: asNumber(row.active_session_count),
      lastSeenAt: fromSqlDate(row.last_seen_at),
      isCurrentUser: asNumber(row.user_id) === input.currentUserId
    };
  });
}

export async function createUserSession(input: {
  userId: number;
  sessionHash: string;
  expiresAt: string;
}): Promise<void> {
  const now = nowSql();
  await getPool().execute(
    `INSERT INTO user_sessions(user_id, session_hash, created_at, last_seen_at, expires_at, revoked_at)
     VALUES (?, ?, ?, ?, ?, NULL)`,
    [input.userId, input.sessionHash, now, now, sqlDate(input.expiresAt)]
  );
}

export async function getActiveSession(sessionHash: string): Promise<SessionRecord | null> {
  const [rows] = await getPool().execute<RowData[]>(
    `SELECT
       s.user_id,
       s.expires_at,
       u.github_id,
       u.github_login,
       u.avatar_url,
       COALESCE(t.scopes_json, '[]') AS scopes_json,
       COALESCE(t.repo_permission, 'none') AS repo_permission,
       t.last_validated_at
     FROM user_sessions s
     JOIN app_users u ON u.id = s.user_id
     LEFT JOIN user_github_tokens t ON t.user_id = s.user_id AND t.revoked_at IS NULL
     WHERE s.session_hash = ?
       AND s.revoked_at IS NULL
       AND s.expires_at > UTC_TIMESTAMP()
     LIMIT 1`,
    [sessionHash]
  );
  const row = rows[0];
  if (!row) {
    return null;
  }

  await getPool().execute("UPDATE user_sessions SET last_seen_at = ? WHERE session_hash = ?", [nowSql(), sessionHash]);

  return {
    userId: asNumber(row.user_id),
    githubLogin: asString(row.github_login),
    githubId: asString(row.github_id),
    avatarUrl: row.avatar_url ? asString(row.avatar_url) : null,
    tokenScopes: parseJsonArray(asString(row.scopes_json)),
    tokenRepoPermission: asString(row.repo_permission) as GitHubRepoPermission,
    tokenLastValidatedAt: fromSqlDate(row.last_validated_at),
    sessionExpiresAt: fromSqlDate(row.expires_at) ?? new Date().toISOString()
  };
}

export async function revokeSession(sessionHash: string): Promise<void> {
  await getPool().execute(
    "UPDATE user_sessions SET revoked_at = ?, last_seen_at = ? WHERE session_hash = ? AND revoked_at IS NULL",
    [nowSql(), nowSql(), sessionHash]
  );
}

export async function revokeGitHubTokenForUser(userId: number): Promise<void> {
  await getPool().execute(
    `UPDATE user_github_tokens
     SET revoked_at = ?,
         updated_at = ?
     WHERE user_id = ? AND revoked_at IS NULL`,
    [nowSql(), nowSql(), userId]
  );
}

export async function getActiveGitHubTokenForUser(userId: number): Promise<StoredGitHubTokenRecord | null> {
  const [rows] = await getPool().execute<RowData[]>(
    `SELECT encrypted_token, token_iv, token_auth_tag, key_version, scopes_json, repo_permission, last_validated_at
     FROM user_github_tokens
     WHERE user_id = ? AND revoked_at IS NULL
     LIMIT 1`,
    [userId]
  );
  const row = rows[0];
  if (!row) {
    return null;
  }
  return {
    encryptedToken: asString(row.encrypted_token),
    tokenIv: asString(row.token_iv),
    tokenAuthTag: asString(row.token_auth_tag),
    keyVersion: asString(row.key_version),
    scopes: parseJsonArray(asString(row.scopes_json)),
    repoPermission: asString(row.repo_permission) as GitHubRepoPermission,
    lastValidatedAt: fromSqlDate(row.last_validated_at)
  };
}

export function toAuthenticatedUserView(
  record: SessionRecord,
  input: { writeBackEnabled: boolean }
): AuthenticatedUserView {
  return {
    githubLogin: record.githubLogin,
    githubId: record.githubId,
    avatarUrl: record.avatarUrl,
    tokenScopes: record.tokenScopes,
    tokenRepoPermission: record.tokenRepoPermission,
    tokenLastValidatedAt: record.tokenLastValidatedAt,
    sessionExpiresAt: record.sessionExpiresAt,
    writeCapabilities: buildGitHubWriteCapabilities({
      writeBackEnabled: input.writeBackEnabled,
      tokenScopes: record.tokenScopes,
      repoPermission: record.tokenRepoPermission,
      tokenLastValidatedAt: record.tokenLastValidatedAt
    })
  };
}
