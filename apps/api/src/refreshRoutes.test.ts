import Fastify from "fastify";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { OperationalHealthSummary } from "@mo-devflow/shared";
import { manualRefreshGithubRateLimitBlock, registerRefreshRoutes } from "./refreshRoutes";
import { csrfCookieName, csrfHeaderName } from "./csrf";
import { FixedWindowRateLimiter } from "./rateLimit";

const mocks = vi.hoisted(() => ({
  enqueueJobsNow: vi.fn(),
  getOperationalHealth: vi.fn(),
  getRepoId: vi.fn(),
  getSessionRecordFromRequest: vi.fn(),
  loadRepoProfile: vi.fn(),
  recordManualRefreshRequest: vi.fn(),
  retryFailedGitHubWebhookDeliveries: vi.fn(),
  upsertRepoProfile: vi.fn()
}));

vi.mock("./authRoutes", () => ({
  getSessionRecordFromRequest: mocks.getSessionRecordFromRequest
}));

vi.mock("@mo-devflow/config", () => ({
  loadRepoProfile: mocks.loadRepoProfile
}));

vi.mock("@mo-devflow/db", () => ({
  enqueueJobsNow: mocks.enqueueJobsNow,
  getOperationalHealth: mocks.getOperationalHealth,
  getRepoId: mocks.getRepoId,
  recordManualRefreshRequest: mocks.recordManualRefreshRequest,
  retryFailedGitHubWebhookDeliveries: mocks.retryFailedGitHubWebhookDeliveries,
  upsertRepoProfile: mocks.upsertRepoProfile
}));

const csrfToken = "a".repeat(43);
const csrfHeaders = {
  cookie: `${csrfCookieName}=${csrfToken}`,
  [csrfHeaderName]: csrfToken
};

