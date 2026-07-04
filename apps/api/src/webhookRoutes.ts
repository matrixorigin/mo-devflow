import type { FastifyInstance } from "fastify";
import { isGitHubWebhookConnectivityEvent, isSupportedGitHubWebhookEvent } from "@mo-devflow/shared";
import { loadRepoProfile } from "@mo-devflow/config";
import {
  enqueueJobsNow,
  recordGitHubWebhookDelivery,
  recordIgnoredGitHubWebhookDelivery,
  upsertRepoProfile
} from "@mo-devflow/db";
import {
  githubWebhookSecretFromEnv,
  isValidGitHubWebhookSignature,
  readGitHubWebhookHeaders,
  safeWebhookHeaders,
  webhookActionFromPayload,
  webhookRepositoryFullNameFromPayload
} from "./githubWebhook";
import { webhookDeliveryRefreshJobs } from "./refreshJobs";

export async function registerWebhookRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/webhooks/github", async (request, reply) => {
    const rawBody = request.rawBody;
    if (typeof rawBody !== "string") {
      return reply.status(500).send({
        error: "raw_body_unavailable",
        message: "Webhook raw body is required for durable ingest and signature validation."
      });
    }

    const headers = readGitHubWebhookHeaders(request);
    if (!headers.deliveryId || !headers.eventName) {
      return reply.status(400).send({
        error: "missing_github_webhook_headers",
        message: "GitHub webhook delivery and event headers are required."
      });
    }

    const secret = githubWebhookSecretFromEnv();
    if (!secret) {
      return reply.status(503).send({
        error: "github_webhook_secret_unconfigured",
        message: "GitHub webhook secret is required before webhook deliveries can be ingested."
      });
    }

    if (
      !isValidGitHubWebhookSignature({
        secret,
        rawBody,
        signatureHeader: headers.signature256
      })
    ) {
      return reply.status(401).send({
        error: "invalid_github_webhook_signature",
        message: "GitHub webhook signature verification failed."
      });
    }

    const payloadRepo = webhookRepositoryFullNameFromPayload(request.body);
    if (!payloadRepo) {
      return reply.status(400).send({
        error: "missing_repository_identity",
        message: "GitHub webhook payload must include repository.full_name."
      });
    }

    const profile = loadRepoProfile();
    const expectedRepo = `${profile.repo.owner}/${profile.repo.name}`;
    const repoId = await upsertRepoProfile(profile);
    if (payloadRepo !== expectedRepo) {
      const result = await recordIgnoredGitHubWebhookDelivery({
        repoId,
        deliveryId: headers.deliveryId,
        eventName: headers.eventName,
        action: webhookActionFromPayload(request.body),
        signature256: headers.signature256,
        headers: safeWebhookHeaders(request.headers),
        payload: request.body,
        rawPayload: rawBody,
        ignoredReason: "repository_mismatch"
      });
      return reply.status(result.duplicate ? 200 : 202).send({
        accepted: false,
        duplicate: result.duplicate,
        ignored: true,
        deliveryId: headers.deliveryId,
        eventName: headers.eventName,
        reason: "repository_mismatch"
      });
    }

    if (isGitHubWebhookConnectivityEvent(headers.eventName)) {
      const result = await recordIgnoredGitHubWebhookDelivery({
        repoId,
        deliveryId: headers.deliveryId,
        eventName: headers.eventName,
        action: webhookActionFromPayload(request.body),
        signature256: headers.signature256,
        headers: safeWebhookHeaders(request.headers),
        payload: request.body,
        rawPayload: rawBody,
        ignoredReason: "connectivity_probe"
      });
      return reply.status(result.duplicate ? 200 : 202).send({
        accepted: !result.duplicate,
        duplicate: result.duplicate,
        ignored: true,
        deliveryId: headers.deliveryId,
        eventName: headers.eventName,
        reason: "connectivity_probe"
      });
    }

    if (!isSupportedGitHubWebhookEvent(headers.eventName)) {
      const result = await recordIgnoredGitHubWebhookDelivery({
        repoId,
        deliveryId: headers.deliveryId,
        eventName: headers.eventName,
        action: webhookActionFromPayload(request.body),
        signature256: headers.signature256,
        headers: safeWebhookHeaders(request.headers),
        payload: request.body,
        rawPayload: rawBody,
        ignoredReason: "unsupported_event"
      });
      return reply.status(result.duplicate ? 200 : 202).send({
        accepted: false,
        duplicate: result.duplicate,
        ignored: true,
        deliveryId: headers.deliveryId,
        eventName: headers.eventName,
        reason: "unsupported_event"
      });
    }

    const action = webhookActionFromPayload(request.body);
    const result = await recordGitHubWebhookDelivery({
      repoId,
      deliveryId: headers.deliveryId,
      eventName: headers.eventName,
      action,
      signature256: headers.signature256,
      headers: safeWebhookHeaders(request.headers),
      payload: request.body,
      rawPayload: rawBody
    });
    let refreshQueued = false;
    if (!result.duplicate) {
      try {
        await enqueueJobsNow(
          webhookDeliveryRefreshJobs({
            repoKey: profile.key,
            deliveryId: headers.deliveryId,
            eventName: headers.eventName,
            action,
            receivedAt: new Date().toISOString()
          })
        );
        refreshQueued = true;
      } catch (error) {
        request.log.error({ error, deliveryId: headers.deliveryId }, "failed to queue webhook refresh jobs");
      }
    }

    return reply.status(result.duplicate ? 200 : 202).send({
      accepted: !result.duplicate,
      duplicate: result.duplicate,
      deliveryId: result.deliveryId,
      eventName: headers.eventName,
      status: result.status,
      refreshQueued
    });
  });
}
