import {
  syncHealthLayers,
  type JobQueueHealth,
  type ManualRefreshLayer,
  type OperationalHealthSummary,
  type WorkerHealth
} from "@mo-devflow/shared";

export type ApiHealthStatus = "healthy" | "degraded" | "unhealthy";
export type ApiHealthFindingSeverity = "warning" | "critical";

export interface ApiHealthFinding {
  key: string;
  severity: ApiHealthFindingSeverity;
  message: string;
  recommendedLayers?: ManualRefreshLayer[];
}

const staleCacheRepairLayers: ManualRefreshLayer[] = ["github_sync", "rules", "metrics", "ai_drift"];
const partialCacheRepairLayers: ManualRefreshLayer[] = [
  "pr_backfill",
  "issue_timeline_backfill",
  "comment_backfill",
  "rules",
  "metrics",
  "ai_drift"
];

function orderedLayers(layers: Iterable<ManualRefreshLayer>): ManualRefreshLayer[] {
  const selected = new Set(layers);
  return syncHealthLayers.filter((layer) => selected.has(layer));
}

function isManualRefreshLayer(value: string): value is ManualRefreshLayer {
  return (syncHealthLayers as readonly string[]).includes(value);
}

function jobQueueRepairLayers(jobQueue: JobQueueHealth): ManualRefreshLayer[] {
  const layers: ManualRefreshLayer[] = [];
  for (const item of jobQueue.byType) {
    if (item.status !== "healthy" && isManualRefreshLayer(item.jobType)) {
      layers.push(item.jobType);
    }
  }
  return orderedLayers(layers);
}

function operationalRepairLayers(operational: OperationalHealthSummary): ManualRefreshLayer[] {
  const layers: ManualRefreshLayer[] = [...operational.sync.unhealthyLayers];
  if (operational.cache.staleObjects > 0) {
    layers.push(...staleCacheRepairLayers);
  }
  if (operational.cache.partialObjects > 0) {
    layers.push(...partialCacheRepairLayers);
  }
  return orderedLayers(layers);
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
    const recommendedLayers = jobQueueRepairLayers(input.jobQueue);
    findings.push({
      key: "job_queue",
      severity: input.jobQueue.blockedJobs > 0 || input.jobQueue.staleLeases > 0 ? "critical" : "warning",
      message: input.jobQueue.recommendedAction ?? "Job queue needs attention.",
      ...(recommendedLayers.length > 0 ? { recommendedLayers } : {})
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
    const recommendedLayers = operationalRepairLayers(input.operational);
    findings.push({
      key: "operational",
      severity: "warning",
      message: input.operational.recommendedAction ?? "Operational health is degraded.",
      ...(recommendedLayers.length > 0 ? { recommendedLayers } : {})
    });
  }

  if (input.operational && input.operational.cache.partialObjects > 0) {
    findings.push({
      key: "partial_cache",
      severity: "warning",
      message: `${input.operational.cache.partialObjects} cached GitHub objects have incomplete workflow evidence; backfill PR detail, issue timeline, or comments before treating related conclusions as final.`,
      recommendedLayers: partialCacheRepairLayers
    });
  }

  return findings;
}
