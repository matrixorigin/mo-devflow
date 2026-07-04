#!/usr/bin/env node
import mysql from "mysql2/promise";

function positiveInteger(value, fallback, minimum = 1) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= minimum ? parsed : fallback;
}

const config = {
  host: process.env.MO_DEVFLOW_DB_HOST ?? "127.0.0.1",
  port: positiveInteger(process.env.MO_DEVFLOW_DB_PORT, 6001),
  user: process.env.MO_DEVFLOW_DB_USER ?? "root",
  password: process.env.MO_DEVFLOW_DB_PASSWORD ?? "",
  database: process.env.MO_DEVFLOW_DB_NAME ?? "mo_devflow",
  connectTimeout: positiveInteger(process.env.MO_DEVFLOW_DB_CONNECT_TIMEOUT_MS, 3_000, 500)
};

function actionForError(error) {
  if (!error || typeof error !== "object") {
    return "Check MatrixOne status and MO_DEVFLOW_DB_* configuration.";
  }
  if (error.code === "ER_ACCESS_DENIED_ERROR") {
    return "Credentials were rejected. Set MO_DEVFLOW_DB_USER and MO_DEVFLOW_DB_PASSWORD in .env or export them before starting services.";
  }
  if (error.code === "ER_BAD_DB_ERROR") {
    return "The configured database does not exist. Run `make db-create` and then `make db-migrate`.";
  }
  if (error.code === "ECONNREFUSED" || error.code === "ETIMEDOUT" || error.code === "ENOTFOUND") {
    return "MatrixOne is not reachable. Start MatrixOne or correct MO_DEVFLOW_DB_HOST and MO_DEVFLOW_DB_PORT.";
  }
  return "Check MatrixOne status, database migrations, and MO_DEVFLOW_DB_* configuration.";
}

let connection;
let exitCode = 0;
try {
  connection = await mysql.createConnection(config);
  await connection.query("SELECT 1");
  console.log(`Database ready (${config.user}@${config.host}:${config.port}/${config.database})`);
} catch (error) {
  const code = error && typeof error === "object" && "code" in error ? error.code : "unknown";
  console.error("MatrixOne database is not ready for mo-devflow.");
  console.error(`Target: ${config.user}@${config.host}:${config.port}/${config.database}`);
  console.error(`Reason: ${String(code)}`);
  console.error(`Action: ${actionForError(error)}`);
  exitCode = 1;
} finally {
  if (connection) {
    connection.destroy();
  }
}

process.exit(exitCode);
