import { describe, expect, test } from "vitest";
import {
  jobQueueHealthStatus,
  jobQueueOldestPendingWarnHoursFromEnv,
  jobQueueRecommendedAction
} from "./jobs";

const healthyQueue = {
  blockedJobs: 0,
  failedJobs: 0,
  staleLeases: 0,
  oldestPendingAgeHours: null,
  latestFailure: null
};

describe("job queue health", () => {
  test("keeps an empty or fresh queue healthy", () => {
    expect(jobQueueHealthStatus(healthyQueue)).toBe("healthy");
    expect(jobQueueRecommendedAction(healthyQueue)).toBeNull();
  });

  test("marks blocked jobs as requiring operator attention", () => {
    const health = {
      ...healthyQueue,
      blockedJobs: 2,
      latestFailure: "github_sync: Resource not accessible by integration"
    };

    expect(jobQueueHealthStatus(health)).toBe("attention");
    expect(jobQueueRecommendedAction(health)).toContain("blocked jobs need credentials");
    expect(jobQueueRecommendedAction(health)).toContain("github_sync");
  });

  test("marks stale leases and old due jobs as requiring attention", () => {
    expect(jobQueueHealthStatus({ ...healthyQueue, staleLeases: 1 })).toBe("attention");
    expect(jobQueueHealthStatus({ ...healthyQueue, oldestPendingAgeHours: 0.3 }, 0.25)).toBe("attention");
    expect(jobQueueHealthStatus({ ...healthyQueue, oldestPendingAgeHours: 0.2 }, 0.25)).toBe("healthy");
  });

  test("uses a conservative oldest-pending threshold from environment", () => {
    expect(jobQueueOldestPendingWarnHoursFromEnv({})).toBe(0.25);
    expect(jobQueueOldestPendingWarnHoursFromEnv({ MO_DEVFLOW_JOB_QUEUE_PENDING_WARN_HOURS: "0.01" })).toBe(0.05);
    expect(jobQueueOldestPendingWarnHoursFromEnv({ MO_DEVFLOW_JOB_QUEUE_PENDING_WARN_HOURS: "1.5" })).toBe(1.5);
  });
});
