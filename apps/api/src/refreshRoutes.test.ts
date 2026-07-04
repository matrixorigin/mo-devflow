import Fastify from "fastify";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { registerRefreshRoutes } from "./refreshRoutes";
import { csrfCookieName, csrfHeaderName } from "./csrf";

const mocks = vi.hoisted(() => ({
  enqueueJobsNow: vi.fn(),
  getRepoId: vi.fn(),
  getSessionRecordFromRequest: vi.fn(),
  loadRepoProfile: vi.fn(),
  recordManualRefreshRequest: vi.fn(),
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
  });

  test("queues only selected manual refresh layers", async () => {
    const app = Fastify();
    await registerRefreshRoutes(app);
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
    } finally {
      await app.close();
    }
  });

  test("rejects an empty manual refresh layer selection", async () => {
    const app = Fastify();
    await registerRefreshRoutes(app);

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
    } finally {
      await app.close();
    }
  });
});
