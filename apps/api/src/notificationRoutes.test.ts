import Fastify from "fastify";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { registerNotificationRoutes } from "./notificationRoutes";
import { csrfCookieName, csrfHeaderName } from "./csrf";

const mocks = vi.hoisted(() => ({
  acknowledgeNotificationDelivery: vi.fn(),
  enqueueJobsNow: vi.fn(),
  getRepoId: vi.fn(),
  getSessionRecordFromRequest: vi.fn(),
  loadRepoProfile: vi.fn(),
  recordProductWriteActionExecution: vi.fn(),
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
  requestNotificationDeliveryRetry: mocks.requestNotificationDeliveryRetry,
  upsertRepoProfile: mocks.upsertRepoProfile
}));

const csrfToken = "a".repeat(43);
const csrfHeaders = {
  cookie: `${csrfCookieName}=${csrfToken}`,
  [csrfHeaderName]: csrfToken
};

describe("notification routes", () => {
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
  });

  test("records a retry request and queues the notification worker", async () => {
    const app = Fastify();
    await registerNotificationRoutes(app);
    mocks.requestNotificationDeliveryRetry.mockResolvedValue({
      outcome: "requested",
      deliveryId: 10,
      retryDeliveryId: 11,
      deliveryStatus: "failed_permanent",
      dedupeKey: "notification:attention_item:10"
    });
    mocks.enqueueJobsNow.mockResolvedValue([
      {
        jobKey: "notifications:matrixorigin/matrixone",
        jobType: "notifications",
        status: "pending",
        nextRunAt: "2026-07-04T00:00:00.000Z"
      }
    ]);

    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/notifications/deliveries/10/retry",
        headers: csrfHeaders
      });

      expect(response.statusCode).toBe(200);
      expect(mocks.requestNotificationDeliveryRetry).toHaveBeenCalledWith({
        repoId: 7,
        deliveryId: 10,
        githubLogin: "alice",
        profile: { key: "matrixorigin/matrixone" },
        viewer: { authenticated: true, userId: 1 }
      });
      expect(mocks.enqueueJobsNow).toHaveBeenCalledWith([
        expect.objectContaining({
          jobKey: "notifications:matrixorigin/matrixone",
          jobType: "notifications",
          payload: expect.objectContaining({
            requestedBy: "alice",
            trigger: "notification_retry",
            deliveryId: 10,
            retryDeliveryId: 11,
            dedupeKey: "notification:attention_item:10"
          })
        })
      ]);
      expect(mocks.recordProductWriteActionExecution).toHaveBeenCalledWith({
        repoId: 7,
        userId: 1,
        githubLogin: "alice",
        actionKey: "retry_notification",
        objectType: "notification_delivery",
        objectNumber: 11,
        status: "success"
      });
      expect(response.json()).toMatchObject({
        deliveryId: 10,
        retryDeliveryId: 11,
        deliveryStatus: "failed_permanent"
      });
    } finally {
      await app.close();
    }
  });

  test("rejects retry requests for non-retryable notification states", async () => {
    const app = Fastify();
    await registerNotificationRoutes(app);
    mocks.requestNotificationDeliveryRetry.mockResolvedValue({
      outcome: "not_retryable",
      deliveryId: 10,
      deliveryStatus: "retry_requested"
    });

    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/notifications/deliveries/10/retry",
        headers: csrfHeaders
      });

      expect(response.statusCode).toBe(409);
      expect(response.json()).toEqual({
        error: "notification_delivery_not_retryable",
        message: "Notification delivery status retry_requested cannot be retried.",
        deliveryStatus: "retry_requested"
      });
      expect(mocks.enqueueJobsNow).not.toHaveBeenCalled();
      expect(mocks.recordProductWriteActionExecution).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  test("records notification acknowledgements in the write audit", async () => {
    const app = Fastify();
    await registerNotificationRoutes(app);
    mocks.acknowledgeNotificationDelivery.mockResolvedValue({
      outcome: "acknowledged",
      deliveryId: 10,
      acknowledgedAt: "2026-07-04T02:03:04.000Z",
      acknowledgedBy: "alice"
    });

    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/notifications/deliveries/10/acknowledge",
        headers: csrfHeaders
      });

      expect(response.statusCode).toBe(200);
      expect(mocks.acknowledgeNotificationDelivery).toHaveBeenCalledWith({
        repoId: 7,
        deliveryId: 10,
        userId: 1,
        githubLogin: "alice",
        profile: { key: "matrixorigin/matrixone" },
        viewer: { authenticated: true, userId: 1 }
      });
      expect(mocks.recordProductWriteActionExecution).toHaveBeenCalledWith({
        repoId: 7,
        userId: 1,
        githubLogin: "alice",
        actionKey: "acknowledge_notification",
        objectType: "notification_delivery",
        objectNumber: 10,
        status: "success",
        occurredAt: "2026-07-04T02:03:04.000Z"
      });
      expect(response.json()).toEqual({
        deliveryId: 10,
        acknowledgedAt: "2026-07-04T02:03:04.000Z",
        acknowledgedBy: "alice"
      });
    } finally {
      await app.close();
    }
  });
});
