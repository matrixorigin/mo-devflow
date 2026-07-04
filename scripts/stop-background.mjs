#!/usr/bin/env node
import { existsSync, readFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";

const [pidFile, serviceName = "Service"] = process.argv.slice(2);

if (!pidFile) {
  console.error("Usage: node scripts/stop-background.mjs <pid-file> [service-name]");
  process.exit(2);
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

function killPid(pid, signal) {
  try {
    process.kill(pid, signal);
  } catch {
    // Process already exited or belongs to a process group we cannot signal.
  }
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function waitForExit(pids, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (pids.every((pid) => !isAlive(pid))) {
      return true;
    }
    await sleep(100);
  }
  return pids.every((pid) => !isAlive(pid));
}

if (!existsSync(pidFile)) {
  console.log(`${serviceName} not running`);
  process.exit(0);
}

const rootPid = parsePid(readFileSync(pidFile, "utf8"));
if (!rootPid) {
  rmSync(pidFile, { force: true });
  console.log(`${serviceName} stopped`);
  process.exit(0);
}

const pids = collectProcessTree(rootPid).reverse();
killPid(-rootPid, "SIGTERM");
for (const pid of pids) {
  killPid(pid, "SIGTERM");
}

if (!(await waitForExit(pids, 2_000))) {
  killPid(-rootPid, "SIGKILL");
  for (const pid of pids) {
    killPid(pid, "SIGKILL");
  }
  await waitForExit(pids, 1_000);
}

rmSync(pidFile, { force: true });
console.log(`${serviceName} stopped`);
