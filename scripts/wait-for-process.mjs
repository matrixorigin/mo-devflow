#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";

const [pidFile, labelArg = "Process", timeoutArg = "5000"] = process.argv.slice(2);

if (!pidFile) {
  console.error("Usage: node scripts/wait-for-process.mjs <pid-file> [label] [timeout-ms]");
  process.exit(2);
}

const label = labelArg;
const timeoutMs = Number(timeoutArg);
if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
  console.error("timeout-ms must be a positive number");
  process.exit(2);
}

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

const startedAt = Date.now();
let lastError = "pid file not found";

while (Date.now() - startedAt < timeoutMs) {
  if (!existsSync(pidFile)) {
    lastError = "pid file not found";
    await sleep(100);
    continue;
  }

  const pid = parsePid(readFileSync(pidFile, "utf8"));
  if (!pid) {
    lastError = "pid file is invalid";
    await sleep(100);
    continue;
  }

  if (isAlive(pid)) {
    console.log(`${label} process ready (PID ${pid})`);
    process.exit(0);
  }

  lastError = `PID ${pid} is not running`;
  await sleep(100);
}

console.error(`${label} process not ready after ${timeoutMs}ms: ${lastError}`);
process.exit(1);
