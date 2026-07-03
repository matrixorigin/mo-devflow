import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { loadRepoProfile } from "@mo-devflow/config";
import {
  enqueueJobsNow,
  getRepoId,
  recordManualRefreshRequest,
  upsertRepoProfile,
  type RecurringJobSeed
} from "@mo-devflow/db";
import type { ManualRefreshLayer } from "@mo-devflow/shared";
import { getSessionRecordFromRequest } from "./authRoutes";

const manualRefreshLayers = [
  "github_sync",
  "webhooks",
  "rules",
  "metrics",
  "ai_drift",
  "notifications"
] as const satisfies readonly ManualRefreshLayer[];

const manualRefreshSchema = z.object({
  layers: z.array(z.enum(manualRefreshLayers)).min(1).max(manualRefreshLayers.length).optional()
});

function uniqueLayers(layers: ManualRefreshLayer[] | undefined): ManualRefreshLayer[] {
  const selected = layers && layers.length > 0 ? layers : [...manualRefreshLayers];
  return selected.filter((layer, index) => selected.indexOf(layer) === index);
}

function jobKeyForLayer(layer: ManualRefreshLayer, repoKey: string): string {
  switch (layer) {
    case "github_sync":
      return `github-sync:${repoKey}`;
    case "webhooks":
      return `webhooks:${repoKey}`;
    case "rules":
      return `rules:${repoKey}`;
    case "metrics":
      return `metrics:${repoKey}`;
    case "ai_drift":
      return `ai-drift:${repoKey}`;
    case "notifications":
      return `notifications:${repoKey}`;
  }
}

export async function registerRefreshRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/refresh", async (request, reply) => {
    const session = await getSessionRecordFromRequest(request, reply);
    if (!session) {
      return reply.status(401).send({
        error: "login_required",
        message: "Connect a GitHub token before queueing refresh jobs."
      });
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
    const jobs: Array<RecurringJobSeed & { jobType: ManualRefreshLayer }> = requestedLayers.map((layer) => ({
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
      return await recordManualRefreshRequest({
        repoId,
        userId: session.userId,
        githubLogin: session.githubLogin,
        requestedLayers,
        queuedJobs
      });
    } catch (error) {
      app.log.error({ error, githubLogin: session.githubLogin, requestedLayers }, "manual refresh queueing failed");
      return reply.status(500).send({
        error: "manual_refresh_failed",
        message: error instanceof Error ? error.message : String(error)
      });
    }
  });
}
