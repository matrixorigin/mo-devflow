import { syncHealthLayers, type DashboardSummary, type ManualRefreshLayer, type SyncHealth } from "@mo-devflow/shared";

export type FreshnessSeverity = "ok" | "warning" | "critical";
export type CacheEvidenceSeverity = FreshnessSeverity | "info";
export type CacheEvidenceAlertType = "success" | "info" | "warning" | "error";

export interface FreshnessSummary {
  severity: FreshnessSeverity;
  label: string;
  tagColor: string;
  unhealthyLayers: SyncHealth[];
  oldestLayerSuccessAt: string | null;
}

export interface CacheEvidenceSummary {
  severity: CacheEvidenceSeverity;
  alertType: CacheEvidenceAlertType;
  title: string;
  description: string;
  facts: string[];
  affectedConclusions: string[];
  recommendedAction: string | null;
}

export interface CacheRepairRecommendation {
  layers: ManualRefreshLayer[];
  reasons: string[];
}

const derivedRepairLayers: ManualRefreshLayer[] = ["rules", "metrics", "ai_drift"];

function addLayer(layers: ManualRefreshLayer[], layer: ManualRefreshLayer): void {
  if (!layers.includes(layer)) {
    layers.push(layer);
  }
}

function addDerivedRepairLayers(layers: ManualRefreshLayer[]): void {
  for (const layer of derivedRepairLayers) {
    addLayer(layers, layer);
  }
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

function evidenceHours(value: number | null): string {
  if (value === null) {
    return "unknown";
  }
  if (value < 24) {
    return `${value.toFixed(value % 1 === 0 ? 0 : 1)}h`;
  }
  return `${(value / 24).toFixed(1)}d`;
}

export function recommendCacheRepair(sync: DashboardSummary["sync"]): CacheRepairRecommendation {
  const layers: ManualRefreshLayer[] = [];
  const reasons: string[] = [];
  const unhealthyLayers = sync.health.filter((item) => item.status !== "success");

  for (const item of unhealthyLayers) {
    addLayer(layers, item.layer);
  }
  if (unhealthyLayers.length > 0) {
    reasons.push(`Repair unhealthy layers: ${unhealthyLayers.map((item) => item.layer).join(", ")}.`);
  }

  const staleSamples = sync.staleSamples ?? [];
  const partialSamples = sync.partialSamples ?? [];
  const staleObjectTypes = new Set(staleSamples.map((sample) => sample.objectType));
  const partialObjectTypes = new Set(partialSamples.map((sample) => sample.objectType));

  if (sync.staleObjects > 0) {
    addLayer(layers, "github_sync");
    reasons.push("Refresh GitHub issue/PR cache because active visible objects are stale.");
    addDerivedRepairLayers(layers);
  }

  if (staleObjectTypes.has("pull_request") || partialObjectTypes.has("pull_request")) {
    addLayer(layers, "pr_backfill");
    reasons.push("Backfill PR detail because sampled PRs are stale or partial.");
    addDerivedRepairLayers(layers);
  }

  if (partialObjectTypes.has("issue")) {
    addLayer(layers, "issue_timeline_backfill");
    addLayer(layers, "comment_backfill");
    reasons.push("Backfill issue timeline and comments because sampled issues have partial workflow evidence.");
    addDerivedRepairLayers(layers);
  }

  if (sync.partialObjects > 0 && partialSamples.length === 0) {
    addLayer(layers, "pr_backfill");
    addLayer(layers, "issue_timeline_backfill");
    addLayer(layers, "comment_backfill");
    reasons.push("Partial objects exist without samples; repair PR detail plus issue timeline/comment evidence.");
    addDerivedRepairLayers(layers);
  }

  return {
    layers: syncHealthLayers.filter((layer) => layers.includes(layer)),
    reasons
  };
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

export function summarizeCacheEvidence(input: {
  sync: DashboardSummary["sync"];
  visibility: DashboardSummary["visibility"];
}): CacheEvidenceSummary {
  const brokenLayers = input.sync.health.filter((item) => item.status === "failed" || item.status === "blocked");
  const incompleteLayers = input.sync.health.filter(
    (item) => item.status === "partial" || item.status === "not_started"
  );
  const facts: string[] = [];
  if (input.sync.staleObjects > 0) {
    facts.push(`${input.sync.staleObjects} active visible GitHub objects are stale`);
  }
  if (input.sync.partialObjects > 0) {
    facts.push(`${input.sync.partialObjects} cached objects are partial`);
  }
  if (input.visibility.hiddenObjects > 0) {
    facts.push(`${input.visibility.hiddenObjects} cached GitHub objects are hidden`);
  }
  if (brokenLayers.length > 0) {
    facts.push(`Blocked or failed sync layers: ${brokenLayers.map((item) => item.layer).join(", ")}`);
  }
  if (incompleteLayers.length > 0) {
    facts.push(`Incomplete sync layers: ${incompleteLayers.map((item) => item.layer).join(", ")}`);
  }

  if (brokenLayers.length > 0) {
    return {
      severity: "critical",
      alertType: "error",
      title: "Evidence quality is degraded",
      description:
        "One or more sync layers are blocked or failing. Cached data is still shown, but fresh workflow conclusions should wait for the failed layer to recover.",
      facts,
      affectedConclusions: [
        "current s-1/s0 ownership and blockers",
        "PR attention freshness",
        "workflow violation freshness"
      ],
      recommendedAction: "Open Operational Health, inspect the failed sync layer, then queue a targeted refresh."
    };
  }

  if (input.sync.staleObjects > 0) {
    return {
      severity: "warning",
      alertType: "warning",
      title: "Some active cache evidence is stale",
      description: `${input.sync.staleObjects} active visible GitHub objects are older than ${evidenceHours(
        input.sync.staleThresholdHours
      )}; oldest visible cache age is ${evidenceHours(
        input.sync.oldestCacheAgeHours
      )}. Known cached facts remain visible, but current workflow conclusions should be reviewed after refresh.`,
      facts,
      affectedConclusions: [
        "current s-1/s0 ownership and blockers",
        "PR attention age",
        "testing queue state",
        "workflow violation freshness"
      ],
      recommendedAction: "Queue a targeted worker refresh for the stale sync layers."
    };
  }

  if (input.sync.partialObjects > 0) {
    return {
      severity: "warning",
      alertType: "warning",
      title: "Some workflow evidence is partial",
      description: `${input.sync.partialObjects} cached objects have incomplete timeline, review, comment, or CI/detail evidence. Known cached facts remain visible; evidence-dependent rules are partial signals, not confirmed conclusions.`,
      facts,
      affectedConclusions: [
        "deferred explanation checks",
        "review, CI, mergeability, and testing handoff rules",
        "AI effort drift duration checks"
      ],
      recommendedAction:
        "Run authenticated or service-token backfill for PR detail, comments, reviews, and timeline data."
    };
  }

  if (input.visibility.hiddenObjects > 0) {
    return {
      severity: "info",
      alertType: "info",
      title: "This view is filtered by access policy",
      description: `This ${input.visibility.scope} view only includes ${input.visibility.visibleClasses.join(
        ", "
      )}. ${input.visibility.note ?? "Some cached objects are outside the current viewer scope."}`,
      facts,
      affectedConclusions: ["team and personal totals for objects outside the current access scope"],
      recommendedAction: "Connect an authorized GitHub token to view data allowed by that token."
    };
  }

  return {
    severity: "ok",
    alertType: "success",
    title: "Evidence quality is clear",
    description: "Sync layers are healthy, active cache is fresh, and no cached objects are hidden for this view.",
    facts,
    affectedConclusions: [],
    recommendedAction: null
  };
}
