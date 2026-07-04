import mysql, { type Pool } from "mysql2/promise";

export interface DbConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  connectTimeoutMs: number;
  connectionLimit: number;
}

let pool: Pool | null = null;

export function getDbConfig(env: Record<string, string | undefined> = process.env): DbConfig {
  return {
    host: env.MO_DEVFLOW_DB_HOST ?? "127.0.0.1",
    port: positiveIntegerFromEnv(env.MO_DEVFLOW_DB_PORT, 6001, 1),
    user: env.MO_DEVFLOW_DB_USER ?? "root",
    password: env.MO_DEVFLOW_DB_PASSWORD ?? "111",
    database: env.MO_DEVFLOW_DB_NAME ?? "mo_devflow",
    connectTimeoutMs: positiveIntegerFromEnv(env.MO_DEVFLOW_DB_CONNECT_TIMEOUT_MS, 3_000, 500),
    connectionLimit: positiveIntegerFromEnv(env.MO_DEVFLOW_DB_CONNECTION_LIMIT, 10, 1)
  };
}

export function getPool(): Pool {
  if (!pool) {
    const config = getDbConfig();
    pool = mysql.createPool({
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
      database: config.database,
      waitForConnections: true,
      connectionLimit: config.connectionLimit,
      connectTimeout: config.connectTimeoutMs,
      namedPlaceholders: true,
      timezone: "Z",
      dateStrings: true
    });
  }
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

export async function pingDatabase(): Promise<void> {
  await getPool().query("SELECT 1");
}

function positiveIntegerFromEnv(value: string | undefined, fallback: number, min: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min) {
    return fallback;
  }
  return parsed;
}

export function sqlDate(value: string | Date | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const date = typeof value === "string" ? new Date(value) : value;
  if (!Number.isFinite(date.getTime())) {
    return null;
  }
  return date.toISOString().slice(0, 19).replace("T", " ");
}

export function nowSql(): string {
  return sqlDate(new Date()) ?? "1970-01-01 00:00:00";
}

export function fromSqlDate(value: unknown): string | null {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "string") {
    if (value.includes("T")) {
      return value;
    }
    return `${value.replace(" ", "T")}Z`;
  }
  return null;
}
