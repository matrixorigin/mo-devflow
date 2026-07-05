import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { loadRepoProfile } from "@mo-devflow/config";
import {
  enqueueJobsNow,
  getOperationalHealth,
  getRepoId,
  recordManualRefreshRequest,
  retryFailedGitHubWebhookDeliveries,
  upsertRepoProfile
} from "@mo-devflow/db";
import type { ManualRefreshLayer, OperationalHealthSummary, SyncHealthLayer } from "@mo-devflow/shared";
import { getSessionRecordFromRequest } from "./authRoutes";
import { hasValidCsrfToken, sendCsrfRequired } from "./csrf";
import { FixedWindowRateLimiter, manualRefreshRateLimitConfigFromEnv } from "./rateLimit";
import { jobKeyForLayer, manualRefreshLayers, type RefreshJobSeed, webhookRetryRefreshJobs } from "./refreshJobs";

const manualRefreshSchema = z.object({
  layers: z.array(z.enum(manualRefreshLayers)).min(1).max(manualRefreshLayers.length).optional()
});

interface RefreshRouteOptions {
  onDashboardMutated?: () => void;
  manualRefreshRateLimiter?: FixedWindowRateLimiter;
}

function uniqueLayers(layers: ManualRefreshLayer[] | undefined): ManualRefreshLayer[] {
  const selected = layers && layers.length > 0 ? layers : [...manualRefreshLayers];
  return selected.filter((layer, index) => selected.indexOf(layer) === index);
}

function manualRefreshRateLimitKey(request: FastifyRequest, userId: number): string {
  return `manual-refresh:${userId}:${request.ip || "unknown"}`;
}

const githubApiRefreshLayers = new Set<ManualRefreshLayer>([
  "github_sync",
  "pr_backfill",
  "issue_timeline_backfill",
  "comment_backfill",
  "webhooks"
]);

export interface ManualRefreshGithubRateLimitBlock {
  blockedLayers: ManualRefreshLayer[];
  rateLimitedLayers: SyncHealthLayer[];
  resetAt: string | null;
  retryAfterSeconds: number | null;
}

function retryAfterSecondsForReset(resetAt: string | null, nowMs = Date.now()): number | null {
  if (!resetAt) {
    return null;
  }
  const resetMs = Date.parse(resetAt);
  if (!Number.isFinite(resetMs)) {
    return null;
  }
  return Math.max(1, Math.ceil((resetMs - nowMs) / 1000));
}

export function manualRefreshGithubRateLimitBlock(input: {
  requestedLayers: ManualRefreshLayer[];
  operational: OperationalHealthSummary;
  nowMs?: number;
}): ManualRefreshGithubRateLimitBlock | null {
  if (input.operational.sync.rateLimitedLayers.length === 0) {
    return null;
  }
  const blockedLayers = input.requestedLayers.filter((layer) => githubApiRefreshLayers.has(layer));
  if (blockedLayers.length === 0) {
    return null;
  }
  const resetAt =
    input.operational.sync.health
      .filter((item) => input.operational.sync.rateLimitedLayers.includes(item.layer) && item.rateLimitResetAt !== null)
      .map((item) => item.rateLimitResetAt)
      .filter((value): value is string => value !== null)
      .sort()[0] ?? null;
  return {
    blockedLayers,
    rateLimitedLayers: input.operational.sync.rateLimitedLayers,
    resetAt,
    retryAfterSeconds: retryAfterSecondsForReset(resetAt, input.nowMs)
  };
}

async function githubRateLimitBlockForRefresh(input: {
  app: FastifyInstance;
  repoId: number;
  requestedLayers: ManualRefreshLayer[];
}): Promise<ManualRefreshGithubRateLimitBlock | null> {
  try {
    return manualRefreshGithubRateLimitBlock({
      requestedLayers: input.requestedLayers,
      operational: await getOperationalHealth(input.repoId)
    });
  } catch (error) {
    input.app.log.warn({ error, requestedLayers: input.requestedLayers }, "manual refresh quota health check failed");
    return null;
  }
}

function sendGithubRateLimitedRefresh(reply: FastifyReply, block: ManualRefreshGithubRateLimitBlock) {
  if (block.retryAfterSeconds !== null) {
    reply.header("retry-after", String(block.retryAfterSeconds));
  }
  return reply.status(429).send({
    error: "manual_refresh_github_rate_limited",
    message: `GitHub API quota is exhausted for ${block.rateLimitedLayers.join(
      ", "
    )}. Wait before queueing GitHub sync or backfill layers. Cache-only layers can still run.`,
    blockedLayers: block.blockedLayers,
    rateLimitedLayers: block.rateLimitedLayers,
    resetAt: block.resetAt,
    retryAfterSeconds: block.retryAfterSeconds
  });
}

