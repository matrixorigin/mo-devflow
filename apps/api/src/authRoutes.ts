import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { loadRepoProfile } from "@mo-devflow/config";
import {
  createUserSession,
  getActiveSession,
  listConnectedGitHubUsers,
  revokeGitHubTokenForUser,
  revokeSession,
  toAuthenticatedUserView,
  upsertGitHubTokenBinding,
  type SessionRecord
} from "@mo-devflow/db";
import { classifyGitHubError, fetchIssueWritePermission, validateGitHubToken } from "@mo-devflow/github";
import type { GitHubRepoPermission, RepoProfile, SessionView } from "@mo-devflow/shared";
import { createSessionToken, encryptSecret, hashSessionToken, tokenEncryptionConfigFromEnv } from "./authCrypto";
import {
  buildClearCsrfCookie,
  buildCsrfCookie,
  buildCsrfCookieForSession,
  createCsrfToken,
  hasValidCsrfToken,
  sendCsrfRequired
} from "./csrf";
import {
  buildClearSessionCookie,
  buildSessionCookie,
  cookieSecureFromEnv,
  readCookieValue,
  sessionCookieName
} from "./sessionCookie";
import { clientRateLimitKey, FixedWindowRateLimiter, tokenBindRateLimitConfigFromEnv } from "./rateLimit";

const bindGitHubTokenSchema = z.object({
  token: z.string().trim().min(20).max(512)
});

function sessionTtlDaysFromEnv(): number {
  const parsed = Number(process.env.MO_DEVFLOW_SESSION_TTL_DAYS ?? "14");
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 14;
  }
  return Math.min(90, Math.floor(parsed));
}

function anonymousSession(): SessionView {
  return {
    authenticated: false,
    user: null,
    connectedUsers: [],
    tokenEncryptionConfigured: isTokenEncryptionConfigured()
  };
}

function isTokenEncryptionConfigured(): boolean {
  try {
    return tokenEncryptionConfigFromEnv() !== null;
  } catch {
    return false;
  }
}

async function sessionFromRequest(request: FastifyRequest, reply?: FastifyReply): Promise<SessionView> {
  const session = await getSessionRecordFromRequest(request, reply);
  if (!session) {
    return anonymousSession();
  }
  if (reply) {
    reply.header(
      "set-cookie",
      buildCsrfCookieForSession(request, new Date(session.sessionExpiresAt), cookieSecureFromEnv())
    );
  }
  const profile = loadRepoProfile();
  const connectedUsers = await listConnectedGitHubUsers({ currentUserId: session.userId });
  return {
    authenticated: true,
    user: toAuthenticatedUserView(session, { writeBackEnabled: profile.access.writeBackEnabled }),
    connectedUsers,
    tokenEncryptionConfigured: isTokenEncryptionConfigured()
  };
}

export async function getSessionRecordFromRequest(
  request: FastifyRequest,
  reply?: FastifyReply
): Promise<SessionRecord | null> {
  const sessionToken = readCookieValue(request.headers.cookie, sessionCookieName);
  if (!sessionToken) {
    return null;
  }
  const session = await getActiveSession(hashSessionToken(sessionToken));
  if (!session) {
    if (reply) {
      const secureCookie = cookieSecureFromEnv();
      reply.header("set-cookie", [buildClearSessionCookie(secureCookie), buildClearCsrfCookie(secureCookie)]);
    }
    return null;
  }
  return session;
}

function githubTokenErrorStatus(error: unknown): number | null {
  const status = (error as { status?: number })?.status;
  return typeof status === "number" ? status : null;
}

async function resolveTokenRepoPermission(input: {
  token: string;
  profile: RepoProfile;
}): Promise<
  | { permission: GitHubRepoPermission }
  | { failure: "rejected" | "rate_limited" | "unavailable"; retryAfterSeconds: number | null }
