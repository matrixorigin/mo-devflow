import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { loadRepoProfile } from "@mo-devflow/config";
import { sendWeComMarkdown } from "@mo-devflow/notifications";
import type { NotificationAcknowledgementView, NotificationRetryRequestView } from "@mo-devflow/shared";
import {
  acknowledgeNotificationDelivery,
  enqueueJobsNow,
  getRepoId,
  recordProductWriteActionExecution,
  requestNotificationDeliveryRetry,
  upsertRepoProfile
} from "@mo-devflow/db";
import { getSessionRecordFromRequest } from "./authRoutes";
import { hasValidCsrfToken, sendCsrfRequired } from "./csrf";
import { jobKeyForLayer } from "./refreshJobs";
import { FixedWindowRateLimiter, notificationActionRateLimitConfigFromEnv } from "./rateLimit";

const acknowledgeParamsSchema = z.object({
  deliveryId: z.coerce.number().int().positive()
});

interface NotificationRouteOptions {
  notificationActionRateLimiter?: FixedWindowRateLimiter;
}

function notificationRateLimitKey(request: FastifyRequest, userId: number, action: "test" | "retry"): string {
  return `notification-${action}:${userId}:${request.ip || "unknown"}`;
}

function sendNotificationRateLimited(reply: FastifyReply, retryAfterSeconds: number) {
  reply.header("retry-after", String(retryAfterSeconds));
  return reply.status(429).send({
    error: "notification_action_rate_limited",
    message: "Too many notification actions. Retry later.",
    retryAfterSeconds
  });
}

