import { describe, expect, test } from "vitest";
import { buildGitHubWriteCapabilities, notificationStatusRequiresAcknowledgement } from "./index";

describe("GitHub write capabilities", () => {
  test("requires a validated connected token before issue label writes are enabled", () => {
    const capabilities = buildGitHubWriteCapabilities({
      writeBackEnabled: true,
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
      writeBackEnabled: true,
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
      writeBackEnabled: true,
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
      writeBackEnabled: true,
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
      writeBackEnabled: true,
      tokenScopes: [],
      tokenLastValidatedAt: "2026-07-04T00:00:00.000Z"
    });

    expect(capabilities.issueLabels).toMatchObject({
      enabled: false,
      status: "scope_unverified"
    });
  });

  test("keeps issue label writes disabled when repo write-back is disabled", () => {
    const capabilities = buildGitHubWriteCapabilities({
      writeBackEnabled: false,
      tokenScopes: ["repo"],
      tokenLastValidatedAt: "2026-07-04T00:00:00.000Z"
    });

    expect(capabilities.issueLabels).toMatchObject({
      enabled: false,
      status: "write_back_disabled"
    });
    expect(capabilities.issueLabels.message).toContain("disabled in the repository profile");
  });
});

describe("notification acknowledgement policy", () => {
  test("only sent notification deliveries require acknowledgement", () => {
    expect(notificationStatusRequiresAcknowledgement("sent")).toBe(true);
    expect(notificationStatusRequiresAcknowledgement("dry_run")).toBe(false);
    expect(notificationStatusRequiresAcknowledgement("failed")).toBe(false);
    expect(notificationStatusRequiresAcknowledgement("skipped_disabled")).toBe(false);
    expect(notificationStatusRequiresAcknowledgement("skipped_no_webhook")).toBe(false);
    expect(notificationStatusRequiresAcknowledgement("skipped_quiet_hours")).toBe(false);
  });
});
