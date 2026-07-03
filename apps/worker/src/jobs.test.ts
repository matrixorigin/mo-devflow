import { afterEach, describe, expect, test } from "vitest";
import { intervalSecondsFromEnv, retryDelaySeconds, workerIdFromEnv } from "./jobs";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("worker job scheduling config", () => {
  test("uses fallback when an interval environment variable is missing or invalid", () => {
    delete process.env.MO_DEVFLOW_TEST_INTERVAL_SECONDS;
    expect(intervalSecondsFromEnv("MO_DEVFLOW_TEST_INTERVAL_SECONDS", 300)).toBe(300);

    process.env.MO_DEVFLOW_TEST_INTERVAL_SECONDS = "not-a-number";
    expect(intervalSecondsFromEnv("MO_DEVFLOW_TEST_INTERVAL_SECONDS", 300)).toBe(300);
  });

  test("enforces minimum interval seconds", () => {
    process.env.MO_DEVFLOW_TEST_INTERVAL_SECONDS = "5";
    expect(intervalSecondsFromEnv("MO_DEVFLOW_TEST_INTERVAL_SECONDS", 300, 60)).toBe(60);
  });

  test("backs off retries exponentially and caps at the configured maximum", () => {
    process.env.MO_DEVFLOW_JOB_RETRY_BASE_SECONDS = "10";
    process.env.MO_DEVFLOW_JOB_RETRY_MAX_SECONDS = "90";

    expect(retryDelaySeconds(1)).toBe(10);
    expect(retryDelaySeconds(2)).toBe(20);
    expect(retryDelaySeconds(5)).toBe(90);
    expect(retryDelaySeconds(99)).toBe(90);
  });

  test("supports a stable configured worker id for heartbeat correlation", () => {
    process.env.MO_DEVFLOW_WORKER_ID = "local-worker";

    expect(workerIdFromEnv()).toBe("local-worker");
  });
});