export async function registerRefreshRoutes(app: FastifyInstance, options: RefreshRouteOptions = {}): Promise<void> {
  const manualRefreshRateLimiter =
    options.manualRefreshRateLimiter ?? new FixedWindowRateLimiter(manualRefreshRateLimitConfigFromEnv());

  app.post("/api/refresh", async (request, reply) => {
    const session = await getSessionRecordFromRequest(request, reply);
    if (!session) {
      return reply.status(401).send({
        error: "login_required",
        message: "Sign in with GitHub before queueing refresh jobs."
      });
    }
    if (!hasValidCsrfToken(request)) {
      return sendCsrfRequired(reply);
    }

    const parsed = manualRefreshSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(422).send({
        error: "invalid_manual_refresh_input",
        message: "Manual refresh input is invalid."
      });
    }
    const rateLimit = manualRefreshRateLimiter.consume(manualRefreshRateLimitKey(request, session.userId));
    if (!rateLimit.allowed) {
      reply.header("retry-after", String(rateLimit.retryAfterSeconds));
      return reply.status(429).send({
        error: "manual_refresh_rate_limited",
        message: "Too many manual refresh requests. Retry later.",
        retryAfterSeconds: rateLimit.retryAfterSeconds
      });
    }

    const profile = loadRepoProfile();
    const repoId = (await getRepoId(profile.key)) ?? (await upsertRepoProfile(profile));
    const requestedAt = new Date().toISOString();
    const requestedLayers = uniqueLayers(parsed.data.layers);
    const quotaBlock = await githubRateLimitBlockForRefresh({ app, repoId, requestedLayers });
    if (quotaBlock) {
      return sendGithubRateLimitedRefresh(reply, quotaBlock);
    }
    const jobs: RefreshJobSeed[] = requestedLayers.map((layer) => ({
      jobKey: jobKeyForLayer(layer, profile.key),
      jobType: layer,
      payload: {
        requestedBy: session.githubLogin,
        requestedAt,
        trigger: "manual_refresh"
      }
    }));

    try {
      const queuedJobs = await enqueueJobsNow(jobs);
      const refreshRequest = await recordManualRefreshRequest({
        repoId,
        userId: session.userId,
        githubLogin: session.githubLogin,
        requestedLayers,
        queuedJobs
      });
      options.onDashboardMutated?.();
      return refreshRequest;
    } catch (error) {
      app.log.error({ error, githubLogin: session.githubLogin, requestedLayers }, "manual refresh queueing failed");
      return reply.status(500).send({
        error: "manual_refresh_failed",
        message: error instanceof Error ? error.message : String(error)
      });
    }
  });

  app.post("/api/refresh/webhooks/retry-failed", async (request, reply) => {
    const session = await getSessionRecordFromRequest(request, reply);
    if (!session) {
      return reply.status(401).send({
        error: "login_required",
        message: "Sign in with GitHub before retrying failed webhook deliveries."
      });
    }
    if (!hasValidCsrfToken(request)) {
      return sendCsrfRequired(reply);
    }
    const rateLimit = manualRefreshRateLimiter.consume(manualRefreshRateLimitKey(request, session.userId));
    if (!rateLimit.allowed) {
      reply.header("retry-after", String(rateLimit.retryAfterSeconds));
      return reply.status(429).send({
        error: "manual_refresh_rate_limited",
        message: "Too many manual refresh requests. Retry later.",
        retryAfterSeconds: rateLimit.retryAfterSeconds
      });
    }

    const profile = loadRepoProfile();
    const repoId = (await getRepoId(profile.key)) ?? (await upsertRepoProfile(profile));
    const requestedAt = new Date().toISOString();
    const quotaBlock = await githubRateLimitBlockForRefresh({ app, repoId, requestedLayers: ["webhooks"] });
    if (quotaBlock) {
      return sendGithubRateLimitedRefresh(reply, quotaBlock);
    }
    try {
      const retryResult = await retryFailedGitHubWebhookDeliveries({ repoId });
      const requestedLayers: ManualRefreshLayer[] =
        retryResult.retriedDeliveries > 0 ? ["webhooks", "rules", "metrics", "ai_drift", "notifications"] : [];
      const queuedJobs =
        retryResult.retriedDeliveries > 0
          ? await enqueueJobsNow(
              webhookRetryRefreshJobs({
                repoKey: profile.key,
                githubLogin: session.githubLogin,
                requestedAt,
                retriedDeliveries: retryResult.retriedDeliveries
              })
            )
          : [];
      const refreshRequest =
        requestedLayers.length > 0
          ? await recordManualRefreshRequest({
              repoId,
              userId: session.userId,
              githubLogin: session.githubLogin,
              requestedLayers,
              queuedJobs
            })
          : null;
      if (refreshRequest) {
        options.onDashboardMutated?.();
      }

      return {
        retriedDeliveries: retryResult.retriedDeliveries,
        requestId: refreshRequest?.requestId ?? null,
        requestedLayers,
        queuedJobs,
        requestedAt
      };
    } catch (error) {
      app.log.error({ error, githubLogin: session.githubLogin }, "webhook retry queueing failed");
      return reply.status(500).send({
        error: "webhook_retry_failed",
        message: error instanceof Error ? error.message : String(error)
      });
    }
  });
}
