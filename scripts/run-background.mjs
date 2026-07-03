#!/usr/bin/env node
import { spawn } from "node:child_process";
import { openSync, writeFileSync } from "node:fs";

const [pidFile, logFile, separator, ...command] = process.argv.slice(2);

if (!pidFile || !logFile || separator !== "--" || command.length === 0) {
  console.error("Usage: node scripts/run-background.mjs <pid-file> <log-file> -- <command> [args...]");
  process.exit(2);
}

const logFd = openSync(logFile, "a");
const child = spawn(command[0], command.slice(1), {
  cwd: process.cwd(),
  detached: true,
  env: process.env,
  stdio: ["ignore", logFd, logFd]
});

writeFileSync(pidFile, `${child.pid}\n`);
child.unref();
