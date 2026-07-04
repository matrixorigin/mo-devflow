import type { JobQueueHealth, OperationalHealthSummary, WorkerHealth } from "@mo-devflow/shared";

export type ApiHealthStatus = "healthy" | "degraded";

export function apiHealthStatus(input: {
  worker: WorkerHealth;
  jobQueue: JobQueueHealth;
  operational?: OperationalHealthSummary | null;
}): ApiHealthStatus {
  if (input.worker.status !== "active") {
    return "degraded";
  }
  if (input.jobQueue.status !== "healthy") {
    return "degraded";
  }
  if (input.operational?.status === "degraded") {
    return "degraded";
  }
  return "healthy";
}
