import { describe, expect, test } from "vitest";
import { workerHealthRecommendedAction } from "./workerHealth";

describe("worker health recommended action", () => {
  test("keeps healthy workers quiet", () => {
    expect(workerHealthRecommendedAction("active")).toBeNull();
  });

  test("gives recovery steps for offline, stale, and failed workers", () => {
    expect(workerHealthRecommendedAction("offline")).toContain("make dev-worker-start");
    expect(workerHealthRecommendedAction("stale")).toContain("worker.log");
    expect(workerHealthRecommendedAction("failed")).toContain("worker.log");
  });
});
