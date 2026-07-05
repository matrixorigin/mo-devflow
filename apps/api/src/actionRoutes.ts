import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { loadRepoProfile } from "@mo-devflow/config";
import {
  enqueueJobsNow,
  getActiveGitHubTokenForUser,
  getActiveWorkflowViolation,
  getCachedIssueByNumber,
  getRepoId,
  getWorkflowFixPreviewForUser,
  markWorkflowFixPreviewStatus,
  recordWorkflowFixExecution,
  recordWorkflowFixPreview,
  revokeGitHubTokenForUser,
  upsertRepoProfile
} from "@mo-devflow/db";
import { applyWorkflowFixPreview, fetchIssueFreshState, fetchIssueWritePermission } from "@mo-devflow/github";
import { buildWorkflowFixPreview } from "@mo-devflow/rules";
import { buildGitHubWriteCapabilities } from "@mo-devflow/shared";
import type {
  WorkflowFixExecutionResult,
  WorkflowFixExecutionStatus,
  WorkflowFixPostWriteRefresh,
  WorkflowFixPreview,
  WorkflowFixStateSnapshot
} from "@mo-devflow/shared";
import { decryptSecret, tokenEncryptionConfigFromEnv } from "./authCrypto";
import { getSessionRecordFromRequest } from "./authRoutes";
import { hasValidCsrfToken, sendCsrfRequired } from "./csrf";
import { githubTokenFailureForWorkflowRead } from "./githubTokenFailures";
import { workflowWriteRefreshJobs } from "./refreshJobs";

const workflowFixPreviewSchema = z.object({
  actionKey: z.enum(["add_needs_triage", "move_to_deferred"]),
  objectType: z.literal("issue"),
  objectNumber: z.number().int().positive(),
  ruleKey: z.string().min(1).max(128)
});

const workflowFixConfirmSchema = z.object({
  previewId: z.string().uuid()
});

interface ActionRouteOptions {
  onDashboardMutated?: () => void;
}

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
  beforeState?: WorkflowFixStateSnapshot | null;
  afterState?: WorkflowFixStateSnapshot | null;
  message: string;
  errorMessage?: string | null;
  postWriteRefresh?: WorkflowFixPostWriteRefresh | null;
}): WorkflowFixExecutionResult {
  return {
    previewId: input.previewId,
    status: input.status,
    executedOperations: input.executedOperations ?? [],
    beforeState: input.beforeState ?? null,
    afterState: input.afterState ?? null,
    message: input.message,
    errorMessage: input.errorMessage ?? null,
    postWriteRefresh: input.postWriteRefresh ?? null,
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
  onDashboardMutated?: () => void;
}): Promise<WorkflowFixExecutionResult> {
  await markWorkflowFixPreviewStatus({
    previewId: input.preview.previewId,
    userId: input.userId,
    status: input.result.status
  });
  await recordWorkflowFixExecution(input);
  input.onDashboardMutated?.();
  return input.result;
}

