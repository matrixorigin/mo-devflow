import type { JobQueueHealth, OperationalHealthSummary, WorkerHealth } from "@mo-devflow/shared";

export type ApiHealthStatus = "healthy" | "degraded" | "unhealthy";
export type ApiHealthFindingSeverity = "warning" | "critical";

export interface ApiHealthFinding {
  key: string;
  severity: ApiHealthFindingSeverity;
  message: string;
}

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

export function apiHealthFindings(input: {
  worker: WorkerHealth;
  jobQueue: JobQueueHealth;
  operational?: OperationalHealthSummary | null;
  operationalError?: string | null;
}): ApiHealthFinding[] {
  const findings: ApiHealthFinding[] = [];

  if (input.worker.status !== "active") {
    findings.push({
      key: "worker",
      severity: input.worker.status === "failed" || input.worker.status === "offline" ? "critical" : "warning",
      message: input.worker.recommendedAction ?? `Worker is ${input.worker.status}.`
    });
  }

  if (input.jobQueue.status !== "healthy") {
    findings.push({
      key: "job_queue",
      severity: input.jobQueue.blockedJobs > 0 || input.jobQueue.staleLeases > 0 ? "critical" : "warning",
      message: input.jobQueue.recommendedAction ?? "Job queue needs attention."
    });
  }

  if (input.operationalError) {
    findings.push({
      key: "operational_summary",
      severity: "warning",
      message: input.operationalError
    });
  }

  if (input.operational?.status === "degraded") {
    findings.push({
      key: "operational",
      severity: "warning",
      message: input.operational.recommendedAction ?? "Operational health is degraded."
    });
  }

  if (input.operational && input.operational.cache.partialObjects > 0) {
    findings.push({
      key: "partial_cache",
      severity: "warning",
      message: `${input.operational.cache.partialObjects} cached GitHub objects have incomplete workflow evidence; backfill PR detail, issue timeline, or comments before treating related conclusions as final.`
    });
  }

  return findings;
}
