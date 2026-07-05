import { beforeEach, describe, expect, test, vi } from "vitest";
import { claimNextGitHubWebhookDelivery, completeGitHubWebhookDelivery, failGitHubWebhookDelivery } from "./webhooks";

const mocks = vi.hoisted(() => ({
  execute: vi.fn()
}));

vi.mock("./client", () => ({
  getPool: () => ({
    execute: mocks.execute
  }),
  nowSql: () => "2026-07-06 04:00:00",
  sqlDate: (value: string | Date | null | undefined) => {
    if (!value) {
      return null;
    }
    if (value instanceof Date) {
      return "2026-07-06 04:01:00";
    }
    return value.replace("T", " ").replace(".000Z", "");
  },
  fromSqlDate: (value: unknown) => (value ? `${String(value).replace(" ", "T")}Z` : null)
}));

describe("webhook delivery leases", () => {
  beforeEach(() => {
    mocks.execute.mockReset();
  });

  test("continues through claim candidates when another worker wins the first race", async () => {
    mocks.execute
      .mockResolvedValueOnce([[{ id: 10 }, { id: 11 }]])
      .mockResolvedValueOnce([{ affectedRows: 0 }])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([
        [
          {
            id: 11,
            repo_id: 3,
            delivery_id: "delivery-11",
            event_name: "pull_request",
            action: "opened",
            attempts: 2,
            payload_json: "{}",
            processing_owner: "webhook-worker-a"
          }
        ]
      ]);

    const delivery = await claimNextGitHubWebhookDelivery({
      repoId: 3,
      processingOwner: "webhook-worker-a",
      leaseSeconds: 60
    });

    expect(delivery?.id).toBe(11);
    expect(mocks.execute).toHaveBeenCalledTimes(4);
    expect(String(mocks.execute.mock.calls[0]?.[0])).toContain("LIMIT 8");
    expect(String(mocks.execute.mock.calls[3]?.[0])).toContain("AND status = 'processing'");
    expect(String(mocks.execute.mock.calls[3]?.[0])).toContain("AND processing_expires_at >= ?");
  });

  test("requires a still-processing unexpired lease before completing a delivery", async () => {
    mocks.execute.mockResolvedValueOnce([{ affectedRows: 1 }]);

    await completeGitHubWebhookDelivery({
      deliveryId: 12,
      processingOwner: "webhook-worker-a",
      result: { processed: true }
    });

    const [sql, params] = mocks.execute.mock.calls[0] ?? [];
    expect(String(sql)).toContain("AND status = 'processing'");
    expect(String(sql)).toContain("AND processing_owner = ?");
    expect(String(sql)).toContain("AND processing_expires_at >= ?");
    expect(params).toEqual([
      "2026-07-06 04:00:00",
      JSON.stringify({ processed: true }),
      12,
      "webhook-worker-a",
      "2026-07-06 04:00:00"
    ]);
  });

  test("requires a still-processing unexpired lease before failing a delivery", async () => {
    mocks.execute.mockResolvedValueOnce([{ affectedRows: 1 }]);

    await failGitHubWebhookDelivery({
      deliveryId: 13,
      processingOwner: "webhook-worker-a",
      errorMessage: "bad payload",
      status: "failed_normalization"
    });

    const [sql, params] = mocks.execute.mock.calls[0] ?? [];
    expect(String(sql)).toContain("AND status = 'processing'");
    expect(String(sql)).toContain("AND processing_owner = ?");
    expect(String(sql)).toContain("AND processing_expires_at >= ?");
    expect(params).toEqual([
      "failed_normalization",
      "2026-07-06 04:00:00",
      "bad payload",
      13,
      "webhook-worker-a",
      "2026-07-06 04:00:00"
    ]);
  });
});
