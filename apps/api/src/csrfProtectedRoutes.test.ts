import Fastify from "fastify";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { registerNotificationRoutes } from "./notificationRoutes";
import { registerRefreshRoutes } from "./refreshRoutes";

const mocks = vi.hoisted(() => ({
  getSessionRecordFromRequest: vi.fn(),
  loadRepoProfile: vi.fn(),
  acknowledgeNotificationDelivery: vi.fn(),
  enqueueJobsNow: vi.fn(),
  getRepoId: vi.fn(),
  recordProductWriteActionExecution: vi.fn(),
  recordManualRefreshRequest: vi.fn(),
  requestNotificationDeliveryRetry: vi.fn(),
  upsertRepoProfile: vi.fn()
}));

vi.mock("./authRoutes", () => ({
  getSessionRecordFromRequest: mocks.getSessionRecordFromRequest
}));

vi.mock("@mo-devflow/config", () => ({
  loadRepoProfile: mocks.loadRepoProfile
}));

vi.mock("@mo-devflow/db", () => ({
  acknowledgeNotificationDelivery: mocks.acknowledgeNotificationDelivery,
  enqueueJobsNow: mocks.enqueueJobsNow,
  getRepoId: mocks.getRepoId,
  recordProductWriteActionExecution: mocks.recordProductWriteActionExecution,
  recordManualRefreshRequest: mocks.recordManualRefreshRequest,
  requestNotificationDeliveryRetry: mocks.requestNotificationDeliveryRetry,
  upsertRepoProfile: mocks.upsertRepoProfile
}));

describe("CSRF protected routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionRecordFromRequest.mockResolvedValue({
      userId: 1,
      githubLogin: "alice",
      tokenScopes: ["repo"],
      tokenLastValidatedAt: "2026-07-04T00:00:00.000Z"
    });
    mocks.loadRepoProfile.mockReturnValue({ key: "matrixorigin/matrixone" });
  });

  test("rejects manual refresh before queueing jobs when CSRF is missing", async () => {
    const app = Fastify();
    await registerRefreshRoutes(app);

    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/refresh",
        payload: {}
      });

      expect(response.statusCode).toBe(403);
      expect(response.json()).toEqual({
        error: "csrf_required",
        message: "Refresh the session and retry the request."
      });
      expect(mocks.enqueueJobsNow).not.toHaveBeenCalled();
      expect(mocks.recordManualRefreshRequest).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  test("rejects notification acknowledgement before updating state when CSRF is missing", async () => {
    const app = Fastify();
    await registerNotificationRoutes(app);

    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/notifications/deliveries/10/acknowledge"
      });

      expect(response.statusCode).toBe(403);
      expect(response.json()).toEqual({
        error: "csrf_required",
        message: "Refresh the session and retry the request."
      });
      expect(mocks.acknowledgeNotificationDelivery).not.toHaveBeenCalled();
      expect(mocks.recordProductWriteActionExecution).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  test("rejects notification retry before updating state when CSRF is missing", async () => {
    const app = Fastify();
    await registerNotificationRoutes(app);

    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/notifications/deliveries/10/retry"
      });

      expect(response.statusCode).toBe(403);
      expect(response.json()).toEqual({
        error: "csrf_required",
        message: "Refresh the session and retry the request."
      });
      expect(mocks.requestNotificationDeliveryRetry).not.toHaveBeenCalled();
      expect(mocks.enqueueJobsNow).not.toHaveBeenCalled();
      expect(mocks.recordProductWriteActionExecution).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
});
