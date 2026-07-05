import Fastify from "fastify";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { registerRefreshRoutes } from "./refreshRoutes";
import { csrfCookieName, csrfHeaderName } from "./csrf";
import { FixedWindowRateLimiter } from "./rateLimit";

const mocks = vi.hoisted(() => ({
  enqueueJobsNow: vi.fn(),
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
    mocks.retryFailedGitHubWebhookDeliveries.mockResolvedValue({ retriedDeliveries: 0 });
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
