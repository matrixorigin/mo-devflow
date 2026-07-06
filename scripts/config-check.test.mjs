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

const notificationEnabledProfile = {
  notifications: {
    wecom: {
      enabled: true,
      webhook_url_env: "MO_DEVFLOW_WECOM_WEBHOOK_URL"
    }
  }
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
      "Service read token",
      "Notification dashboard URL"
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
      MO_DEVFLOW_ALLOWED_ORIGINS: "https://devflow.example.com",
      MO_DEVFLOW_DASHBOARD_URL: "https://devflow.example.com/app",
      MO_DEVFLOW_WECOM_WEBHOOK_URL: "https://wecom.example.test/webhook"
    };
    const checks = buildConfigCheck(env, { production: true, profile: notificationEnabledProfile });
    const serialized = JSON.stringify(checks);

    expect(summarizeChecks(checks)).toEqual({ failures: [], warnings: [] });
    expect(serialized).not.toContain("client-secret");
    expect(serialized).not.toContain("service-token");
    expect(serialized).not.toContain("wecom.example.test");
  });

  test("accepts explicit secure cookies in production checks", () => {
    const summary = summarizeChecks(
      buildConfigCheck(
        {
          ...baseEnv,
          MO_DEVFLOW_GITHUB_OAUTH_CLIENT_ID: "client-id",
          MO_DEVFLOW_GITHUB_OAUTH_CLIENT_SECRET: "client-secret",
          MO_DEVFLOW_GITHUB_TOKEN: "service-token",
          MO_DEVFLOW_COOKIE_SECURE: "true",
          MO_DEVFLOW_DASHBOARD_URL: "https://devflow.example.com"
        },
        { production: true }
      )
    );

    expect(summary).toEqual({ failures: [], warnings: [] });
  });

  test("rejects explicit http OAuth URLs and allowed origins in production", () => {
    const summary = summarizeChecks(
      buildConfigCheck(
        {
          ...baseEnv,
          NODE_ENV: "production",
          MO_DEVFLOW_GITHUB_OAUTH_CLIENT_ID: "client-id",
          MO_DEVFLOW_GITHUB_OAUTH_CLIENT_SECRET: "client-secret",
          MO_DEVFLOW_GITHUB_TOKEN: "service-token",
          MO_DEVFLOW_PUBLIC_URL: "http://devflow.example.com",
          MO_DEVFLOW_GITHUB_OAUTH_REDIRECT_URI: "http://devflow.example.com/api/auth/github/callback",
          MO_DEVFLOW_ALLOWED_ORIGINS: "http://devflow.example.com",
          MO_DEVFLOW_DASHBOARD_URL: "http://devflow.example.com"
        },
        { production: true }
      )
    );

    expect(summary.failures.map((failure) => failure.name)).toEqual([
      "OAuth callback URL",
      "Allowed browser origins",
      "Notification dashboard URL"
    ]);
  });

  test("keeps local http development URLs valid", () => {
    const summary = summarizeChecks(
      buildConfigCheck({
        ...baseEnv,
        MO_DEVFLOW_PUBLIC_URL: "http://localhost:18081",
        MO_DEVFLOW_GITHUB_OAUTH_REDIRECT_URI: "http://localhost:18081/api/auth/github/callback",
        MO_DEVFLOW_ALLOWED_ORIGINS: "http://localhost:5173",
        MO_DEVFLOW_DASHBOARD_URL: "http://localhost:5173/app"
      })
    );

    expect(summary.failures).toEqual([]);
  });

  test("rejects ambiguous notification dashboard URLs before deployment", () => {
    const baseProductionEnv = {
      ...baseEnv,
      NODE_ENV: "production",
      MO_DEVFLOW_GITHUB_OAUTH_CLIENT_ID: "client-id",
      MO_DEVFLOW_GITHUB_OAUTH_CLIENT_SECRET: "client-secret",
      MO_DEVFLOW_GITHUB_TOKEN: "service-token",
      MO_DEVFLOW_PUBLIC_URL: "https://devflow.example.com",
      MO_DEVFLOW_ALLOWED_ORIGINS: "https://devflow.example.com"
    };

    for (const dashboardUrl of [
      "not-a-url",
      "https://devflow.example.com/app?team=mo",
      "https://devflow.example.com/app#prs"
    ]) {
      const summary = summarizeChecks(
        buildConfigCheck(
          {
            ...baseProductionEnv,
            MO_DEVFLOW_DASHBOARD_URL: dashboardUrl
          },
          { production: true }
        )
      );

      expect(summary.failures.map((failure) => failure.name)).toEqual(["Notification dashboard URL"]);
    }
  });

  test("checks profile-enabled WeCom webhook env without printing the webhook URL", () => {
    const completeProductionEnv = {
      ...baseEnv,
      NODE_ENV: "production",
      MO_DEVFLOW_GITHUB_OAUTH_CLIENT_ID: "client-id",
      MO_DEVFLOW_GITHUB_OAUTH_CLIENT_SECRET: "client-secret",
      MO_DEVFLOW_GITHUB_TOKEN: "service-token",
      MO_DEVFLOW_PUBLIC_URL: "https://devflow.example.com",
      MO_DEVFLOW_ALLOWED_ORIGINS: "https://devflow.example.com",
      MO_DEVFLOW_DASHBOARD_URL: "https://devflow.example.com"
    };

    const missing = buildConfigCheck(completeProductionEnv, {
      production: true,
      profile: notificationEnabledProfile
    });
    expect(summarizeChecks(missing).failures.map((failure) => failure.name)).toEqual(["WeCom notification webhook"]);

    const invalid = buildConfigCheck(
      {
        ...completeProductionEnv,
        MO_DEVFLOW_WECOM_WEBHOOK_URL: "http://wecom.example.test/webhook"
      },
      { production: true, profile: notificationEnabledProfile }
    );
    expect(summarizeChecks(invalid).failures.map((failure) => failure.name)).toEqual(["WeCom notification webhook"]);
    expect(JSON.stringify(invalid)).not.toContain("wecom.example.test");
  });

  test("does not require WeCom webhook env when profile notifications are disabled", () => {
    const summary = summarizeChecks(
      buildConfigCheck(baseEnv, {
        profile: {
          notifications: {
            wecom: { enabled: false, webhook_url_env: "MO_DEVFLOW_WECOM_WEBHOOK_URL" }
          }
        }
      })
    );

    expect(summary.failures).toEqual([]);
  });

  test("fails when the repository profile cannot be loaded", () => {
    const summary = summarizeChecks(buildConfigCheck(baseEnv, { profileLoadError: new Error("bad profile") }));

    expect(summary.failures.map((failure) => failure.name)).toEqual(["Repository profile"]);
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
