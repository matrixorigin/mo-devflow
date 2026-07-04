import type { JobQueueHealth, WorkerHealth } from "@mo-devflow/shared";

export type ApiHealthStatus = "healthy" | "degraded";

export function apiHealthStatus(input: { worker: WorkerHealth; jobQueue: JobQueueHealth }): ApiHealthStatus {
  if (input.worker.status !== "active") {
    return "degraded";
  }
  if (input.jobQueue.status !== "healthy") {
    return "degraded";
  }
  return "healthy";
}
