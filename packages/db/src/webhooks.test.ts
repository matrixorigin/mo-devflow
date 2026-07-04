import { describe, expect, test, vi } from "vitest";
import { getWebhookIngestionHealth } from "./webhooks";

const mocks = vi.hoisted(() => ({
  execute: vi.fn()
}));

vi.mock("./client", () => ({
  getPool: () => ({
    execute: mocks.execute
  }),
  nowSql: () => "2026-07-04 12:00:00",
  sqlDate: (value: string) => value,
  fromSqlDate: (value: unknown) => (value ? `${String(value).replace(" ", "T")}.000Z` : null)
}));

describe("webhook ingestion health", () => {
  test("includes recent delivery rows for dashboard diagnosis", async () => {
    mocks.execute.mockImplementation(async (sql: string) => {
      if (sql.includes("SUM(CASE")) {
        return [
          [
            {
              pending_deliveries: 2,
              processed_deliveries: 5,
              failed_deliveries: 1,
              normalization_failed_deliveries: 1,
              ignored_deliveries: 3,
              duplicate_deliveries: 2,
              last_received_at: "2026-07-04 12:00:00"
            }
          ]
        ];
      }
      if (sql.includes("SELECT delivery_id, error_message")) {
        return [[{ delivery_id: "delivery-bad", error_message: "bad payload" }]];
      }
      if (sql.includes("SELECT delivery_id, event_name")) {
        return [
          [
            {
              delivery_id: "delivery-bad",
              event_name: "issues",
              action: "opened",
              status: "failed_normalization",
              attempts: 1,
              duplicate_count: 2,
              received_at: "2026-07-04 12:00:00",
              processed_at: null,
              error_message: "bad payload"
            }
          ]
        ];
      }
      throw new Error(`Unexpected query: ${sql}`);
    });

    await expect(getWebhookIngestionHealth(10)).resolves.toEqual({
      pendingDeliveries: 2,
      processedDeliveries: 5,
      failedDeliveries: 1,
      normalizationFailedDeliveries: 1,
      ignoredDeliveries: 3,
      duplicateDeliveries: 2,
      lastReceivedAt: "2026-07-04T12:00:00.000Z",
      latestFailure: "delivery-bad: bad payload",
      recentDeliveries: [
        {
          deliveryId: "delivery-bad",
          eventName: "issues",
          action: "opened",
          status: "failed_normalization",
          attempts: 1,
          duplicateCount: 2,
          receivedAt: "2026-07-04T12:00:00.000Z",
          processedAt: null,
          errorMessage: "bad payload"
        }
      ]
    });
  });
});
