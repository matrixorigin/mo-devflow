import mysql, { type Pool } from "mysql2/promise";

export interface DbConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

let pool: Pool | null = null;

export function getDbConfig(): DbConfig {
  return {
    host: process.env.MO_DEVFLOW_DB_HOST ?? "127.0.0.1",
    port: Number(process.env.MO_DEVFLOW_DB_PORT ?? "6001"),
    user: process.env.MO_DEVFLOW_DB_USER ?? "root",
    password: process.env.MO_DEVFLOW_DB_PASSWORD ?? "111",
    database: process.env.MO_DEVFLOW_DB_NAME ?? "mo_devflow"
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
      connectionLimit: 10,
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
