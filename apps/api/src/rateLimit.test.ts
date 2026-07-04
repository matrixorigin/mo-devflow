import { describe, expect, test } from "vitest";
import { FixedWindowRateLimiter, tokenBindRateLimitConfigFromEnv } from "./rateLimit";

describe("rate limiting", () => {
  test("blocks requests after the fixed window limit is exhausted", () => {
    let now = 1_000;
    const limiter = new FixedWindowRateLimiter({
      maxAttempts: 2,
      windowMs: 1_000,
      now: () => now
    });

    expect(limiter.consume("client-1")).toMatchObject({
      allowed: true,
      limit: 2,
      remaining: 1
    });
    expect(limiter.consume("client-1")).toMatchObject({
      allowed: true,
      limit: 2,
      remaining: 0
    });
    expect(limiter.consume("client-1")).toMatchObject({
      allowed: false,
      limit: 2,
      remaining: 0,
      retryAfterSeconds: 1
    });

    now = 2_000;
    expect(limiter.consume("client-1")).toMatchObject({
      allowed: true,
      limit: 2,
      remaining: 1
    });
  });

  test("keeps rate limit counters isolated by key", () => {
    const limiter = new FixedWindowRateLimiter({
      maxAttempts: 1,
      windowMs: 1_000,
      now: () => 1_000
    });

    expect(limiter.consume("client-1").allowed).toBe(true);
    expect(limiter.consume("client-1").allowed).toBe(false);
    expect(limiter.consume("client-2").allowed).toBe(true);
  });

  test("loads token bind limits from environment with safe defaults", () => {
    expect(
      tokenBindRateLimitConfigFromEnv({
        MO_DEVFLOW_TOKEN_BIND_RATE_LIMIT_MAX: "3",
        MO_DEVFLOW_TOKEN_BIND_RATE_LIMIT_WINDOW_SECONDS: "120"
      })
    ).toEqual({ maxAttempts: 3, windowMs: 120_000 });

    expect(
      tokenBindRateLimitConfigFromEnv({
        MO_DEVFLOW_TOKEN_BIND_RATE_LIMIT_MAX: "0",
        MO_DEVFLOW_TOKEN_BIND_RATE_LIMIT_WINDOW_SECONDS: "not-a-number"
      })
    ).toEqual({ maxAttempts: 5, windowMs: 300_000 });
  });
});
