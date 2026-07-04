#!/usr/bin/env node
const [url, labelArg = "Service", timeoutArg = "30000", jsonPath, expectedValue] = process.argv.slice(2);

if (!url) {
  console.error("Usage: node scripts/wait-for-url.mjs <url> [label] [timeout-ms] [json.path] [expected-value]");
  process.exit(2);
}

if (jsonPath && expectedValue === undefined) {
  console.error("expected-value is required when json.path is provided");
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

function valueAtPath(value, path) {
  return path.split(".").reduce((current, key) => {
    if (current === null || typeof current !== "object" || !(key in current)) {
      return undefined;
    }
    return current[key];
  }, value);
}

const startedAt = Date.now();
let lastError = "not attempted";

while (Date.now() - startedAt < timeoutMs) {
  const remainingMs = timeoutMs - (Date.now() - startedAt);
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(Math.max(250, Math.min(2_000, remainingMs)))
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    if (jsonPath) {
      const body = await response.json();
      const actualValue = valueAtPath(body, jsonPath);
      if (String(actualValue) !== expectedValue) {
        throw new Error(`${jsonPath}=${JSON.stringify(actualValue)} expected ${expectedValue}`);
      }
    } else {
      await response.arrayBuffer();
    }

    console.log(`${label} ready (${url})`);
    process.exit(0);
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
    await sleep(250);
  }
}

console.error(`${label} not ready after ${timeoutMs}ms: ${lastError}`);
process.exit(1);
