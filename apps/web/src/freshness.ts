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

export type UpdatePipelineTone = "critical" | "attention" | "good" | "normal";
export type UpdatePipelineTarget = "health" | "webhooks";

export interface UpdatePipelineTile {
  key: "worker" | "queue" | "webhooks" | "cache";
  label: string;
  value: string;
  detail: string;
  tone: UpdatePipelineTone;
  target: UpdatePipelineTarget;
}

export interface UpdatePipelineSummary {
  tone: UpdatePipelineTone;
  title: string;
  detail: string;
  tiles: UpdatePipelineTile[];
}

export type WebhookReadinessMode = "polling_only" | "waiting_for_delivery" | "receiving" | "queued" | "failed";

export interface WebhookReadinessSummary {
  tone: UpdatePipelineTone;
  mode: WebhookReadinessMode;
  title: string;
  description: string;
  facts: string[];
  nextActions: string[];
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

function failedWebhookDeliveries(webhooks: DashboardSummary["webhooks"]): number {
  return webhooks.failedDeliveries + webhooks.normalizationFailedDeliveries;
}

function hasWebhookSecretWarning(profileWarnings: DashboardSummary["profileWarnings"]): boolean {
  return profileWarnings.some((warning) => warning.key === "webhook:secret_unconfigured");
}

export function summarizeWebhookReadiness(
  input: Pick<DashboardSummary, "profileWarnings" | "webhooks">
): WebhookReadinessSummary {
  const secretMissing = hasWebhookSecretWarning(input.profileWarnings);
  const webhooks = input.webhooks;
  const failures = failedWebhookDeliveries(webhooks);
  const processed = webhooks.processedDeliveries;

  if (failures > 0) {
    return {
      tone: "critical",
      mode: "failed",
      title: "Webhook deliveries need attention",
      description: "GitHub deliveries are reaching the cache, but some failed before producing fresh dashboard facts.",
      facts: [
        `${failures} failed`,
        `${webhooks.pendingDeliveries} pending`,
        webhooks.latestFailure ? `latest: ${webhooks.latestFailure}` : "failure details retained in delivery rows"
      ],
      nextActions: [
        "Retry failed deliveries after the underlying GitHub or normalization error is fixed.",
        "Review failed rows below before relying on near-real-time freshness."
      ]
    };
  }

  if (secretMissing) {
    return {
      tone: "attention",
      mode: "polling_only",
      title: "Webhook ingest is not enabled",
      description:
        "Dashboards are still repaired by worker polling and manual refresh, but GitHub changes will not arrive near real time.",
      facts: [
        "secret env missing",
        "endpoint /api/webhooks/github",
        `${processed} processed deliveries`,
        webhooks.lastReceivedAt ? `last ${webhooks.lastReceivedAt}` : "no delivery observed"
      ],
      nextActions: [
        "Set MO_DEVFLOW_GITHUB_WEBHOOK_SECRET to the same value configured in GitHub.",
        "Create a GitHub webhook that posts to /api/webhooks/github with the accepted events below."
      ]
    };
  }

  if (webhooks.pendingDeliveries > 0) {
    return {
      tone: "attention",
      mode: "queued",
      title: "Webhook deliveries are queued",
      description: "GitHub deliveries have been accepted and are waiting for the worker to process cache updates.",
      facts: [
        `${webhooks.pendingDeliveries} pending`,
        `${processed} processed`,
        webhooks.lastReceivedAt ? `last ${webhooks.lastReceivedAt}` : "no processed delivery yet"
      ],
      nextActions: [
        "Confirm the worker and queue stay healthy until pending deliveries drain.",
        "Use Refresh webhooks if the queue does not move."
      ]
    };
  }

  if (!webhooks.lastReceivedAt) {
    return {
      tone: "attention",
      mode: "waiting_for_delivery",
      title: "Waiting for the first GitHub delivery",
      description:
        "The webhook secret is configured, but this cache has not observed a GitHub delivery yet. Polling remains the repair path until the first event arrives.",
      facts: ["secret configured", "endpoint /api/webhooks/github", "no delivery observed"],
      nextActions: [
        "Verify the GitHub webhook URL, secret, content type, and selected events.",
        "Trigger a harmless issue or PR update and confirm a delivery row appears."
      ]
    };
  }

  return {
    tone: "good",
    mode: "receiving",
    title: "Webhook ingest is receiving deliveries",
    description: "GitHub deliveries are reaching the cache; worker repair jobs keep derived dashboard facts current.",
    facts: [
      `last ${webhooks.lastReceivedAt}`,
      `${processed} processed`,
      `${webhooks.ignoredDeliveries} ignored`,
      `${webhooks.duplicateDeliveries} duplicates`
    ],
    nextActions: ["Monitor failed and pending counts; no setup action is required."]
  };
}

export function summarizeUpdatePipeline(input: Pick<DashboardSummary, "sync" | "webhooks">): UpdatePipelineSummary {
  const worker = input.sync.worker;
  const queue = input.sync.jobQueue;
  const webhooks = input.webhooks;
  const webhookFailures = failedWebhookDeliveries(webhooks);
  const workerRisk = worker.status !== "active";
  const queueRisk = queue.status !== "healthy";
  const webhookRisk = webhookFailures > 0;
  const staleRisk = input.sync.staleObjects > 0;
  const partialRisk = input.sync.partialObjects > 0;
  const pendingWebhookRisk = webhooks.pendingDeliveries > 0;

  const tiles: UpdatePipelineTile[] = [
    {
      key: "worker",
      label: "Worker",
      value: worker.status === "active" ? (worker.phase ?? "active") : worker.status,
      detail:
        worker.secondsSinceHeartbeat === null
          ? "heartbeat unknown"
          : `heartbeat ${Math.round(worker.secondsSinceHeartbeat)}s ago`,
      tone: workerRisk ? "critical" : "good",
      target: "health"
    },
    {
      key: "queue",
      label: "Queue",
      value: `${queue.queueDepth} queued`,
      detail:
        queue.failedJobs + queue.blockedJobs + queue.staleLeases > 0
          ? `${queue.failedJobs} failed, ${queue.blockedJobs} blocked, ${queue.staleLeases} stale leases`
          : queue.nextRunAt
            ? `next ${queue.nextRunAt}`
            : "no scheduled job in cache",
      tone: queueRisk ? "critical" : queue.queueDepth > 0 || queue.runningJobs > 0 ? "attention" : "good",
      target: "health"
    },
    {
      key: "webhooks",
      label: "Webhooks",
      value:
        webhookFailures > 0
          ? `${webhookFailures} failed`
          : webhooks.pendingDeliveries > 0
            ? `${webhooks.pendingDeliveries} pending`
            : webhooks.lastReceivedAt
              ? "receiving"
              : "no deliveries",
      detail: webhooks.lastReceivedAt
        ? `last ${webhooks.lastReceivedAt}; ${webhooks.processedDeliveries} processed`
        : "polling repair is the only observed update path",
      tone: webhookRisk ? "critical" : pendingWebhookRisk ? "attention" : webhooks.lastReceivedAt ? "good" : "normal",
      target: "webhooks"
    },
    {
      key: "cache",
      label: "Cache",
      value: staleRisk ? `${input.sync.staleObjects} stale` : `${input.sync.partialObjects} incomplete`,
      detail: `oldest ${evidenceHours(input.sync.oldestCacheAgeHours)}; threshold ${evidenceHours(
        input.sync.staleThresholdHours
      )}`,
      tone: staleRisk ? "critical" : partialRisk ? "attention" : "good",
      target: "health"
    }
  ];

  if (workerRisk || queueRisk || webhookRisk) {
    return {
      tone: "critical",
      title: "Update pipeline needs operator attention",
      detail: "Worker, queue, or webhook delivery failures can delay issue and PR changes from reaching dashboards.",
      tiles
    };
  }
  if (staleRisk || partialRisk || pendingWebhookRisk) {
    return {
      tone: "attention",
      title: "Updates are flowing with evidence gaps",
      detail: "Cached facts remain visible, but some current workflow conclusions depend on refresh or backfill.",
      tiles
    };
  }
  return {
    tone: "good",
    title: "Updates are flowing from cache",
    detail: webhooks.lastReceivedAt
      ? "Worker, queue, webhook processing, and active cache freshness are clear."
      : "Worker and polling repair are healthy; no GitHub webhook delivery has been observed in cache.",
    tiles
  };
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
  const skippedLayers = input.sync.health.filter((item) => item.skipped);
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
  if (skippedLayers.length > 0) {
    facts.push(
      `Skipped sync layers: ${skippedLayers
        .map((item) => (item.skipReason ? `${item.layer} (${item.skipReason})` : item.layer))
        .join(", ")}`
    );
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
        skippedLayers.length > 0
          ? "Enable the skipped backfill layers with a service/user token or non-zero backfill limit, then queue the targeted repair."
          : "Run authenticated or service-token backfill for PR detail, comments, reviews, and timeline data."
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
