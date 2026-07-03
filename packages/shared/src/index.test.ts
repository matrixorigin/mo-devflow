import { describe, expect, test } from "vitest";
import { buildGitHubWriteCapabilities } from "./index";

describe("GitHub write capabilities", () => {
  test("requires a validated connected token before issue label writes are enabled", () => {
    const capabilities = buildGitHubWriteCapabilities({
      tokenScopes: ["repo"],
      tokenLastValidatedAt: null
    });

    expect(capabilities.issueLabels).toMatchObject({
      enabled: false,
      status: "missing_token"
    });
  });

  test("enables issue label writes for classic repo scope", () => {
    const capabilities = buildGitHubWriteCapabilities({
      tokenScopes: ["read:user", "repo"],
      tokenLastValidatedAt: "2026-07-04T00:00:00.000Z"
    });

    expect(capabilities.issueLabels).toMatchObject({
      enabled: true,
      status: "ready"
    });
  });

  test("enables issue label writes for classic public_repo scope", () => {
    const capabilities = buildGitHubWriteCapabilities({
      tokenScopes: ["public_repo"],
      tokenLastValidatedAt: "2026-07-04T00:00:00.000Z"
    });

    expect(capabilities.issueLabels).toMatchObject({
      enabled: true,
      status: "ready"
    });
  });

  test("keeps issue label writes disabled for insufficient classic scopes", () => {
    const capabilities = buildGitHubWriteCapabilities({
      tokenScopes: ["read:user"],
      tokenLastValidatedAt: "2026-07-04T00:00:00.000Z"
    });

    expect(capabilities.issueLabels).toMatchObject({
      enabled: false,
      status: "insufficient_scope"
    });
  });

  test("keeps issue label writes disabled when GitHub did not report classic scopes", () => {
    const capabilities = buildGitHubWriteCapabilities({
      tokenScopes: [],
      tokenLastValidatedAt: "2026-07-04T00:00:00.000Z"
    });

    expect(capabilities.issueLabels).toMatchObject({
      enabled: false,
      status: "scope_unverified"
    });
  });
});
