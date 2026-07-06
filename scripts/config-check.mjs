#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const defaultEnvPath = ".env";

export function parseEnvFile(content) {
  const values = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) {
      continue;
    }
    const key = match[1];
    const rawValue = match[2] ?? "";
    values[key] = unquoteEnvValue(rawValue.trim());
  }
  return values;
}

export function buildConfigCheck(env, options = {}) {
  const production = Boolean(options.production);
  const checks = [];
  const add = (status, name, detail, action) => checks.push({ status, name, detail, action });

  add(
    required(env.MO_DEVFLOW_DB_HOST) ? "ok" : "fail",
    "MatrixOne host",
    "MO_DEVFLOW_DB_HOST",
    "Set MO_DEVFLOW_DB_HOST."
  );
  add(
    validPort(env.MO_DEVFLOW_DB_PORT ?? "6001") ? "ok" : "fail",
    "MatrixOne port",
    "MO_DEVFLOW_DB_PORT",
    "Set MO_DEVFLOW_DB_PORT to a TCP port."
  );
  add(
    required(env.MO_DEVFLOW_DB_USER) ? "ok" : "fail",
    "MatrixOne user",
    "MO_DEVFLOW_DB_USER",
    "Set MO_DEVFLOW_DB_USER."
  );
  add(
    required(env.MO_DEVFLOW_DB_NAME) ? "ok" : "fail",
    "MatrixOne database",
    "MO_DEVFLOW_DB_NAME",
    "Set MO_DEVFLOW_DB_NAME."
  );

  const tokenKey = env.MO_DEVFLOW_TOKEN_ENCRYPTION_KEY;
  add(
    tokenKey ? (validTokenEncryptionKey(tokenKey) ? "ok" : "fail") : "fail",
    "Personal token encryption",
    "MO_DEVFLOW_TOKEN_ENCRYPTION_KEY",
    tokenKey
      ? "Generate a 32-byte base64 key with: openssl rand -base64 32"
      : "Run make setup locally or set MO_DEVFLOW_TOKEN_ENCRYPTION_KEY in secret management."
  );

  const webhookSecret = env.MO_DEVFLOW_GITHUB_WEBHOOK_SECRET;
  add(
    webhookSecret ? (webhookSecret.trim().length >= 20 ? "ok" : "fail") : production ? "fail" : "warn",
    "GitHub webhook ingest",
    "MO_DEVFLOW_GITHUB_WEBHOOK_SECRET",
    webhookSecret
      ? "Use at least 20 random characters for the GitHub webhook secret."
      : "Set MO_DEVFLOW_GITHUB_WEBHOOK_SECRET and configure the same secret in GitHub for near real-time updates."
  );

  const oauthClientId = required(env.MO_DEVFLOW_GITHUB_OAUTH_CLIENT_ID);
  const oauthClientSecret = required(env.MO_DEVFLOW_GITHUB_OAUTH_CLIENT_SECRET);
  add(
    oauthClientId && oauthClientSecret ? "ok" : oauthClientId || oauthClientSecret || production ? "fail" : "warn",
    "GitHub OAuth login",
    "MO_DEVFLOW_GITHUB_OAUTH_CLIENT_ID / MO_DEVFLOW_GITHUB_OAUTH_CLIENT_SECRET",
    "Set both GitHub OAuth variables on the API server. Personal tokens are not login."
  );

  add(
    oauthUrlStatus(env, production),
    "OAuth callback URL",
    "MO_DEVFLOW_PUBLIC_URL / MO_DEVFLOW_GITHUB_OAUTH_REDIRECT_URI",
    production
      ? "Use absolute https URLs for deployed OAuth callback URLs; configure redirect URI when the API is behind a proxy."
      : "Use absolute http(s) URLs; configure redirect URI when the API is behind a proxy."
  );

  add(
    sessionCookieSecureStatus(env, production),
    "Session cookie secure flag",
    "MO_DEVFLOW_COOKIE_SECURE / NODE_ENV",
    production
      ? "Set NODE_ENV=production or MO_DEVFLOW_COOKIE_SECURE=true so OAuth sessions use Secure cookies."
      : "Use true, false, 1, or 0 when overriding MO_DEVFLOW_COOKIE_SECURE."
  );

  const serviceToken = required(env.MO_DEVFLOW_GITHUB_TOKEN) || required(env.GITHUB_TOKEN) || required(env.GH_TOKEN);
  add(
    serviceToken ? "ok" : production ? "fail" : "warn",
    "Service read token",
    "MO_DEVFLOW_GITHUB_TOKEN / GITHUB_TOKEN / GH_TOKEN",
    "Configure a deployment service read token for production-quality polling and evidence backfill."
  );

  add(
    validAllowedOrigins(env.MO_DEVFLOW_ALLOWED_ORIGINS, production),
    "Allowed browser origins",
    "MO_DEVFLOW_ALLOWED_ORIGINS",
    production
      ? "Use comma-separated https origins only, for example https://devflow.example.com."
      : "Use comma-separated origins only, for example https://devflow.example.com."
  );

  return checks;
}

