import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { loadRepoProfile } from "@mo-devflow/config";
import {
  acknowledgeNotificationDelivery,
  getRepoId,
  upsertRepoProfile
} from "@mo-devflow/db";
import { getSessionRecordFromRequest } from "./authRoutes";
import { hasValidCsrfToken, sendCsrfRequired } from "./csrf";

const acknowledgeParamsSchema = z.object({
  deliveryId: z.coerce.number().int().positive()
});

export async function registerNotificationRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/notifications/deliveries/:deliveryId/acknowledge", async (request, reply) => {
    const session = await getSessionRecordFromRequest(request, reply);
    if (!session) {
      return reply.status(401).send({
        error: "login_required",
        message: "Connect a GitHub token before acknowledging notifications."
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

    return {
      deliveryId: acknowledgement.deliveryId,
      acknowledgedAt: acknowledgement.acknowledgedAt,
      acknowledgedBy: acknowledgement.acknowledgedBy
    };
  });
}
