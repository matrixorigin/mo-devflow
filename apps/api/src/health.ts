import type { JobQueueHealth, OperationalHealthSummary, WorkerHealth } from "@mo-devflow/shared";

export type ApiHealthStatus = "healthy" | "degraded" | "unhealthy";

export function apiHealthStatus(input: {
  worker: WorkerHealth;
  jobQueue: JobQueueHealth;
  operational?: OperationalHealthSummary | null;
  operationalError?: string | null;
}): ApiHealthStatus {
  if (input.worker.status !== "active") {
    return "degraded";
  }
  if (input.jobQueue.status !== "healthy") {
    return "degraded";
  }
  if (input.operationalError) {
    return "degraded";
  }
  if (input.operational?.status === "degraded") {
    return "degraded";
  }
  return "healthy";
}

export function apiHealthHttpStatus(status: ApiHealthStatus): 200 | 503 {
  return status === "unhealthy" ? 503 : 200;
}
