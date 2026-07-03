import { describe, expect, test } from "vitest";
import { githubTokenFailureForWorkflowRead } from "./githubTokenFailures";

describe("GitHub token failure mapping", () => {
  test("requires reconnect when GitHub rejects authentication", () => {
    const failure = githubTokenFailureForWorkflowRead({
      status: 401,
      message: "Bad credentials",
      response: { headers: { "x-ratelimit-remaining": "50" } }
    });

    expect(failure).toMatchObject({
      statusCode: 401,
      error: "github_token_reconnect_required",
      shouldRevokeToken: true
    });
  });

  test("requires reconnect when GitHub denies repository access", () => {
    const failure = githubTokenFailureForWorkflowRead({
      status: 403,
      message: "Resource not accessible by personal access token",
      response: { headers: { "x-ratelimit-remaining": "50" } }
    });

    expect(failure).toMatchObject({
      statusCode: 403,
      error: "github_token_reconnect_required",
      shouldRevokeToken: true
    });
  });

  test("does not revoke on not found because the issue may be deleted or transferred", () => {
    const failure = githubTokenFailureForWorkflowRead({
      status: 404,
      message: "Not Found",
      response: { headers: { "x-ratelimit-remaining": "50" } }
    });

    expect(failure).toMatchObject({
      statusCode: 409,
      error: "github_target_unavailable",
      shouldRevokeToken: false
    });
  });

  test("leaves rate limits for retry/backoff handling instead of reconnect", () => {
    const failure = githubTokenFailureForWorkflowRead({
      status: 403,
      message: "API rate limit exceeded",
      response: { headers: { "x-ratelimit-remaining": "0" } }
    });

    expect(failure).toBeNull();
  });
});