> {
  try {
    const permission = await fetchIssueWritePermission(input);
    return { permission: permission.permission };
  } catch (error) {
    const classified = classifyGitHubError(error);
    if ((classified.kind === "permission" && classified.status === 403) || classified.kind === "not_found") {
      return { permission: "none" };
    }
    if (classified.kind === "permission" && classified.status === 401) {
      return { failure: "rejected", retryAfterSeconds: null };
    }
    if (classified.kind === "rate_limited") {
      return { failure: "rate_limited", retryAfterSeconds: classified.retryAfterSeconds };
    }
    return { failure: "unavailable", retryAfterSeconds: classified.retryAfterSeconds };
  }
}

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  const tokenBindRateLimiter = new FixedWindowRateLimiter(tokenBindRateLimitConfigFromEnv());

  app.get("/api/session", async (request, reply) => sessionFromRequest(request, reply));

  app.post("/api/session/github-token", async (request, reply) => {
    const rateLimit = tokenBindRateLimiter.consume(clientRateLimitKey(request, "github-token-bind"));
    if (!rateLimit.allowed) {
      reply.header("retry-after", String(rateLimit.retryAfterSeconds));
      return reply.status(429).send({
        error: "github_token_bind_rate_limited",
        message: "Too many GitHub token connection attempts. Retry later.",
        retryAfterSeconds: rateLimit.retryAfterSeconds
      });
    }

    const parsed = bindGitHubTokenSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(422).send({
        error: "invalid_github_token_input",
        message: "GitHub token is required."
      });
    }

    let encryptionConfig;
    try {
      encryptionConfig = tokenEncryptionConfigFromEnv();
    } catch {
      return reply.status(503).send({
        error: "token_encryption_invalid",
        message: "Token encryption key is invalid on the API server."
      });
    }
    if (!encryptionConfig) {
      return reply.status(503).send({
        error: "token_encryption_not_configured",
        message: "Token encryption key is not configured on the API server."
      });
    }

    let validation;
    try {
      validation = await validateGitHubToken(parsed.data.token);
    } catch (error) {
      const status = githubTokenErrorStatus(error);
      return reply.status(status === 401 || status === 403 ? 401 : 502).send({
        error: status === 401 || status === 403 ? "github_token_rejected" : "github_token_validation_failed",
        message: status === 401 || status === 403 ? "GitHub rejected the token." : "GitHub token validation failed."
      });
    }

    const profile = loadRepoProfile();
    const repoPermissionResult = await resolveTokenRepoPermission({ token: parsed.data.token, profile });
    if ("failure" in repoPermissionResult) {
      if (repoPermissionResult.retryAfterSeconds) {
        reply.header("retry-after", String(repoPermissionResult.retryAfterSeconds));
      }
      const rejected = repoPermissionResult.failure === "rejected";
      const rateLimited = repoPermissionResult.failure === "rate_limited";
      return reply.status(rejected ? 401 : rateLimited ? 429 : 502).send({
        error: rejected
          ? "github_token_rejected"
          : rateLimited
            ? "github_repo_permission_check_rate_limited"
            : "github_repo_permission_check_failed",
        message: rejected
          ? "GitHub rejected the token."
          : rateLimited
            ? "GitHub rate limited the repository permission check. Retry later."
            : "GitHub repository permission check failed.",
        retryAfterSeconds: repoPermissionResult.retryAfterSeconds ?? undefined
      });
    }

    const encryptedToken = encryptSecret(parsed.data.token, encryptionConfig);
    const validatedAt = new Date().toISOString();
    const userId = await upsertGitHubTokenBinding({
      githubId: validation.githubId,
      githubLogin: validation.githubLogin,
      avatarUrl: validation.avatarUrl,
      encryptedToken: encryptedToken.ciphertext,
      tokenIv: encryptedToken.iv,
      tokenAuthTag: encryptedToken.authTag,
      keyVersion: encryptedToken.keyVersion,
      scopes: validation.scopes,
      repoPermission: repoPermissionResult.permission,
      lastValidatedAt: validatedAt
    });

    const sessionToken = createSessionToken();
    const expiresAt = new Date(Date.now() + sessionTtlDaysFromEnv() * 24 * 3_600_000);
    await createUserSession({
      userId,
      sessionHash: hashSessionToken(sessionToken),
      expiresAt: expiresAt.toISOString()
    });
    const connectedUsers = await listConnectedGitHubUsers({ currentUserId: userId });
    const secureCookie = cookieSecureFromEnv();
    reply.header("set-cookie", [
      buildSessionCookie(sessionToken, expiresAt, secureCookie),
      buildCsrfCookie(createCsrfToken(), expiresAt, secureCookie)
    ]);
    return {
      authenticated: true,
      user: toAuthenticatedUserView(
        {
          userId,
          githubLogin: validation.githubLogin,
          githubId: validation.githubId,
          avatarUrl: validation.avatarUrl,
          tokenScopes: validation.scopes,
          tokenRepoPermission: repoPermissionResult.permission,
          tokenLastValidatedAt: validatedAt,
          sessionExpiresAt: expiresAt.toISOString()
        },
        { writeBackEnabled: profile.access.writeBackEnabled }
      ),
      connectedUsers,
      tokenEncryptionConfigured: true
    } satisfies SessionView;
  });

  app.delete("/api/session/github-token", async (request, reply) => {
    const session = await getSessionRecordFromRequest(request, reply);
    if (!session) {
      return reply.status(401).send({
        error: "login_required",
        message: "Sign in before removing a saved GitHub token."
      });
    }
    if (!hasValidCsrfToken(request)) {
      return sendCsrfRequired(reply);
    }

    await revokeGitHubTokenForUser(session.userId);
    const profile = loadRepoProfile();
    const connectedUsers = await listConnectedGitHubUsers({ currentUserId: session.userId });
    return {
      authenticated: true,
      user: toAuthenticatedUserView(
        {
          ...session,
          tokenScopes: [],
          tokenRepoPermission: "none",
          tokenLastValidatedAt: null
        },
        { writeBackEnabled: profile.access.writeBackEnabled }
      ),
      connectedUsers,
      tokenEncryptionConfigured: isTokenEncryptionConfigured()
    } satisfies SessionView;
  });

  app.delete("/api/session", async (request, reply) => {
    const secureCookie = cookieSecureFromEnv();
    const sessionToken = readCookieValue(request.headers.cookie, sessionCookieName);
    const session = sessionToken ? await getSessionRecordFromRequest(request, reply) : null;
    if (session && !hasValidCsrfToken(request)) {
      return sendCsrfRequired(reply);
    }
    if (sessionToken) {
      await revokeSession(hashSessionToken(sessionToken));
    }
    reply.header("set-cookie", [buildClearSessionCookie(secureCookie), buildClearCsrfCookie(secureCookie)]);
    return anonymousSession();
  });
}