export async function registerNotificationRoutes(
  app: FastifyInstance,
  options: NotificationRouteOptions = {}
): Promise<void> {
  const notificationActionRateLimiter =
    options.notificationActionRateLimiter ?? new FixedWindowRateLimiter(notificationActionRateLimitConfigFromEnv());

  app.post("/api/notifications/test", async (request, reply) => {
    const session = await getSessionRecordFromRequest(request, reply);
    if (!session) {
      return reply.status(401).send({
        error: "login_required",
        message: "Sign in with GitHub before sending notification tests."
      });
    }
    if (!hasValidCsrfToken(request)) {
      return sendCsrfRequired(reply);
    }
    const rateLimit = notificationActionRateLimiter.consume(notificationRateLimitKey(request, session.userId, "test"));
    if (!rateLimit.allowed) {
      return sendNotificationRateLimited(reply, rateLimit.retryAfterSeconds);
    }

    const profile = loadRepoProfile();
    const repoId = (await getRepoId(profile.key)) ?? (await upsertRepoProfile(profile));
    if (!profile.notifications.wecom.enabled) {
      return reply.status(409).send({
        error: "notification_channel_disabled",
        message: "WeCom notifications are disabled in the repository profile."
      });
    }

    const webhookUrlEnv = profile.notifications.wecom.webhookUrlEnv;
    const webhookUrl = webhookUrlEnv ? process.env[webhookUrlEnv] : undefined;
    if (!webhookUrl) {
      return reply.status(409).send({
        error: "notification_webhook_unconfigured",
        message: webhookUrlEnv
          ? `WeCom webhook environment variable ${webhookUrlEnv} is not configured.`
          : "Repository profile does not define a WeCom webhook environment variable."
      });
    }

    const attemptedAt = new Date().toISOString();
    const markdown = [
      "## mo-devflow notification test",
      `> Repo: ${profile.key}`,
      `> Actor: ${session.githubLogin}`,
      `> Time: ${attemptedAt}`,
      "",
      "This message verifies the configured Enterprise WeChat webhook for mo-devflow notifications."
    ].join("\n");

    try {
      const providerResponse = await sendWeComMarkdown(webhookUrl, markdown);
      const auditRecorded = await recordNotificationTestAudit({
        app,
        repoId,
        userId: session.userId,
        githubLogin: session.githubLogin,
        status: "success",
        occurredAt: attemptedAt
      });
      return {
        status: "sent",
        channel: "wecom",
        attemptedAt,
        providerStatus: providerResponse.status,
        auditRecorded
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const auditRecorded = await recordNotificationTestAudit({
        app,
        repoId,
        userId: session.userId,
        githubLogin: session.githubLogin,
        status: "failed",
        errorMessage: message,
        occurredAt: attemptedAt
      });
      return reply.status(502).send({
        error: "notification_test_send_failed",
        message: "WeCom notification test failed.",
        detail: message,
        auditRecorded,
        attemptedAt
      });
    }
  });

  app.post("/api/notifications/deliveries/:deliveryId/retry", async (request, reply) => {
    const session = await getSessionRecordFromRequest(request, reply);
    if (!session) {
      return reply.status(401).send({
        error: "login_required",
        message: "Sign in with GitHub before retrying notifications."
      });
    }
    if (!hasValidCsrfToken(request)) {
      return sendCsrfRequired(reply);
    }

    const parsed = acknowledgeParamsSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(422).send({
        error: "invalid_notification_retry_input",
        message: "Notification delivery id is invalid."
      });
    }
    const rateLimit = notificationActionRateLimiter.consume(notificationRateLimitKey(request, session.userId, "retry"));
    if (!rateLimit.allowed) {
      return sendNotificationRateLimited(reply, rateLimit.retryAfterSeconds);
    }

    const profile = loadRepoProfile();
    const repoId = (await getRepoId(profile.key)) ?? (await upsertRepoProfile(profile));
    const retryRequest = await requestNotificationDeliveryRetry({
      repoId,
      deliveryId: parsed.data.deliveryId,
      githubLogin: session.githubLogin,
      profile,
      viewer: { authenticated: true, userId: session.userId }
    });

    if (retryRequest.outcome === "not_found") {
      return reply.status(404).send({
        error: "notification_delivery_not_found",
        message: "Notification delivery was not found in this repository."
      });
    }

    if (retryRequest.outcome === "not_retryable") {
      return reply.status(409).send({
        error: "notification_delivery_not_retryable",
        message: `Notification delivery status ${retryRequest.deliveryStatus} cannot be retried.`,
        deliveryStatus: retryRequest.deliveryStatus
      });
    }

    if (retryRequest.outcome === "source_resolved") {
      return reply.status(409).send({
        error: "notification_source_resolved",
        message: "The underlying notification source is no longer active; refresh the dashboard instead of retrying.",
        deliveryStatus: retryRequest.deliveryStatus
      });
    }

    try {
      const requestedAt = new Date().toISOString();
      const queuedJobs = await enqueueJobsNow([
        {
          jobKey: jobKeyForLayer("notifications", profile.key),
          jobType: "notifications",
          payload: {
            requestedBy: session.githubLogin,
            requestedAt,
            trigger: "notification_retry",
            deliveryId: retryRequest.deliveryId,
            retryDeliveryId: retryRequest.retryDeliveryId,
            dedupeKey: retryRequest.dedupeKey
          }
        }
      ]);
      await recordProductWriteActionExecution({
        repoId,
        userId: session.userId,
        githubLogin: session.githubLogin,
        actionKey: "retry_notification",
        objectType: "notification_delivery",
        objectNumber: retryRequest.retryDeliveryId,
        status: "success"
      });
      return {
        deliveryId: retryRequest.deliveryId,
        retryDeliveryId: retryRequest.retryDeliveryId,
        deliveryStatus: retryRequest.deliveryStatus,
        requestedAt,
        queuedJobs: queuedJobs.map((job) => ({
          jobKey: job.jobKey,
          jobType: "notifications",
          status: job.status,
          nextRunAt: job.nextRunAt
        }))
      } satisfies NotificationRetryRequestView;
    } catch (error) {
      app.log.error({ error, deliveryId: retryRequest.deliveryId }, "notification retry processing failed");
      return reply.status(500).send({
        error: "notification_retry_processing_failed",
        message: error instanceof Error ? error.message : String(error)
      });
    }
  });

  app.post("/api/notifications/deliveries/:deliveryId/acknowledge", async (request, reply) => {
    const session = await getSessionRecordFromRequest(request, reply);
    if (!session) {
      return reply.status(401).send({
        error: "login_required",
        message: "Sign in with GitHub before acknowledging notifications."
      });
    }
    if (!hasValidCsrfToken(request)) {
      return sendCsrfRequired(reply);
    }

    const parsed = acknowledgeParamsSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(422).send({
        error: "invalid_notification_acknowledgement_input",
        message: "Notification delivery id is invalid."
      });
    }

    const profile = loadRepoProfile();
    const repoId = (await getRepoId(profile.key)) ?? (await upsertRepoProfile(profile));
    const acknowledgement = await acknowledgeNotificationDelivery({
      repoId,
      deliveryId: parsed.data.deliveryId,
      userId: session.userId,
      githubLogin: session.githubLogin,
      profile,
      viewer: { authenticated: true, userId: session.userId }
    });

    if (acknowledgement.outcome === "not_found") {
      return reply.status(404).send({
        error: "notification_delivery_not_found",
        message: "Notification delivery was not found in this repository."
      });
    }

    if (acknowledgement.outcome === "not_acknowledgeable") {
      return reply.status(409).send({
        error: "notification_delivery_not_acknowledgeable",
        message: `Notification delivery status ${acknowledgement.deliveryStatus} does not require acknowledgement.`,
        deliveryStatus: acknowledgement.deliveryStatus
      });
    }

    if (acknowledgement.outcome === "source_resolved") {
      return reply.status(409).send({
        error: "notification_source_resolved",
        message:
          "The underlying notification source is no longer active; refresh the dashboard instead of acknowledging.",
        deliveryStatus: acknowledgement.deliveryStatus
      });
    }

    await recordProductWriteActionExecution({
      repoId,
      userId: session.userId,
      githubLogin: session.githubLogin,
      actionKey: "acknowledge_notification",
      objectType: "notification_delivery",
      objectNumber: acknowledgement.deliveryId,
      status: "success",
      occurredAt: acknowledgement.acknowledgedAt
    });

    return {
      deliveryId: acknowledgement.deliveryId,
      acknowledgedAt: acknowledgement.acknowledgedAt,
      acknowledgedBy: acknowledgement.acknowledgedBy
    } satisfies NotificationAcknowledgementView;
  });
}

async function recordNotificationTestAudit(input: {
  app: FastifyInstance;
  repoId: number;
  userId: number;
  githubLogin: string;
  status: "success" | "failed";
  errorMessage?: string | null;
  occurredAt: string;
}): Promise<boolean> {
  try {
    await recordProductWriteActionExecution({
      repoId: input.repoId,
      userId: input.userId,
      githubLogin: input.githubLogin,
      actionKey: "send_test_notification",
      objectType: "notification_probe",
      objectNumber: 0,
      status: input.status,
      errorMessage: input.errorMessage ?? null,
      occurredAt: input.occurredAt
    });
    return true;
  } catch (error) {
    input.app.log.error({ error, repoId: input.repoId }, "notification test audit recording failed");
    return false;
  }
}