export async function registerActionRoutes(app: FastifyInstance, options: ActionRouteOptions = {}): Promise<void> {
  const persistRouteExecution = (input: Omit<Parameters<typeof persistExecution>[0], "onDashboardMutated">) =>
    persistExecution({ ...input, onDashboardMutated: options.onDashboardMutated });

  app.post("/api/actions/workflow-fix/preview", async (request, reply) => {
    const session = await getSessionRecordFromRequest(request, reply);
    if (!session) {
      return reply.status(401).send({
        error: "login_required",
        message: "Connect a personal GitHub token before previewing workflow fixes."
      });
    }
    if (!hasValidCsrfToken(request)) {
      return sendCsrfRequired(reply);
    }

    const parsed = workflowFixPreviewSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(422).send({
        error: "invalid_workflow_fix_preview_input",
        message: "Workflow fix preview input is invalid."
      });
    }

    const profile = loadRepoProfile();
    const capability = buildGitHubWriteCapabilities({
      writeBackEnabled: profile.access.writeBackEnabled,
      tokenScopes: session.tokenScopes,
      repoPermission: session.tokenRepoPermission,
      tokenLastValidatedAt: session.tokenLastValidatedAt
    }).issueLabels;
    if (!capability.enabled) {
      return reply.status(403).send({
        error: "write_capability_unavailable",
        message: capability.message,
        capability
      });
    }

    const repoId = (await getRepoId(profile.key)) ?? (await upsertRepoProfile(profile));
    const viewer = { authenticated: true, userId: session.userId };
    const violation = await getActiveWorkflowViolation({
      repoId,
      objectType: parsed.data.objectType,
      objectNumber: parsed.data.objectNumber,
      ruleKey: parsed.data.ruleKey,
      profile,
      viewer
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

    const issue = await getCachedIssueByNumber({
      repoId,
      issueNumber: parsed.data.objectNumber,
      profile,
      viewer
    });
    if (!issue) {
      return reply.status(404).send({
        error: "cached_issue_not_found",
        message: "The issue is not present in the local cache."
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
      return reply.status(403).send({
        error: "write_capability_unavailable",
        message: "A usable GitHub token is not available for this session."
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
    } catch {
      return reply.status(403).send({
        error: "write_capability_unavailable",
        message: "Stored GitHub token could not be decrypted. Reconnect the token before previewing workflow fixes."
      });
    }

    try {
      const issueWritePermission = await fetchIssueWritePermission({ token, profile });
      if (!issueWritePermission.allowed) {
        return reply.status(403).send({
          error: "write_permission_unavailable",
          message: issueWritePermission.message,
          permission: issueWritePermission.permission
        });
      }
    } catch (error) {
      const failure = githubTokenFailureForWorkflowRead(error);
      if (failure) {
        if (failure.shouldRevokeToken) {
          await revokeGitHubTokenForUser(session.userId);
        }
        return reply.status(failure.statusCode).send({
          error: failure.error,
          message: failure.message
        });
      }
      app.log.error({ error, repoKey: profile.key }, "workflow fix repository permission check failed");
      return reply.status(502).send({
        error: "github_permission_check_failed",
        message: "GitHub repository permission check failed. Try again after GitHub connectivity recovers."
      });
    }

    let freshIssue = issue;
    try {
      const freshState = await fetchIssueFreshState({
        token,
        profile,
        issueNumber: parsed.data.objectNumber
      });
      freshIssue = {
        ...issue,
        state: freshState.state,
        labels: freshState.labels,
        updatedAt: freshState.updatedAt,
        isComplete: true
      };
    } catch (error) {
      const failure = githubTokenFailureForWorkflowRead(error);
      if (failure) {
        if (failure.shouldRevokeToken) {
          await revokeGitHubTokenForUser(session.userId);
        }
        return reply.status(failure.statusCode).send({
          error: failure.error,
          message: failure.message
        });
      }
      app.log.error({ error, issueNumber: parsed.data.objectNumber }, "workflow fix fresh state check failed");
      return reply.status(502).send({
        error: "github_fresh_check_failed",
        message: "GitHub fresh state check failed. Try again after GitHub connectivity recovers."
      });
    }

    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + previewTtlMinutesFromEnv() * 60_000);
    const preview = buildWorkflowFixPreview({
      profile,
      issue: freshIssue,
      violation,
      actionKey: parsed.data.actionKey,
      previewId: randomUUID(),
      createdAt: createdAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      stateSource: "github"
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
        message: "Connect a personal GitHub token before confirming workflow fixes."
      });
    }
    if (!hasValidCsrfToken(request)) {
      return sendCsrfRequired(reply);
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
      return persistRouteExecution({
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
      return persistRouteExecution({
        repoId: storedPreview.repoId,
        userId: session.userId,
        githubLogin: session.githubLogin,
        preview,
        result
      });
    }

    const profile = loadRepoProfile();
    const capability = buildGitHubWriteCapabilities({
      writeBackEnabled: profile.access.writeBackEnabled,
      tokenScopes: session.tokenScopes,
      repoPermission: session.tokenRepoPermission,
      tokenLastValidatedAt: session.tokenLastValidatedAt
    }).issueLabels;
    if (!capability.enabled) {
      const result = executionResult({
        previewId: preview.previewId,
        status: "blocked",
        message: capability.message
      });
      return persistRouteExecution({
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
      return persistRouteExecution({
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
      return persistRouteExecution({
        repoId: storedPreview.repoId,
        userId: session.userId,
        githubLogin: session.githubLogin,
        preview,
        result
      });
    }
    try {
      const issueWritePermission = await fetchIssueWritePermission({ token, profile });
      if (!issueWritePermission.allowed) {
        const result = executionResult({
          previewId: preview.previewId,
          status: "blocked",
          message: issueWritePermission.message
        });
        return persistRouteExecution({
          repoId: storedPreview.repoId,
          userId: session.userId,
          githubLogin: session.githubLogin,
          preview,
          result
        });
      }

      const applied = await applyWorkflowFixPreview({ token, profile, preview });
      const stale = applied.appliedOperations.length === 0;
      const result = executionResult({
        previewId: preview.previewId,
        status: stale ? "stale_preview" : "success",
        executedOperations: applied.appliedOperations,
        beforeState: applied.beforeState,
        afterState: applied.afterState,
        message: stale
          ? "GitHub state changed since preview; no operation was executed."
          : "Workflow fix executed with the connected personal GitHub token."
      });
      const persisted = await persistRouteExecution({
        repoId: storedPreview.repoId,
        userId: session.userId,
        githubLogin: session.githubLogin,
        preview,
        result,
        githubResponse: applied.response
      });
      if (!stale) {
        const refreshJobs = workflowWriteRefreshJobs({
          repoKey: profile.key,
          githubLogin: session.githubLogin,
          requestedAt: persisted.executedAt,
          previewId: preview.previewId,
          actionKey: preview.actionKey,
          objectType: preview.objectType,
          objectNumber: preview.objectNumber
        });
        const layers = refreshJobs.map((job) => job.jobType);
        try {
          const queuedJobs = await enqueueJobsNow(refreshJobs);
          persisted.postWriteRefresh = {
            queued: true,
            layers,
            queuedJobs,
            errorMessage: null
          };
        } catch (error) {
          app.log.error({ error, previewId: preview.previewId }, "post-write refresh queueing failed");
          persisted.postWriteRefresh = {
            queued: false,
            layers,
            queuedJobs: [],
            errorMessage:
              "Workflow fix executed, but post-write refresh jobs could not be queued. Queue a manual refresh before relying on dashboard freshness."
          };
        }
      }
      return persisted;
    } catch (error) {
      const failure = githubTokenFailureForWorkflowRead(error);
      if (failure) {
        if (failure.shouldRevokeToken) {
          await revokeGitHubTokenForUser(session.userId);
        }
        const result = executionResult({
          previewId: preview.previewId,
          status: failure.shouldRevokeToken ? "token_unavailable" : "stale_preview",
          message: failure.message,
          errorMessage: error instanceof Error ? error.message : String(error)
        });
        return persistRouteExecution({
          repoId: storedPreview.repoId,
          userId: session.userId,
          githubLogin: session.githubLogin,
          preview,
          result
        });
      }
      const result = executionResult({
        previewId: preview.previewId,
        status: "failed",
        message: "GitHub rejected or failed the workflow fix execution.",
        errorMessage: error instanceof Error ? error.message : String(error)
      });
      return persistRouteExecution({
        repoId: storedPreview.repoId,
        userId: session.userId,
        githubLogin: session.githubLogin,
        preview,
        result
      });
    }
  });
}
