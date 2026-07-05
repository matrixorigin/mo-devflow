import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { loadRepoProfile } from "@mo-devflow/config";
import {
  enqueueJobsNow,
  getRepoId,
  recordManualRefreshRequest,
  retryFailedGitHubWebhookDeliveries,
  upsertRepoProfile
} from "@mo-devflow/db";
import type { ManualRefreshLayer } from "@mo-devflow/shared";
import { getSessionRecordFromRequest } from "./authRoutes";
import { hasValidCsrfToken, sendCsrfRequired } from "./csrf";
import { jobKeyForLayer, manualRefreshLayers, type RefreshJobSeed, webhookRetryRefreshJobs } from "./refreshJobs";

const manualRefreshSchema = z.object({
  layers: z.array(z.enum(manualRefreshLayers)).min(1).max(manualRefreshLayers.length).optional()
});

interface RefreshRouteOptions {
  onDashboardMutated?: () => void;
}

function uniqueLayers(layers: ManualRefreshLayer[] | undefined): ManualRefreshLayer[] {
  const selected = layers && layers.length > 0 ? layers : [...manualRefreshLayers];
  return selected.filter((layer, index) => selected.indexOf(layer) === index);
}

export async function registerRefreshRoutes(app: FastifyInstance, options: RefreshRouteOptions = {}): Promise<void> {
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

    const profile = loadRepoProfile();
    const repoId = (await getRepoId(profile.key)) ?? (await upsertRepoProfile(profile));
    const requestedAt = new Date().toISOString();
    const requestedLayers = uniqueLayers(parsed.data.layers);
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

    const profile = loadRepoProfile();
    const repoId = (await getRepoId(profile.key)) ?? (await upsertRepoProfile(profile));
    const requestedAt = new Date().toISOString();
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
