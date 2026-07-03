import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { loadRepoProfile } from "@mo-devflow/config";
import {
  getActiveWorkflowViolation,
  getCachedIssueByNumber,
  getRepoId,
  recordWorkflowFixPreview,
  upsertRepoProfile
} from "@mo-devflow/db";
import { buildWorkflowFixPreview } from "@mo-devflow/rules";
import { getSessionRecordFromRequest } from "./authRoutes";

const workflowFixPreviewSchema = z.object({
  actionKey: z.literal("add_needs_triage"),
  objectType: z.literal("issue"),
  objectNumber: z.number().int().positive(),
  ruleKey: z.string().min(1).max(128)
});

function previewTtlMinutesFromEnv(): number {
  const parsed = Number(process.env.MO_DEVFLOW_ACTION_PREVIEW_TTL_MINUTES ?? "10");
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 10;
  }
  return Math.min(60, Math.floor(parsed));
}

export async function registerActionRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/actions/workflow-fix/preview", async (request, reply) => {
    const session = await getSessionRecordFromRequest(request, reply);
    if (!session) {
      return reply.status(401).send({
        error: "login_required",
        message: "Connect a GitHub token before previewing workflow fixes."
      });
    }

    const parsed = workflowFixPreviewSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(422).send({
        error: "invalid_workflow_fix_preview_input",
        message: "Workflow fix preview input is invalid."
      });
    }

    const profile = loadRepoProfile();
    const repoId = (await getRepoId(profile.key)) ?? (await upsertRepoProfile(profile));
    const violation = await getActiveWorkflowViolation({
      repoId,
      objectType: parsed.data.objectType,
      objectNumber: parsed.data.objectNumber,
      ruleKey: parsed.data.ruleKey
    });
    if (!violation) {
      return reply.status(404).send({
        error: "workflow_violation_not_found",
        message: "No active workflow violation exists for the requested object."
      });
    }
    if (!violation.fixable) {
      return reply.status(409).send({
        error: "workflow_violation_not_fixable",
        message: "This workflow violation is not marked as fixable."
      });
    }

    const issue = await getCachedIssueByNumber(repoId, parsed.data.objectNumber);
    if (!issue) {
      return reply.status(404).send({
        error: "cached_issue_not_found",
        message: "The issue is not present in the local cache."
      });
    }

    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + previewTtlMinutesFromEnv() * 60_000);
    const preview = buildWorkflowFixPreview({
      profile,
      issue,
      violation,
      actionKey: parsed.data.actionKey,
      previewId: randomUUID(),
      createdAt: createdAt.toISOString(),
      expiresAt: expiresAt.toISOString()
    });

    await recordWorkflowFixPreview({
      repoId,
      userId: session.userId,
      githubLogin: session.githubLogin,
      preview
    });
    return preview;
  });
}
