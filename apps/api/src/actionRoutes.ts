import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { loadRepoProfile } from "@mo-devflow/config";
import {
  getActiveGitHubTokenForUser,
  getActiveWorkflowViolation,
  getCachedIssueByNumber,
  getRepoId,
  getWorkflowFixPreviewForUser,
  markWorkflowFixPreviewStatus,
  recordWorkflowFixExecution,
  recordWorkflowFixPreview,
  upsertRepoProfile
} from "@mo-devflow/db";
import { applyWorkflowFixPreview } from "@mo-devflow/github";
import { buildWorkflowFixPreview } from "@mo-devflow/rules";
import { buildGitHubWriteCapabilities } from "@mo-devflow/shared";
import type { WorkflowFixExecutionResult, WorkflowFixExecutionStatus, WorkflowFixPreview } from "@mo-devflow/shared";
import { decryptSecret, tokenEncryptionConfigFromEnv } from "./authCrypto";
import { getSessionRecordFromRequest } from "./authRoutes";

const workflowFixPreviewSchema = z.object({
  actionKey: z.literal("add_needs_triage"),
  objectType: z.literal("issue"),
  objectNumber: z.number().int().positive(),
  ruleKey: z.string().min(1).max(128)
});

const workflowFixConfirmSchema = z.object({
  previewId: z.string().uuid()
});

function previewTtlMinutesFromEnv(): number {
  const parsed = Number(process.env.MO_DEVFLOW_ACTION_PREVIEW_TTL_MINUTES ?? "10");
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 10;
  }
  return Math.min(60, Math.floor(parsed));
}

function executionResult(input: {
  previewId: string;
  status: WorkflowFixExecutionStatus;
  executedOperations?: WorkflowFixExecutionResult["executedOperations"];
  message: string;
  errorMessage?: string | null;
}): WorkflowFixExecutionResult {
  return {
    previewId: input.previewId,
    status: input.status,
    executedOperations: input.executedOperations ?? [],
    message: input.message,
    errorMessage: input.errorMessage ?? null,
    executedAt: new Date().toISOString()
  };
}

async function persistExecution(input: {
  repoId: number;
  userId: number;
  githubLogin: string;
  preview: WorkflowFixPreview;
  result: WorkflowFixExecutionResult;
  githubResponse?: unknown;
}): Promise<WorkflowFixExecutionResult> {
  await markWorkflowFixPreviewStatus({
    previewId: input.preview.previewId,
    userId: input.userId,
    status: input.result.status
  });
  await recordWorkflowFixExecution(input);
  return input.result;
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

    const capability = buildGitHubWriteCapabilities({
      tokenScopes: session.tokenScopes,
      tokenLastValidatedAt: session.tokenLastValidatedAt
    }).issueLabels;
    if (!capability.enabled) {
      return reply.status(403).send({
        error: "write_capability_unavailable",
        message: capability.message,
        capability
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

  app.post("/api/actions/workflow-fix/confirm", async (request, reply) => {
    const session = await getSessionRecordFromRequest(request, reply);
    if (!session) {
      return reply.status(401).send({
        error: "login_required",
        message: "Connect a GitHub token before confirming workflow fixes."
      });
    }

    const parsed = workflowFixConfirmSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(422).send({
        error: "invalid_workflow_fix_confirm_input",
        message: "Workflow fix confirm input is invalid."
      });
    }

    const storedPreview = await getWorkflowFixPreviewForUser({
      previewId: parsed.data.previewId,
      userId: session.userId
    });
    if (!storedPreview) {
      return reply.status(404).send({
        error: "workflow_fix_preview_not_found",
        message: "No workflow fix preview exists for this session."
      });
    }
    if (storedPreview.status !== "previewed") {
      return reply.status(409).send({
        error: "workflow_fix_preview_not_confirmable",
        message: `Preview is already ${storedPreview.status}.`
      });
    }

    const preview = storedPreview.preview;
    if (new Date(storedPreview.expiresAt).getTime() <= Date.now()) {
      const result = executionResult({
        previewId: preview.previewId,
        status: "stale_preview",
        message: "Preview has expired. Generate a fresh preview before executing."
      });
      return persistExecution({
        repoId: storedPreview.repoId,
        userId: session.userId,
        githubLogin: session.githubLogin,
        preview,
        result
      });
    }
    if (preview.blockedReason || preview.operations.length === 0) {
      const result = executionResult({
        previewId: preview.previewId,
        status: "blocked",
        message: preview.blockedReason ?? "Preview contains no executable operations."
      });
      return persistExecution({
        repoId: storedPreview.repoId,
        userId: session.userId,
        githubLogin: session.githubLogin,
        preview,
        result
      });
    }

    const storedToken = await getActiveGitHubTokenForUser(session.userId);
    let encryptionConfig;
    try {
      encryptionConfig = tokenEncryptionConfigFromEnv();
    } catch {
      encryptionConfig = null;
    }
    if (!storedToken || !encryptionConfig || storedToken.keyVersion !== encryptionConfig.keyVersion) {
      const result = executionResult({
        previewId: preview.previewId,
        status: "token_unavailable",
        message: "A usable GitHub token is not available for this session."
      });
      return persistExecution({
        repoId: storedPreview.repoId,
        userId: session.userId,
        githubLogin: session.githubLogin,
        preview,
        result
      });
    }

    let token: string;
    try {
      token = decryptSecret(
        {
          ciphertext: storedToken.encryptedToken,
          iv: storedToken.tokenIv,
          authTag: storedToken.tokenAuthTag,
          keyVersion: storedToken.keyVersion
        },
        encryptionConfig.key
      );
    } catch (error) {
      const result = executionResult({
        previewId: preview.previewId,
        status: "token_unavailable",
        message: "Stored GitHub token could not be decrypted.",
        errorMessage: error instanceof Error ? error.message : String(error)
      });
      return persistExecution({
        repoId: storedPreview.repoId,
        userId: session.userId,
        githubLogin: session.githubLogin,
        preview,
        result
      });
    }

    const profile = loadRepoProfile();
    try {
      const applied = await applyWorkflowFixPreview({ token, profile, preview });
      const stale = applied.appliedOperations.length === 0;
      const result = executionResult({
        previewId: preview.previewId,
        status: stale ? "stale_preview" : "success",
        executedOperations: applied.appliedOperations,
        message: stale
          ? "GitHub state changed since preview; no operation was executed."
          : "Workflow fix executed with the connected GitHub token."
      });
      return persistExecution({
        repoId: storedPreview.repoId,
        userId: session.userId,
        githubLogin: session.githubLogin,
        preview,
        result,
        githubResponse: applied.response
      });
    } catch (error) {
      const result = executionResult({
        previewId: preview.previewId,
        status: "failed",
        message: "GitHub rejected or failed the workflow fix execution.",
        errorMessage: error instanceof Error ? error.message : String(error)
      });
      return persistExecution({
        repoId: storedPreview.repoId,
        userId: session.userId,
        githubLogin: session.githubLogin,
        preview,
        result
      });
    }
  });
}
