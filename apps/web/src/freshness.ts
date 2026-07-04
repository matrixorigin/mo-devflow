import type { DashboardSummary, SyncHealth } from "@mo-devflow/shared";

export type FreshnessSeverity = "ok" | "warning" | "critical";

export interface FreshnessSummary {
  severity: FreshnessSeverity;
  label: string;
  tagColor: string;
  unhealthyLayers: SyncHealth[];
  oldestLayerSuccessAt: string | null;
}

function layerRank(status: SyncHealth["status"]): number {
  if (status === "failed" || status === "blocked") {
    return 3;
  }
  if (status === "partial" || status === "not_started") {
    return 2;
  }
  return 1;
}

function oldestIso(values: Array<string | null>): string | null {
  let oldest: string | null = null;
  for (const value of values) {
    if (!value) {
      continue;
    }
    if (!oldest || new Date(value).getTime() < new Date(oldest).getTime()) {
      oldest = value;
    }
  }
  return oldest;
}

export function summarizeFreshness(sync: DashboardSummary["sync"]): FreshnessSummary {
  const unhealthyLayers = sync.health.filter((item) => item.status !== "success");
  const worstLayerRank = Math.max(1, ...sync.health.map((item) => layerRank(item.status)));
  if (worstLayerRank >= 3) {
    return {
      severity: "critical",
      label: "sync degraded",
      tagColor: "red",
      unhealthyLayers,
      oldestLayerSuccessAt: oldestIso(sync.health.map((item) => item.lastSuccessfulAt))
    };
  }
  if (worstLayerRank >= 2 || sync.staleObjects > 0 || sync.partialObjects > 0) {
    return {
      severity: "warning",
      label: "cache needs attention",
      tagColor: "orange",
      unhealthyLayers,
      oldestLayerSuccessAt: oldestIso(sync.health.map((item) => item.lastSuccessfulAt))
    };
  }
  return {
    severity: "ok",
    label: "cache current",
    tagColor: "green",
    unhealthyLayers,
    oldestLayerSuccessAt: oldestIso(sync.health.map((item) => item.lastSuccessfulAt))
  };
}
