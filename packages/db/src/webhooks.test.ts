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
      if (sql.includes("GROUP BY event_name")) {
        return [
          [
            {
              event_name: "issues",
              pending_deliveries: 1,
              processed_deliveries: 4,
              failed_deliveries: 1,
              ignored_deliveries: 0,
              duplicate_deliveries: 2,
              last_received_at: "2026-07-04 12:00:00",
              last_processed_at: "2026-07-04 12:01:00"
            },
            {
              event_name: "pull_request",
              pending_deliveries: 1,
              processed_deliveries: 1,
              failed_deliveries: 0,
              ignored_deliveries: 1,
              duplicate_deliveries: 0,
              last_received_at: "2026-07-04 11:00:00",
              last_processed_at: "2026-07-04 11:02:00"
            }
          ]
        ];
      }
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
              connectivity_probe_deliveries: 1,
              last_received_at: "2026-07-04 12:00:00",
              oldest_pending_received_at: "2026-07-04 11:30:00",
              last_connectivity_probe_at: "2026-07-04 10:00:00"
            }
          ]
        ];
      }
      if (sql.includes("SELECT delivery_id, error_message")) {
        return [[{ delivery_id: "delivery-bad", error_message: "bad payload" }]];
      }
      if (sql.includes("SELECT event_name, error_message")) {
        return [[{ event_name: "issues", error_message: "bad payload" }]];
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
      connectivityProbeDeliveries: 1,
      lastReceivedAt: "2026-07-04T12:00:00.000Z",
      oldestPendingReceivedAt: "2026-07-04T11:30:00.000Z",
      lastConnectivityProbeAt: "2026-07-04T10:00:00.000Z",
      latestFailure: "delivery-bad: bad payload",
      eventSummaries: [
        {
          eventName: "issues",
          pendingDeliveries: 1,
          processedDeliveries: 4,
          failedDeliveries: 1,
          ignoredDeliveries: 0,
          duplicateDeliveries: 2,
          lastReceivedAt: "2026-07-04T12:00:00.000Z",
          lastProcessedAt: "2026-07-04T12:01:00.000Z",
          latestFailure: "bad payload"
        },
        {
          eventName: "pull_request",
          pendingDeliveries: 1,
          processedDeliveries: 1,
          failedDeliveries: 0,
          ignoredDeliveries: 1,
          duplicateDeliveries: 0,
          lastReceivedAt: "2026-07-04T11:00:00.000Z",
          lastProcessedAt: "2026-07-04T11:02:00.000Z",
          latestFailure: null
        }
      ],
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
