#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import dotenv from "dotenv";
import mysql from "mysql2/promise";

dotenv.config({ quiet: true });

const [pidFile, labelArg = "Worker", timeoutArg = "30000"] = process.argv.slice(2);

if (!pidFile) {
  console.error("Usage: node scripts/wait-for-worker-heartbeat.mjs <pid-file> [label] [timeout-ms]");
  process.exit(2);
}

const label = labelArg;
const timeoutMs = Number(timeoutArg);
if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
  console.error("timeout-ms must be a positive number");
  process.exit(2);
}

let pool = null;

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function parsePid(value) {
  const pid = Number(String(value).trim());
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function childPids(pid) {
  const result = spawnSync("pgrep", ["-P", String(pid)], { encoding: "utf8" });
  if (result.status !== 0 || !result.stdout.trim()) {
    return [];
  }
  return result.stdout
    .trim()
    .split(/\s+/)
    .map(parsePid)
    .filter((childPid) => childPid !== null);
}

function collectProcessTree(rootPid, seen = new Set()) {
  if (seen.has(rootPid)) {
    return [];
  }
  seen.add(rootPid);
  return [rootPid, ...childPids(rootPid).flatMap((childPid) => collectProcessTree(childPid, seen))];
}

function staleAfterSeconds() {
  const configured = Number(process.env.MO_DEVFLOW_WORKER_HEARTBEAT_STALE_SECONDS);
  if (Number.isFinite(configured) && configured > 0) {
    return Math.max(30, Math.floor(configured));
  }
  const tickSeconds = Number(process.env.MO_DEVFLOW_WORKER_TICK_SECONDS ?? "30");
  const effectiveTickSeconds = Number.isFinite(tickSeconds) && tickSeconds > 0 ? tickSeconds : 30;
  return Math.max(120, Math.floor(effectiveTickSeconds * 3));
}

function heartbeatMillis(value) {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    return value.getTime();
  }
  const text = String(value);
  const date = new Date(text.includes("T") ? text : `${text.replace(" ", "T")}Z`);
  return Number.isFinite(date.getTime()) ? date.getTime() : null;
}

function getPool() {
  pool ??= mysql.createPool({
    host: process.env.MO_DEVFLOW_DB_HOST ?? "127.0.0.1",
    port: Number(process.env.MO_DEVFLOW_DB_PORT ?? "6001"),
    user: process.env.MO_DEVFLOW_DB_USER ?? "root",
    password: process.env.MO_DEVFLOW_DB_PASSWORD ?? "",
    database: process.env.MO_DEVFLOW_DB_NAME ?? "mo_devflow",
    waitForConnections: true,
    connectionLimit: 1,
    dateStrings: true,
    timezone: "Z"
  });
  return pool;
}

async function readHeartbeat(pids) {
  const placeholders = pids.map(() => "?").join(", ");
  const [rows] = await getPool().execute(
    `SELECT process_id, phase, heartbeat_at, last_error
     FROM worker_heartbeats
     WHERE process_id IN (${placeholders})
     ORDER BY heartbeat_at DESC, id DESC
     LIMIT 1`,
    pids
  );
  return rows[0] ?? null;
}

async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

const startedAt = Date.now();
const staleMs = staleAfterSeconds() * 1000;
let lastError = "pid file not found";

while (Date.now() - startedAt < timeoutMs) {
  if (!existsSync(pidFile)) {
    lastError = "pid file not found";
    await sleep(250);
    continue;
  }

  const pid = parsePid(readFileSync(pidFile, "utf8"));
  if (!pid) {
    lastError = "pid file is invalid";
    await sleep(250);
    continue;
  }

  if (!isAlive(pid)) {
    lastError = `PID ${pid} is not running`;
    await sleep(250);
    continue;
  }

  try {
    const pids = collectProcessTree(pid);
    const heartbeat = await readHeartbeat(pids);
    if (!heartbeat) {
      lastError = `no heartbeat recorded for process tree ${pids.join(", ")}`;
      await sleep(250);
      continue;
    }

    const phase = String(heartbeat.phase ?? "");
    if (phase === "failed" || phase === "stopped") {
      const detail = heartbeat.last_error ? `: ${heartbeat.last_error}` : "";
      lastError = `heartbeat phase is ${phase}${detail}`;
      await sleep(250);
      continue;
    }

    const lastHeartbeatAt = heartbeatMillis(heartbeat.heartbeat_at);
    if (lastHeartbeatAt === null) {
      lastError = "heartbeat timestamp is invalid";
      await sleep(250);
      continue;
    }

    const ageMs = Date.now() - lastHeartbeatAt;
    if (ageMs > staleMs) {
      lastError = `heartbeat is ${Math.round(ageMs / 1000)}s old`;
      await sleep(250);
      continue;
    }

    console.log(`${label} heartbeat ready (root PID ${pid}, heartbeat PID ${heartbeat.process_id}, phase ${phase})`);
    await closePool();
    process.exit(0);
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
    await sleep(250);
  }
}

await closePool();
console.error(`${label} heartbeat not ready after ${timeoutMs}ms: ${lastError}`);
process.exit(1);
