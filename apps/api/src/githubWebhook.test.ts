import { describe, expect, test } from "vitest";
import {
  computeGitHubWebhookSignature,
  isValidGitHubWebhookSignature,
  webhookActionFromPayload,
  webhookRepositoryFullNameFromPayload
} from "./githubWebhook";

describe("GitHub webhook helpers", () => {
  test("validates sha256 signatures against the exact raw body", () => {
    const rawBody = JSON.stringify({ action: "opened", issue: { number: 42 } });
    const signature = computeGitHubWebhookSignature("secret", rawBody);

    expect(
      isValidGitHubWebhookSignature({
        secret: "secret",
        rawBody,
        signatureHeader: signature
      })
    ).toBe(true);
  });

  test("rejects missing, malformed, and mismatched signatures", () => {
    const rawBody = JSON.stringify({ action: "opened" });

    expect(
      isValidGitHubWebhookSignature({
        secret: "secret",
        rawBody,
        signatureHeader: null
      })
    ).toBe(false);
    expect(
      isValidGitHubWebhookSignature({
        secret: "secret",
        rawBody,
        signatureHeader: "sha1=bad"
      })
    ).toBe(false);
    expect(
      isValidGitHubWebhookSignature({
        secret: "secret",
        rawBody: `${rawBody} `,
        signatureHeader: computeGitHubWebhookSignature("secret", rawBody)
      })
    ).toBe(false);
  });

  test("extracts action only from object payloads", () => {
    expect(webhookActionFromPayload({ action: "synchronize" })).toBe("synchronize");
    expect(webhookActionFromPayload({ action: 1 })).toBeNull();
    expect(webhookActionFromPayload([])).toBeNull();
    expect(webhookActionFromPayload(null)).toBeNull();
  });

  test("extracts repository full name only from GitHub-shaped payloads", () => {
    expect(webhookRepositoryFullNameFromPayload({ repository: { full_name: "matrixorigin/matrixone" } })).toBe(
      "matrixorigin/matrixone"
    );
    expect(webhookRepositoryFullNameFromPayload({ repository: { full_name: 42 } })).toBeNull();
    expect(webhookRepositoryFullNameFromPayload({ repository: [] })).toBeNull();
  });
});
