import { describe, expect, test } from "vitest";
import { buildConfigCheck, parseEnvFile, summarizeChecks } from "./config-check.mjs";

const baseEnv = {
  MO_DEVFLOW_DB_HOST: "127.0.0.1",
  MO_DEVFLOW_DB_PORT: "6001",
  MO_DEVFLOW_DB_USER: "mo_devflow",
  MO_DEVFLOW_DB_NAME: "mo_devflow",
  MO_DEVFLOW_TOKEN_ENCRYPTION_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
  MO_DEVFLOW_GITHUB_WEBHOOK_SECRET: "01234567890123456789"
};

describe("config check", () => {
  test("parses env files without exposing comments or quotes", () => {
    expect(
      parseEnvFile(`
# comment
MO_DEVFLOW_DB_HOST=127.0.0.1
MO_DEVFLOW_DB_NAME="mo_devflow"
`)
    ).toEqual({
      MO_DEVFLOW_DB_HOST: "127.0.0.1",
      MO_DEVFLOW_DB_NAME: "mo_devflow"
    });
  });

  test("treats missing OAuth and service token as local warnings", () => {
    const summary = summarizeChecks(buildConfigCheck(baseEnv));

    expect(summary.failures).toEqual([]);
    expect(summary.warnings.map((warning) => warning.name)).toEqual(["GitHub OAuth login", "Service read token"]);
  });

  test("requires OAuth and service read token in production mode", () => {
    const summary = summarizeChecks(buildConfigCheck(baseEnv, { production: true }));

    expect(summary.failures.map((failure) => failure.name)).toEqual([
      "GitHub OAuth login",
      "Session cookie secure flag",
      "Service read token"
    ]);
  });

  test("accepts complete production setup without returning secret values", () => {
    const env = {
      ...baseEnv,
      NODE_ENV: "production",
      MO_DEVFLOW_GITHUB_OAUTH_CLIENT_ID: "client-id",
      MO_DEVFLOW_GITHUB_OAUTH_CLIENT_SECRET: "client-secret",
      MO_DEVFLOW_GITHUB_TOKEN: "service-token",
      MO_DEVFLOW_PUBLIC_URL: "https://devflow.example.com",
      MO_DEVFLOW_ALLOWED_ORIGINS: "https://devflow.example.com"
    };
    const checks = buildConfigCheck(env, { production: true });
    const serialized = JSON.stringify(checks);

    expect(summarizeChecks(checks)).toEqual({ failures: [], warnings: [] });
    expect(serialized).not.toContain("client-secret");
    expect(serialized).not.toContain("service-token");
  });

  test("accepts explicit secure cookies in production checks", () => {
    const summary = summarizeChecks(
      buildConfigCheck(
        {
          ...baseEnv,
          MO_DEVFLOW_GITHUB_OAUTH_CLIENT_ID: "client-id",
          MO_DEVFLOW_GITHUB_OAUTH_CLIENT_SECRET: "client-secret",
          MO_DEVFLOW_GITHUB_TOKEN: "service-token",
          MO_DEVFLOW_COOKIE_SECURE: "true"
        },
        { production: true }
      )
    );

    expect(summary).toEqual({ failures: [], warnings: [] });
  });

  test("fails unsafe values before startup", () => {
    const summary = summarizeChecks(
      buildConfigCheck({
        ...baseEnv,
        MO_DEVFLOW_DB_PORT: "99999",
        MO_DEVFLOW_TOKEN_ENCRYPTION_KEY: "too-short",
        MO_DEVFLOW_COOKIE_SECURE: "sometimes",
        MO_DEVFLOW_ALLOWED_ORIGINS: "https://devflow.example.com/app"
      })
    );

    expect(summary.failures.map((failure) => failure.name)).toEqual([
      "MatrixOne port",
      "Personal token encryption",
      "Session cookie secure flag",
      "Allowed browser origins"
    ]);
  });
});
