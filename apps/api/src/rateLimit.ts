import type { FastifyRequest } from "fastify";

export interface RateLimitConfig {
  maxAttempts: number;
  windowMs: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
  retryAfterSeconds: number;
}

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

export class FixedWindowRateLimiter {
  private readonly entries = new Map<string, RateLimitEntry>();
  private readonly maxAttempts: number;
  private readonly windowMs: number;
  private readonly now: () => number;

  constructor(config: RateLimitConfig & { now?: () => number }) {
    this.maxAttempts = Math.max(1, Math.floor(config.maxAttempts));
    this.windowMs = Math.max(1, Math.floor(config.windowMs));
    this.now = config.now ?? Date.now;
  }

  consume(key: string): RateLimitDecision {
    const now = this.now();
    const existing = this.entries.get(key);
    if (!existing || existing.resetAt <= now) {
      const resetAt = now + this.windowMs;
      this.entries.set(key, { count: 1, resetAt });
      return this.decision(true, 1, resetAt, now);
    }

    if (existing.count >= this.maxAttempts) {
      return this.decision(false, existing.count, existing.resetAt, now);
    }

    existing.count += 1;
    return this.decision(true, existing.count, existing.resetAt, now);
  }

  private decision(allowed: boolean, count: number, resetAt: number, now: number): RateLimitDecision {
    return {
      allowed,
      limit: this.maxAttempts,
      remaining: Math.max(0, this.maxAttempts - count),
      resetAt,
      retryAfterSeconds: Math.max(1, Math.ceil((resetAt - now) / 1000))
    };
  }
}

function positiveIntFromEnv(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

export function tokenBindRateLimitConfigFromEnv(
  env: Record<string, string | undefined> = process.env
): RateLimitConfig {
  return {
    maxAttempts: positiveIntFromEnv(env.MO_DEVFLOW_TOKEN_BIND_RATE_LIMIT_MAX, 5),
    windowMs: positiveIntFromEnv(env.MO_DEVFLOW_TOKEN_BIND_RATE_LIMIT_WINDOW_SECONDS, 300) * 1000
  };
}

export function clientRateLimitKey(request: FastifyRequest, scope: string): string {
  return `${scope}:${request.ip || "unknown"}`;
}
