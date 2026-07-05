import {
  repoProfileConfigurationStatus,
  syncHealthLayers,
  type RepoProfile,
  type JobQueueHealth,
  type ManualRefreshLayer,
  type OperationalHealthSummary,
  type WorkerHealth
} from "@mo-devflow/shared";
import { tokenEncryptionConfigFromEnv } from "./authCrypto";

export type ApiHealthStatus = "healthy" | "degraded" | "unhealthy";
export type ApiHealthFindingSeverity = "warning" | "critical";

export interface ApiHealthFinding {
  key: string;
  severity: ApiHealthFindingSeverity;
  message: string;
  recommendedLayers?: ManualRefreshLayer[];
}

export interface ApiAccessHealth {
  anonymousReadEnabled: boolean;
  writeBackEnabled: boolean;
  githubOAuthConfigured: boolean;
  tokenEncryptionConfigured: boolean;
  tokenEncryptionError: string | null;
  serviceReadTokenConfigured: boolean;
  webhookSecretConfigured: boolean;
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

function githubOAuthConfiguredFromEnv(env: Record<string, string | undefined>): boolean {
  return Boolean(
    env.MO_DEVFLOW_GITHUB_OAUTH_CLIENT_ID?.trim() && env.MO_DEVFLOW_GITHUB_OAUTH_CLIENT_SECRET?.trim()
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function tokenEncryptionHealthFromEnv(env: Record<string, string | undefined>): {
  configured: boolean;
  error: string | null;
} {
  try {
    return { configured: tokenEncryptionConfigFromEnv(env) !== null, error: null };
  } catch (error) {
    return { configured: false, error: errorMessage(error) };
  }
}

export function apiAccessHealthFromConfig(
  profile: RepoProfile,
  env: Record<string, string | undefined> = process.env
): ApiAccessHealth {
  const profileConfiguration = repoProfileConfigurationStatus(profile, env);
  const tokenEncryption = tokenEncryptionHealthFromEnv(env);
  return {
    anonymousReadEnabled: profile.access.anonymousRead,
    writeBackEnabled: profile.access.writeBackEnabled,
    githubOAuthConfigured: githubOAuthConfiguredFromEnv(env),
    tokenEncryptionConfigured: tokenEncryption.configured,
    tokenEncryptionError: tokenEncryption.error,
    serviceReadTokenConfigured: profileConfiguration.githubServiceTokenConfigured,
    webhookSecretConfigured: profileConfiguration.webhookSecretConfigured
  };
}

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

function operationalHasNonRateLimitDegradation(operational: OperationalHealthSummary): boolean {
  const hasConcreteNonRateLimitSignal =
    operational.sync.unhealthyLayers.length > 0 ||
    operational.cache.staleObjects > 0 ||
    operational.notifications.failedDeliveries > 0 ||
    operational.webhooks.failedDeliveries > 0 ||
    operational.webhooks.normalizationFailedDeliveries > 0 ||
    operational.webhooks.staleProcessingDeliveries > 0;
  if (hasConcreteNonRateLimitSignal) {
    return true;
  }
  return operational.sync.rateLimitedLayers.length === 0 && operational.recommendedAction !== null;
}

export function apiHealthStatus(input: {
  worker: WorkerHealth;
  jobQueue: JobQueueHealth;
  operational?: OperationalHealthSummary | null;
  operationalError?: string | null;
  access?: ApiAccessHealth | null;
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
  if (
    input.access?.writeBackEnabled &&
    (!input.access.githubOAuthConfigured || !input.access.tokenEncryptionConfigured)
  ) {
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
  access?: ApiAccessHealth | null;
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
    if (input.operational.sync.rateLimitedLayers.length > 0) {
      findings.push({
        key: "github_rate_limit",
        severity: "critical",
        message:
          input.operational.recommendedAction ??
          `GitHub API rate limit is exhausted for ${input.operational.sync.rateLimitedLayers.join(
            ", "
          )}. Wait for reset before queueing more GitHub sync or backfill work.`
      });
    }
  }

  if (input.operational?.status === "degraded" && operationalHasNonRateLimitDegradation(input.operational)) {
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

  if (input.access && !input.access.githubOAuthConfigured) {
    findings.push({
      key: "github_oauth",
      severity: input.access.writeBackEnabled ? "critical" : "warning",
      message:
        "GitHub OAuth is not configured. Team members can observe cached data, but browser login, manual repair actions, and personal write-token binding are unavailable."
    });
  }

  if (input.access && !input.access.tokenEncryptionConfigured) {
    findings.push({
      key: "token_encryption",
      severity: input.access.writeBackEnabled ? "critical" : "warning",
      message: input.access.tokenEncryptionError
        ? `Personal write-token encryption is misconfigured: ${input.access.tokenEncryptionError}`
        : "Personal write-token encryption is not configured. Logged-in users cannot connect personal GitHub write tokens until MO_DEVFLOW_TOKEN_ENCRYPTION_KEY is set."
    });
  }

  if (input.access && !input.access.serviceReadTokenConfigured) {
    findings.push({
      key: "service_read_token",
      severity: "warning",
      message:
        "No service read token is configured. Repository-wide polling can still use anonymous GitHub quota, but PR review, CI, mergeability, issue links, and comment-backed rules may remain partial.",
      recommendedLayers: partialCacheRepairLayers
    });
  }

  if (input.access && !input.access.webhookSecretConfigured) {
    findings.push({
      key: "webhook_secret",
      severity: "warning",
      message:
        "GitHub webhook secret is not configured. Dashboards still update through worker polling and manual refresh, but near-real-time issue and PR updates are disabled."
    });
  }

  return findings;
}