export function summarizeChecks(checks) {
  return {
    failures: checks.filter((check) => check.status === "fail"),
    warnings: checks.filter((check) => check.status === "warn")
  };
}

function run() {
  const args = new Set(process.argv.slice(2));
  const production = args.has("--production");
  const envPathArg = process.argv.slice(2).find((arg) => !arg.startsWith("--"));
  const envPath = envPathArg ?? defaultEnvPath;
  const fileEnv = existsSync(envPath) ? parseEnvFile(readFileSync(envPath, "utf8")) : {};
  const env = { ...fileEnv, ...process.env };
  const checks = buildConfigCheck(env, { production });
  const { failures, warnings } = summarizeChecks(checks);

  console.log(`mo-devflow config check (${production ? "production" : "local"})`);
  console.log("Secrets are not printed.");
  for (const check of checks) {
    const marker = check.status === "ok" ? "ok" : check.status === "warn" ? "warn" : "fail";
    console.log(`${marker.padEnd(4)} ${check.name} - ${check.detail}`);
    if (check.status !== "ok") {
      console.log(`     ${check.action}`);
    }
  }

  if (failures.length > 0) {
    console.error(`${failures.length} configuration check${failures.length === 1 ? "" : "s"} failed.`);
    process.exitCode = 1;
    return;
  }
  if (warnings.length > 0) {
    console.log(`${warnings.length} configuration warning${warnings.length === 1 ? "" : "s"}.`);
    return;
  }
  console.log("All configuration checks passed.");
}

function required(value) {
  return Boolean(value?.trim());
}

function validPort(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 65535;
}

function validTokenEncryptionKey(raw) {
  const value = raw.startsWith("base64:") || raw.startsWith("hex:") ? raw.slice(raw.indexOf(":") + 1) : raw;
  const encoding = raw.startsWith("hex:") || /^[a-f0-9]{64}$/i.test(raw) ? "hex" : "base64";
  try {
    return Buffer.from(value, encoding).length === 32;
  } catch {
    return false;
  }
}

function validOptionalUrl(value) {
  if (!value?.trim()) {
    return true;
  }
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function oauthUrlStatus(env, production) {
  const values = [env.MO_DEVFLOW_PUBLIC_URL, env.MO_DEVFLOW_GITHUB_OAUTH_REDIRECT_URI].filter((value) =>
    value?.trim()
  );
  if (!values.every(validOptionalUrl)) {
    return "fail";
  }
  if (!production) {
    return "ok";
  }
  return values.every((value) => configuredUrlUsesHttps(value)) ? "ok" : "fail";
}

function configuredUrlUsesHttps(value) {
  try {
    return new URL(value.trim()).protocol === "https:";
  } catch {
    return false;
  }
}

function validAllowedOrigins(value, production = false) {
  if (!value?.trim()) {
    return "ok";
  }
  for (const origin of value.split(",")) {
    try {
      const parsed = new URL(origin.trim());
      if (!["http:", "https:"].includes(parsed.protocol)) {
        return "fail";
      }
      if (production && parsed.protocol !== "https:") {
        return "fail";
      }
      if (parsed.pathname !== "/" || parsed.search || parsed.hash) {
        return "fail";
      }
    } catch {
      return "fail";
    }
  }
  return "ok";
}

function sessionCookieSecureStatus(env, production) {
  const configured = env.MO_DEVFLOW_COOKIE_SECURE?.trim().toLowerCase();
  if (configured && !["true", "1", "false", "0"].includes(configured)) {
    return "fail";
  }
  const secure = configured === "true" || configured === "1" || (!configured && env.NODE_ENV === "production");
  if (production && !secure) {
    return "fail";
  }
  return "ok";
}

function unquoteEnvValue(value) {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

const entrypointUrl = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === entrypointUrl) {
  run();
}