describe("refresh routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionRecordFromRequest.mockResolvedValue({
      userId: 1,
      githubLogin: "alice",
      tokenScopes: ["repo"],
      tokenRepoPermission: "write",
      tokenLastValidatedAt: "2026-07-04T00:00:00.000Z"
    });
    mocks.loadRepoProfile.mockReturnValue({ key: "matrixorigin/matrixone" });
    mocks.getRepoId.mockResolvedValue(7);
    mocks.getOperationalHealth.mockResolvedValue(healthyOperationalHealth());
    mocks.retryFailedGitHubWebhookDeliveries.mockResolvedValue({ retriedDeliveries: 0 });
  });

  test("derives a manual refresh quota block only for GitHub API layers", () => {
    const operational = rateLimitedOperationalHealth();

    expect(
      manualRefreshGithubRateLimitBlock({
        requestedLayers: ["rules", "metrics"],
        operational,
        nowMs: Date.parse("2026-07-05T09:59:00.000Z")
      })
    ).toBeNull();

    expect(
      manualRefreshGithubRateLimitBlock({
        requestedLayers: ["github_sync", "rules"],
        operational,
        nowMs: Date.parse("2026-07-05T09:59:00.000Z")
      })
    ).toEqual({
      blockedLayers: ["github_sync"],
      rateLimitedLayers: ["pr_backfill"],
      resetAt: "2026-07-05T10:00:00.000Z",
      retryAfterSeconds: 60
    });
  });

  test("queues only selected manual refresh layers", async () => {
    const app = Fastify();
    const onDashboardMutated = vi.fn();
    await registerRefreshRoutes(app, { onDashboardMutated });
    mocks.enqueueJobsNow.mockResolvedValue([
      { jobKey: "rules:matrixorigin/matrixone", jobType: "rules", status: "pending", nextRunAt: null },
      {
        jobKey: "notifications:matrixorigin/matrixone",
        jobType: "notifications",
        status: "pending",
        nextRunAt: null
      }
    ]);
    mocks.recordManualRefreshRequest.mockResolvedValue({
      requestId: 3,
      requestedLayers: ["rules", "notifications"],
      queuedJobs: [],
      requestedAt: "2026-07-04T00:00:00.000Z"
    });

    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/refresh",
        headers: csrfHeaders,
        payload: { layers: ["rules", "notifications", "rules"] }
      });

      expect(response.statusCode).toBe(200);
      expect(mocks.enqueueJobsNow).toHaveBeenCalledWith([
        expect.objectContaining({
          jobKey: "rules:matrixorigin/matrixone",
          jobType: "rules",
          payload: expect.objectContaining({ requestedBy: "alice", trigger: "manual_refresh" })
        }),
        expect.objectContaining({
          jobKey: "notifications:matrixorigin/matrixone",
          jobType: "notifications",
          payload: expect.objectContaining({ requestedBy: "alice", trigger: "manual_refresh" })
        })
      ]);
      expect(mocks.recordManualRefreshRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          repoId: 7,
          userId: 1,
          githubLogin: "alice",
          requestedLayers: ["rules", "notifications"]
        })
      );
      expect(onDashboardMutated).toHaveBeenCalledTimes(1);
    } finally {
      await app.close();
    }
  });

  test("blocks GitHub manual refresh layers while GitHub quota is exhausted", async () => {
    const app = Fastify();
    const onDashboardMutated = vi.fn();
    await registerRefreshRoutes(app, { onDashboardMutated });
    mocks.getOperationalHealth.mockResolvedValue(rateLimitedOperationalHealth());

    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/refresh",
        headers: csrfHeaders,
        payload: { layers: ["github_sync", "rules"] }
      });

      expect(response.statusCode).toBe(429);
      expect(response.json()).toMatchObject({
        error: "manual_refresh_github_rate_limited",
        blockedLayers: ["github_sync"],
        rateLimitedLayers: ["pr_backfill"],
        resetAt: "2026-07-05T10:00:00.000Z"
      });
      expect(mocks.enqueueJobsNow).not.toHaveBeenCalled();
      expect(mocks.recordManualRefreshRequest).not.toHaveBeenCalled();
      expect(onDashboardMutated).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  test("allows cache-only manual refresh layers while GitHub quota is exhausted", async () => {
    const app = Fastify();
    await registerRefreshRoutes(app);
    mocks.getOperationalHealth.mockResolvedValue(rateLimitedOperationalHealth());
    mocks.enqueueJobsNow.mockResolvedValue([
      { jobKey: "rules:matrixorigin/matrixone", jobType: "rules", status: "pending", nextRunAt: null },
      { jobKey: "metrics:matrixorigin/matrixone", jobType: "metrics", status: "pending", nextRunAt: null }
    ]);
    mocks.recordManualRefreshRequest.mockResolvedValue({
      requestId: 4,
      requestedLayers: ["rules", "metrics"],
      queuedJobs: [],
      requestedAt: "2026-07-04T00:00:00.000Z"
    });

    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/refresh",
        headers: csrfHeaders,
        payload: { layers: ["rules", "metrics"] }
      });

      expect(response.statusCode).toBe(200);
      expect(mocks.enqueueJobsNow).toHaveBeenCalledWith([
        expect.objectContaining({ jobType: "rules" }),
        expect.objectContaining({ jobType: "metrics" })
      ]);
    } finally {
      await app.close();
    }
  });

  test("rejects an empty manual refresh layer selection", async () => {
    const app = Fastify();
    const onDashboardMutated = vi.fn();
    await registerRefreshRoutes(app, { onDashboardMutated });

    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/refresh",
        headers: csrfHeaders,
        payload: { layers: [] }
      });

      expect(response.statusCode).toBe(422);
      expect(response.json()).toEqual({
        error: "invalid_manual_refresh_input",
        message: "Manual refresh input is invalid."
      });
      expect(mocks.enqueueJobsNow).not.toHaveBeenCalled();
      expect(mocks.recordManualRefreshRequest).not.toHaveBeenCalled();
      expect(onDashboardMutated).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  test("rate limits repeated manual refresh requests before queueing jobs", async () => {
    const app = Fastify();
    const limiter = new FixedWindowRateLimiter({ maxAttempts: 1, windowMs: 60_000, now: () => 1_000 });
    await registerRefreshRoutes(app, { manualRefreshRateLimiter: limiter });
    mocks.enqueueJobsNow.mockResolvedValue([
      { jobKey: "rules:matrixorigin/matrixone", jobType: "rules", status: "pending", nextRunAt: null }
    ]);
    mocks.recordManualRefreshRequest.mockResolvedValue({
      requestId: 3,
      requestedLayers: ["rules"],
      queuedJobs: [],
      requestedAt: "2026-07-04T00:00:00.000Z"
    });

    try {
      const first = await app.inject({
        method: "POST",
        url: "/api/refresh",
        headers: csrfHeaders,
        payload: { layers: ["rules"] }
      });
      const second = await app.inject({
        method: "POST",
        url: "/api/refresh",
        headers: csrfHeaders,
        payload: { layers: ["rules"] }
      });

      expect(first.statusCode).toBe(200);
      expect(second.statusCode).toBe(429);
      expect(second.headers["retry-after"]).toBe("60");
      expect(second.json()).toEqual({
        error: "manual_refresh_rate_limited",
        message: "Too many manual refresh requests. Retry later.",
        retryAfterSeconds: 60
      });
      expect(mocks.enqueueJobsNow).toHaveBeenCalledTimes(1);
      expect(mocks.recordManualRefreshRequest).toHaveBeenCalledTimes(1);
    } finally {
      await app.close();
    }
  });

  test("resets failed webhook deliveries and queues webhook repair jobs", async () => {
    const app = Fastify();
    const onDashboardMutated = vi.fn();
    await registerRefreshRoutes(app, { onDashboardMutated });
    mocks.retryFailedGitHubWebhookDeliveries.mockResolvedValue({ retriedDeliveries: 3 });
    mocks.enqueueJobsNow.mockResolvedValue([
      { jobKey: "webhooks:matrixorigin/matrixone", jobType: "webhooks", status: "pending", nextRunAt: null },
      { jobKey: "rules:matrixorigin/matrixone", jobType: "rules", status: "pending", nextRunAt: null }
    ]);
    mocks.recordManualRefreshRequest.mockResolvedValue({
      requestId: 9,
      requestedLayers: ["webhooks", "rules", "metrics", "ai_drift", "notifications"],
      queuedJobs: [],
      requestedAt: "2026-07-04T00:00:00.000Z"
    });

    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/refresh/webhooks/retry-failed",
        headers: csrfHeaders
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        retriedDeliveries: 3,
        requestId: 9,
        requestedLayers: ["webhooks", "rules", "metrics", "ai_drift", "notifications"]
      });
      expect(mocks.retryFailedGitHubWebhookDeliveries).toHaveBeenCalledWith({ repoId: 7 });
      expect(mocks.enqueueJobsNow).toHaveBeenCalledWith([
        expect.objectContaining({
          jobKey: "webhooks:matrixorigin/matrixone",
          jobType: "webhooks",
          payload: expect.objectContaining({ trigger: "webhook_retry", requestedBy: "alice", retriedDeliveries: 3 })
        }),
        expect.objectContaining({ jobKey: "rules:matrixorigin/matrixone", jobType: "rules" }),
        expect.objectContaining({ jobKey: "metrics:matrixorigin/matrixone", jobType: "metrics" }),
        expect.objectContaining({ jobKey: "ai-drift:matrixorigin/matrixone", jobType: "ai_drift" }),
        expect.objectContaining({ jobKey: "notifications:matrixorigin/matrixone", jobType: "notifications" })
      ]);
      expect(mocks.recordManualRefreshRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          repoId: 7,
          userId: 1,
          githubLogin: "alice",
          requestedLayers: ["webhooks", "rules", "metrics", "ai_drift", "notifications"]
        })
      );
      expect(onDashboardMutated).toHaveBeenCalledTimes(1);
    } finally {
      await app.close();
    }
  });

  test("does not queue webhook repair jobs when there are no failed deliveries", async () => {
    const app = Fastify();
    const onDashboardMutated = vi.fn();
    await registerRefreshRoutes(app, { onDashboardMutated });
    mocks.retryFailedGitHubWebhookDeliveries.mockResolvedValue({ retriedDeliveries: 0 });

    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/refresh/webhooks/retry-failed",
        headers: csrfHeaders
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        retriedDeliveries: 0,
        requestId: null,
        requestedLayers: [],
        queuedJobs: []
      });
      expect(mocks.enqueueJobsNow).not.toHaveBeenCalled();
      expect(mocks.recordManualRefreshRequest).not.toHaveBeenCalled();
      expect(onDashboardMutated).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  test("blocks webhook retry while GitHub quota is exhausted", async () => {
    const app = Fastify();
    const onDashboardMutated = vi.fn();
    await registerRefreshRoutes(app, { onDashboardMutated });
    mocks.getOperationalHealth.mockResolvedValue(rateLimitedOperationalHealth());

    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/refresh/webhooks/retry-failed",
        headers: csrfHeaders
      });

      expect(response.statusCode).toBe(429);
      expect(response.json()).toMatchObject({
        error: "manual_refresh_github_rate_limited",
        blockedLayers: ["webhooks"],
        rateLimitedLayers: ["pr_backfill"]
      });
      expect(mocks.retryFailedGitHubWebhookDeliveries).not.toHaveBeenCalled();
      expect(mocks.enqueueJobsNow).not.toHaveBeenCalled();
      expect(onDashboardMutated).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  test("rejects webhook retry before resetting deliveries when CSRF is missing", async () => {
    const app = Fastify();
    await registerRefreshRoutes(app);

    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/refresh/webhooks/retry-failed"
      });

      expect(response.statusCode).toBe(403);
      expect(response.json()).toEqual({
        error: "csrf_required",
        message: "Refresh the session and retry the request."
      });
      expect(mocks.retryFailedGitHubWebhookDeliveries).not.toHaveBeenCalled();
      expect(mocks.enqueueJobsNow).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  test("rate limits webhook retry before resetting deliveries", async () => {
    const app = Fastify();
    const limiter = new FixedWindowRateLimiter({ maxAttempts: 1, windowMs: 60_000, now: () => 1_000 });
    await registerRefreshRoutes(app, { manualRefreshRateLimiter: limiter });
    mocks.retryFailedGitHubWebhookDeliveries.mockResolvedValue({ retriedDeliveries: 0 });

    try {
      const first = await app.inject({
        method: "POST",
        url: "/api/refresh/webhooks/retry-failed",
        headers: csrfHeaders
      });
      const second = await app.inject({
        method: "POST",
        url: "/api/refresh/webhooks/retry-failed",
        headers: csrfHeaders
      });

      expect(first.statusCode).toBe(200);
      expect(second.statusCode).toBe(429);
      expect(second.headers["retry-after"]).toBe("60");
      expect(second.json()).toEqual({
        error: "manual_refresh_rate_limited",
        message: "Too many manual refresh requests. Retry later.",
        retryAfterSeconds: 60
      });
      expect(mocks.retryFailedGitHubWebhookDeliveries).toHaveBeenCalledTimes(1);
      expect(mocks.enqueueJobsNow).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
});

function healthyOperationalHealth(): OperationalHealthSummary {
  return {
    status: "healthy",
    recommendedAction: null,
    sync: {
      health: [],
      unhealthyLayers: [],
      rateLimitedLayers: []
    },
    cache: {
      status: "healthy",
      staleObjects: 0,
      staleThresholdHours: 6,
      oldestCacheAgeHours: null,
      partialObjects: 0
    },
    notifications: {
      failedDeliveries: 0
    },
    webhooks: {
      pendingDeliveries: 0,
      staleProcessingDeliveries: 0,
      processedDeliveries: 0,
      failedDeliveries: 0,
      normalizationFailedDeliveries: 0,
      ignoredDeliveries: 0,
      duplicateDeliveries: 0,
      connectivityProbeDeliveries: 0,
      lastReceivedAt: null,
      oldestPendingReceivedAt: null,
      lastConnectivityProbeAt: null,
      latestFailure: null,
      eventSummaries: [],
      recentDeliveries: []
    }
  };
}

function rateLimitedOperationalHealth(): OperationalHealthSummary {
  return {
    ...healthyOperationalHealth(),
    status: "degraded",
    recommendedAction:
      "GitHub API rate limit is exhausted for pr_backfill; wait until 2026-07-05T10:00:00.000Z before queueing more GitHub sync or backfill work.",
    sync: {
      health: [
        {
          layer: "pr_backfill",
          status: "success",
          lastSuccessfulAt: "2026-07-05T09:55:00.000Z",
          lastAttemptedAt: "2026-07-05T09:55:00.000Z",
          lastFailedAt: null,
          lastFailureMessage: null,
          cursorValue: null,
          errorMessage: null,
          rateLimitRemaining: 0,
          rateLimitResetAt: "2026-07-05T10:00:00.000Z",
          skipped: false,
          skipReason: null
        }
      ],
      unhealthyLayers: [],
      rateLimitedLayers: ["pr_backfill"]
    }
  };
}
