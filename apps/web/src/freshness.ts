import {
  syncHealthLayers,
  type DashboardSummary,
  type ManualRefreshLayer,
  type SessionView,
  type SyncHealth
} from "@mo-devflow/shared";

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

export type WebhookReadinessMode =
  "polling_only" | "waiting_for_delivery" | "connected_waiting_for_activity" | "receiving" | "queued" | "failed";

export interface WebhookReadinessSummary {
  tone: UpdatePipelineTone;
  mode: WebhookReadinessMode;
  title: string;
  description: string;
  facts: string[];
  nextActions: string[];
}

export type ProductionReadinessStatus = "ready" | "needs_action" | "waiting" | "disabled";
export type ProductionReadinessGateKey =
  | "cache"
  | "worker"
  | "service_token"
  | "github_evidence"
  | "webhook"
  | "token"
  | "write_back"
  | "notifications"
  | "audit";
export type ProductionReadinessTarget = "health" | "webhooks" | "notifications" | "audit" | "connect_token";

export interface ProductionReadinessGate {
  key: ProductionReadinessGateKey;
  label: string;
  status: ProductionReadinessStatus;
  tone: UpdatePipelineTone;
  value: string;
  detail: string;
  action: string;
  target: ProductionReadinessTarget;
}

export interface ProductionReadinessSummary {
  tone: UpdatePipelineTone;
  score: number;
  label: string;
  title: string;
  detail: string;
  gates: ProductionReadinessGate[];
  blockers: ProductionReadinessGate[];
  waiting: ProductionReadinessGate[];
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

function evidenceDate(value: string | null): string {
  return value ?? "none";
}

function failedWebhookDeliveries(webhooks: DashboardSummary["webhooks"]): number {
  return webhooks.failedDeliveries + webhooks.normalizationFailedDeliveries;
}

function hasWebhookSecretWarning(profileWarnings: DashboardSummary["profileWarnings"]): boolean {
  return profileWarnings.some((warning) => warning.key === "webhook:secret_unconfigured");
}

const githubEvidenceLayers: ManualRefreshLayer[] = ["pr_backfill", "comment_backfill", "issue_timeline_backfill"];

function summarizeServiceReadTokenGate(data: DashboardSummary): ProductionReadinessGate {
  const configured = data.profileConfiguration.githubServiceTokenConfigured;
  return {
    key: "service_token",
    label: "Service read token",
    status: configured ? "ready" : "needs_action",
    tone: configured ? "good" : "critical",
    value: configured ? "configured" : "anonymous",
    detail: configured
      ? "Worker polling and backfill use the deployment service read token; personal Connect is not the service source."
      : "Configure MO_DEVFLOW_GITHUB_TOKEN, GITHUB_TOKEN, or GH_TOKEN for read-only polling and evidence backfill. Do not use a leader browser Connect as the service source.",
    action: configured ? "Inspect health" : "Configure env",
    target: "health"
  };
}

function summarizeGithubEvidenceGate(data: DashboardSummary): ProductionReadinessGate {
  const configuration = data.profileConfiguration;
  const limits = [
    configuration.prDetailBackfillLimit,
    configuration.commentBackfillLimit,
    configuration.issueTimelineBackfillLimit
  ];
  const limitValue = `${limits[0]}/${limits[1]}/${limits[2]}`;
  const evidenceLayers = data.sync.health.filter((item) => githubEvidenceLayers.includes(item.layer));
  const failedLayers = evidenceLayers.filter((item) => item.status === "failed" || item.status === "blocked");
  const incompleteLayers = evidenceLayers.filter(
    (item) => item.status === "partial" || item.status === "not_started" || item.skipped
  );

  if (failedLayers.length > 0) {
    return {
      key: "github_evidence",
      label: "PR/issue evidence",
      status: "needs_action",
      tone: "critical",
      value: `${failedLayers.length} failed`,
      detail: `Backfill failed for ${failedLayers.map((item) => item.layer).join(", ")}; PR review, CI, links, and comment checks may be wrong.`,
      action: "Repair evidence",
      target: "health"
    };
  }

  if (!configuration.githubEvidenceBackfillConfigured) {
    return {
      key: "github_evidence",
      label: "PR/issue evidence",
      status: "needs_action",
      tone: configuration.githubServiceTokenConfigured ? "attention" : "critical",
      value: configuration.githubServiceTokenConfigured ? `limits ${limitValue}` : "anonymous only",
      detail: configuration.githubServiceTokenConfigured
        ? "Service token exists, but at least one PR detail, comment, or issue timeline backfill limit is zero."
        : "No service read token or evidence backfill limit is configured, so PR review, CI, mergeability, issue links, and comment-backed rules can be incomplete.",
      action: "Configure evidence",
      target: "health"
    };
  }

  if (data.sync.partialObjects > 0 || incompleteLayers.length > 0) {
    return {
      key: "github_evidence",
      label: "PR/issue evidence",
      status: "waiting",
      tone: "attention",
      value: `limits ${limitValue}`,
      detail:
        "Evidence backfill is configured, but cached GitHub objects still include partial PR detail, comment, or timeline evidence.",
      action: "Repair evidence",
      target: "health"
    };
  }

  return {
    key: "github_evidence",
    label: "PR/issue evidence",
    status: "ready",
    tone: "good",
    value: `backfill ${limitValue}`,
    detail: "PR review, CI, mergeability, issue links, and issue comment evidence have configured backfill coverage.",
    action: "Inspect health",
    target: "health"
  };
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
        webhooks.oldestPendingReceivedAt
          ? `oldest pending ${webhooks.oldestPendingReceivedAt}`
          : "oldest pending unknown",
        webhooks.lastReceivedAt ? `last ${webhooks.lastReceivedAt}` : "no processed delivery yet"
      ],
      nextActions: [
        "Confirm the worker and queue stay healthy until pending deliveries drain.",
        "Use Refresh webhooks if the queue does not move."
      ]
    };
  }

  if (webhooks.processedDeliveries > 0) {
    return {
      tone: "good",
      mode: "receiving",
      title: "Webhook ingest is receiving workflow events",
      description:
        "GitHub workflow deliveries are reaching the cache; worker repair jobs keep derived dashboard facts current.",
      facts: [
        `last ${webhooks.lastReceivedAt}`,
        `${processed} processed`,
        `${webhooks.ignoredDeliveries} ignored`,
        `${webhooks.duplicateDeliveries} duplicates`
      ],
      nextActions: ["Monitor failed and pending counts; no setup action is required."]
    };
  }

  if (webhooks.lastConnectivityProbeAt) {
    return {
      tone: "good",
      mode: "connected_waiting_for_activity",
      title: "Webhook endpoint is connected",
      description:
        "GitHub ping has verified the payload URL and secret. No supported issue, PR, review, comment, or CI delivery has been processed yet.",
      facts: [
        `${webhooks.connectivityProbeDeliveries} ping probe${webhooks.connectivityProbeDeliveries === 1 ? "" : "s"}`,
        `last ping ${webhooks.lastConnectivityProbeAt}`,
        `${processed} processed workflow deliveries`
      ],
      nextActions: [
        "Trigger a harmless issue or PR update to verify supported workflow event processing.",
        "Keep worker polling enabled as repair until the first workflow event is processed."
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
    tone: "attention",
    mode: "waiting_for_delivery",
    title: "Webhook deliveries are visible but no workflow event has processed",
    description:
      "The endpoint has recorded deliveries, but they were ignored or unsupported. Near-real-time issue and PR freshness still needs a supported event.",
    facts: [
      `last ${webhooks.lastReceivedAt}`,
      `${webhooks.ignoredDeliveries} ignored`,
      `${webhooks.duplicateDeliveries} duplicates`,
      `${processed} processed workflow deliveries`
    ],
    nextActions: [
      "Confirm GitHub is sending the supported events listed below.",
      "Trigger an issue, PR, review, comment, or CI update and verify it is processed."
    ]
  };
}

export function summarizeUpdatePipeline(
  input: Pick<DashboardSummary, "sync" | "webhooks"> & Partial<Pick<DashboardSummary, "profileWarnings">>
): UpdatePipelineSummary {
  const worker = input.sync.worker;
  const queue = input.sync.jobQueue;
  const webhooks = input.webhooks;
  const secretMissing = input.profileWarnings ? hasWebhookSecretWarning(input.profileWarnings) : false;
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
            : secretMissing
              ? "polling only"
              : webhooks.processedDeliveries > 0
                ? "receiving"
                : webhooks.lastConnectivityProbeAt
                  ? "connected"
                  : "no deliveries",
      detail: webhooks.lastReceivedAt
        ? `last ${webhooks.lastReceivedAt}; ${webhooks.processedDeliveries} processed; ping ${evidenceDate(
            webhooks.lastConnectivityProbeAt
          )}`
        : secretMissing
          ? "webhook secret is missing; worker polling and manual refresh are the current update path"
          : "polling repair is the only observed update path",
      tone: webhookRisk
        ? "critical"
        : pendingWebhookRisk
          ? "attention"
          : webhooks.processedDeliveries > 0 || webhooks.lastConnectivityProbeAt
            ? "good"
            : "normal",
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
  if (secretMissing) {
    return {
      tone: "normal",
      title: "Updates are polling from cache",
      detail: "GitHub webhook ingest is not enabled; worker polling and manual refresh are the current update path.",
      tiles
    };
  }
  return {
    tone: "good",
    title: "Updates are flowing from cache",
    detail:
      webhooks.processedDeliveries > 0
        ? "Worker, queue, webhook processing, and active cache freshness are clear."
        : webhooks.lastConnectivityProbeAt
          ? "Worker and polling repair are healthy; GitHub ping has connected, but no supported workflow event has processed yet."
          : "Worker and polling repair are healthy; no GitHub webhook delivery has been observed in cache.",
    tiles
  };
}

export function summarizeProductionReadiness(input: {
  data: DashboardSummary;
  session: SessionView | null;
}): ProductionReadinessSummary {
  const data = input.data;
  const session = input.session;
  const webhookReadiness = summarizeWebhookReadiness(data);
  const tokenEncryptionMissing = session?.tokenEncryptionConfigured === false;
  const authenticated = Boolean(session?.authenticated && session.user);
  const writeCapability = session?.user?.writeCapabilities.issueLabels ?? null;
  const writeActionFailures = data.writeActions.filter((action) =>
    ["failed", "stale_preview", "token_unavailable", "blocked"].includes(action.status)
  ).length;

  const gates: ProductionReadinessGate[] = [
    {
      key: "cache",
      label: "Cache evidence",
      status: data.sync.staleObjects > 0 ? "needs_action" : data.sync.partialObjects > 0 ? "waiting" : "ready",
      tone: data.sync.staleObjects > 0 ? "critical" : data.sync.partialObjects > 0 ? "attention" : "good",
      value:
        data.sync.staleObjects > 0
          ? `${data.sync.staleObjects} stale`
          : data.sync.partialObjects > 0
            ? `${data.sync.partialObjects} partial`
            : "current",
      detail:
        data.sync.staleObjects > 0 || data.sync.partialObjects > 0
          ? "Workflow conclusions may change after backfill or refresh."
          : "Visible cached objects are fresh and complete.",
      action: data.sync.staleObjects > 0 || data.sync.partialObjects > 0 ? "Repair cache" : "Inspect health",
      target: "health"
    },
    {
      key: "worker",
      label: "Worker and jobs",
      status:
        data.sync.worker.status === "active" && data.sync.jobQueue.status === "healthy" ? "ready" : "needs_action",
      tone: data.sync.worker.status === "active" && data.sync.jobQueue.status === "healthy" ? "good" : "critical",
      value: data.sync.worker.status === "active" ? `${data.sync.jobQueue.queueDepth} queued` : data.sync.worker.status,
      detail:
        data.sync.worker.status === "active" && data.sync.jobQueue.status === "healthy"
          ? "Polling, repair jobs, and derived metrics can run."
          : (data.sync.worker.recommendedAction ??
            data.sync.jobQueue.recommendedAction ??
            "Worker or queue state is not healthy."),
      action: "Open health",
      target: "health"
    },
    summarizeServiceReadTokenGate(data),
    summarizeGithubEvidenceGate(data),
    {
      key: "webhook",
      label: "Near real-time updates",
      status:
        webhookReadiness.mode === "receiving"
          ? "ready"
          : webhookReadiness.mode === "connected_waiting_for_activity"
            ? "waiting"
            : webhookReadiness.mode === "failed" || webhookReadiness.mode === "polling_only"
              ? "needs_action"
              : "waiting",
      tone: webhookReadiness.tone,
      value: webhookReadiness.mode === "receiving" ? "receiving" : webhookReadiness.mode.replaceAll("_", " "),
      detail: webhookReadiness.description,
      action: webhookReadiness.mode === "failed" ? "Retry or inspect" : "Open webhooks",
      target: "webhooks"
    },
    {
      key: "token",
      label: "Personal write token",
      status: tokenEncryptionMissing ? "needs_action" : authenticated ? "ready" : "waiting",
      tone: tokenEncryptionMissing ? "critical" : authenticated ? "good" : "attention",
      value: tokenEncryptionMissing
        ? "server setup"
        : authenticated
          ? (session?.user?.githubLogin ?? "connected")
          : "observer",
      detail: tokenEncryptionMissing
        ? "Token encryption is missing, so users cannot connect GitHub tokens."
        : authenticated
          ? "GitHub writes and privileged actions use the connected user's identity."
          : "Anonymous viewers can inspect cached data only.",
      action: authenticated ? "Reconnect personal token" : "Connect personal token",
      target: "connect_token"
    },
    {
      key: "write_back",
      label: "Workflow fixes",
      status: !data.profileConfiguration.writeBackEnabled
        ? "disabled"
        : writeCapability?.enabled
          ? "ready"
          : authenticated
            ? "needs_action"
            : "waiting",
      tone: !data.profileConfiguration.writeBackEnabled
        ? "normal"
        : writeCapability?.enabled
          ? "good"
          : authenticated
            ? "attention"
            : "attention",
      value: !data.profileConfiguration.writeBackEnabled
        ? "read-only"
        : writeCapability?.enabled
          ? "ready"
          : (writeCapability?.status.replaceAll("_", " ") ?? "personal token needed"),
      detail: !data.profileConfiguration.writeBackEnabled
        ? "Repository profile keeps GitHub write-back disabled."
        : (writeCapability?.message ??
          "Connect a personal token with issue label/comment permissions before confirmed writes."),
      action: writeCapability?.enabled ? "Open audit" : "Connect personal token",
      target: writeCapability?.enabled ? "audit" : "connect_token"
    },
    {
      key: "notifications",
      label: "Notifications",
      status:
        data.notifications.readiness.status === "ready"
          ? "ready"
          : data.notifications.readiness.status === "disabled"
            ? "disabled"
            : "needs_action",
      tone:
        data.notifications.readiness.status === "ready"
          ? "good"
          : data.notifications.readiness.status === "disabled"
            ? "normal"
            : data.notifications.readiness.status === "degraded"
              ? "attention"
              : "critical",
      value: data.notifications.readiness.status.replaceAll("_", " "),
      detail:
        data.notifications.readiness.blockers[0] ??
        data.notifications.readiness.warnings[0] ??
        `${data.notifications.readiness.mappedEmployees} mapped employees, ${data.notifications.failedDeliveries} failed deliveries.`,
      action: "Open notifications",
      target: "notifications"
    },
    {
      key: "audit",
      label: "Write audit",
      status: writeActionFailures > 0 ? "needs_action" : data.writeActions.length > 0 ? "ready" : "waiting",
      tone: writeActionFailures > 0 ? "attention" : data.writeActions.length > 0 ? "good" : "normal",
      value: writeActionFailures > 0 ? `${writeActionFailures} failed` : `${data.writeActions.length} records`,
      detail:
        writeActionFailures > 0
          ? "Some confirmed write attempts failed or became stale."
          : data.writeActions.length > 0
            ? "Confirmed write operations are visible in the audit trail."
            : "No confirmed workflow write has been executed yet.",
      action: "Open audit",
      target: "audit"
    }
  ];

  const blockers = gates.filter((gate) => gate.status === "needs_action");
  const waiting = gates.filter((gate) => gate.status === "waiting");
  const weightedScore = gates.reduce((total, gate) => {
    if (gate.status === "ready") {
      return total + 2;
    }
    if (gate.status === "waiting" || gate.status === "disabled") {
      return total + 1;
    }
    return total;
  }, 0);
  const score = Math.round((weightedScore / (gates.length * 2)) * 100);
  const nextActions = blockers.length > 0 ? blockers.slice(0, 3).map((gate) => `${gate.label}: ${gate.action}`) : [];

  if (blockers.some((gate) => gate.tone === "critical")) {
    return {
      tone: "critical",
      score,
      label: "action required",
      title: "Production readiness has blocking gaps",
      detail: `${blockers.length} capability gates need action before this can be treated as a production control loop.`,
      gates,
      blockers,
      waiting,
      nextActions
    };
  }

  if (blockers.length > 0) {
    return {
      tone: "attention",
      score,
      label: "needs action",
      title: "Production readiness needs attention",
      detail: `${blockers.length} capability gates need action; cached observation remains available.`,
      gates,
      blockers,
      waiting,
      nextActions
    };
  }

  if (waiting.length > 0) {
    return {
      tone: "attention",
      score,
      label: "waiting for evidence",
      title: "Production readiness is waiting for live evidence",
      detail: `${waiting.length} gates are configured or safe, but still need real service/personal token, delivery, write, or audit evidence to prove the loop.`,
      gates,
      blockers,
      waiting,
      nextActions: waiting.slice(0, 3).map((gate) => `${gate.label}: ${gate.action}`)
    };
  }

  return {
    tone: "good",
    score,
    label: "ready",
    title: "Production readiness is clear",
    detail:
      "Cache, worker, service read token, PR/issue evidence, webhook, personal write token, write-back, notifications, and audit evidence are in a usable state.",
    gates,
    blockers,
    waiting,
    nextActions: []
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
  const viewLimitRisk = sync.viewLimits.length > 0;
  if (worstLayerRank >= 3) {
    return {
      severity: "critical",
      label: "sync degraded",
      tagColor: "red",
      unhealthyLayers,
      oldestLayerSuccessAt: oldestIso(sync.health.map((item) => item.lastSuccessfulAt))
    };
  }
  if (worstLayerRank >= 2 || sync.staleObjects > 0 || sync.partialObjects > 0 || viewLimitRisk) {
    return {
      severity: "warning",
      label: viewLimitRisk ? "view may be capped" : "cache needs attention",
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
  if (input.sync.viewLimits.length > 0) {
    facts.push(
      `Dashboard read limits reached: ${input.sync.viewLimits.map((limit) => limit.label).join(", ")}`
    );
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
        "review, CI, mergeability, and issue testing rules",
        "AI effort drift duration checks"
      ],
      recommendedAction:
        skippedLayers.length > 0
          ? "Enable the skipped backfill layers with a service read token, a personal token, or a non-zero backfill limit, then queue the targeted repair."
          : "Run personal-token or service-token backfill for PR detail, comments, reviews, and timeline data."
    };
  }

  if (input.sync.viewLimits.length > 0) {
    return {
      severity: "warning",
      alertType: "warning",
      title: "Some dashboard views may be capped",
      description:
        "The API hit protective read limits while building this dashboard. Visible rows are still sorted by priority, but totals, filters, and charts should be treated as capped until the query scope is narrowed or the backend limit is raised deliberately.",
      facts,
      affectedConclusions: [
        "team totals on capped boards",
        "personal workload comparison",
        "issue-to-PR link coverage",
        "trend completeness for the capped window"
      ],
      recommendedAction:
        "Use board filters to narrow the view, or review backend read limits before treating the capped board as complete."
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
      recommendedAction: "Connect an authorized personal GitHub token to view data allowed by that token."
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
