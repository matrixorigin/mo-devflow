import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { loadRepoProfile } from "@mo-devflow/config";
import {
  createUserSession,
  getActiveSession,
  getTeamSignInSummary,
  listConnectedGitHubUsers,
  revokeGitHubTokenForUser,
  revokeSession,
  toAuthenticatedUserView,
  upsertGitHubIdentity,
  upsertGitHubTokenBinding,
  type SessionRecord
} from "@mo-devflow/db";
import { classifyGitHubError, fetchIssueWritePermission, validateGitHubToken } from "@mo-devflow/github";
import type { GitHubRepoPermission, RepoProfile, SessionView, TeamSignInSummaryView } from "@mo-devflow/shared";
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

const oauthStateCookieName = "mo_devflow_oauth_state";
const githubOAuthAuthorizeUrl = "https://github.com/login/oauth/authorize";
const githubOAuthTokenUrl = "https://github.com/login/oauth/access_token";
const githubUserApiUrl = "https://api.github.com/user";

function sessionTtlDaysFromEnv(): number {
  const parsed = Number(process.env.MO_DEVFLOW_SESSION_TTL_DAYS ?? "14");
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 14;
  }
  return Math.min(90, Math.floor(parsed));
}

function githubOAuthConfigFromEnv(): { clientId: string; clientSecret: string; redirectUri: string | null } | null {
  const clientId = process.env.MO_DEVFLOW_GITHUB_OAUTH_CLIENT_ID;
  const clientSecret = process.env.MO_DEVFLOW_GITHUB_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return null;
  }
  return {
    clientId,
    clientSecret,
    redirectUri: process.env.MO_DEVFLOW_GITHUB_OAUTH_REDIRECT_URI ?? null
  };
}

function githubOAuthConfigured(): boolean {
  return githubOAuthConfigFromEnv() !== null;
}

function publicBaseUrl(request: FastifyRequest): string {
  const configured = process.env.MO_DEVFLOW_PUBLIC_URL;
  if (configured) {
    return configured.replace(/\/$/, "");
  }
  const proto = String(request.headers["x-forwarded-proto"] ?? "http").split(",")[0]?.trim() || "http";
  const host = request.headers["x-forwarded-host"] ?? request.headers.host ?? "localhost:18081";
  return `${proto}://${String(host).split(",")[0]?.trim()}`;
}

function dashboardRedirectUrlFromEnv(): string {
  const url =
    process.env.MO_DEVFLOW_DASHBOARD_URL?.trim() || `http://localhost:${process.env.MO_DEVFLOW_WEB_PORT ?? "5173"}`;
  return url.replace(/\/$/, "");
}

function githubOAuthRedirectUri(request: FastifyRequest, configuredRedirectUri: string | null): string {
  return configuredRedirectUri ?? `${publicBaseUrl(request)}/api/auth/github/callback`;
}

function buildOAuthStateCookie(state: string, secure: boolean): string {
  return [
    `${oauthStateCookieName}=${encodeURIComponent(state)}`,
    "Path=/api/auth/github",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=600",
    secure ? "Secure" : null
  ]
    .filter((part): part is string => part !== null)
    .join("; ");
}

function buildClearOAuthStateCookie(secure: boolean): string {
  return [
    `${oauthStateCookieName}=`,
    "Path=/api/auth/github",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
    secure ? "Secure" : null
  ]
    .filter((part): part is string => part !== null)
    .join("; ");
}

const emptyTeamSignInSummary: TeamSignInSummaryView = {
  connectedUsers: 0,
  tokenConnectedUsers: 0,
  activeBrowserSessions: 0,
  lastSeenAt: null
};

async function safeTeamSignInSummary(): Promise<TeamSignInSummaryView> {
  try {
    return await getTeamSignInSummary();
  } catch {
    return emptyTeamSignInSummary;
  }
}

async function anonymousSession(): Promise<SessionView> {
  return {
    authenticated: false,
    user: null,
    connectedUsers: [],
    teamSignIn: await safeTeamSignInSummary(),
    tokenEncryptionConfigured: isTokenEncryptionConfigured(),
    githubOAuthConfigured: githubOAuthConfigured()
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
  const [connectedUsers, teamSignIn] = await Promise.all([
    listConnectedGitHubUsers({ currentUserId: session.userId }),
    safeTeamSignInSummary()
  ]);
  return {
    authenticated: true,
    user: toAuthenticatedUserView(session, { writeBackEnabled: profile.access.writeBackEnabled }),
    connectedUsers,
    teamSignIn,
    tokenEncryptionConfigured: isTokenEncryptionConfigured(),
    githubOAuthConfigured: githubOAuthConfigured()
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

async function exchangeGitHubOAuthCode(input: {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}): Promise<string> {
  const response = await fetch(githubOAuthTokenUrl, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json"
    },
    body: JSON.stringify({
      client_id: input.clientId,
      client_secret: input.clientSecret,
      code: input.code,
      redirect_uri: input.redirectUri
    })
  });
  const payload = (await response.json()) as { access_token?: unknown; error?: unknown; error_description?: unknown };
  if (!response.ok || typeof payload.access_token !== "string") {
    throw new Error(
      typeof payload.error_description === "string"
        ? payload.error_description
        : typeof payload.error === "string"
          ? payload.error
          : "GitHub OAuth token exchange failed."
    );
  }
  return payload.access_token;
}

async function fetchGitHubOAuthUser(accessToken: string): Promise<{
  githubId: string;
  githubLogin: string;
  avatarUrl: string | null;
}> {
  const response = await fetch(githubUserApiUrl, {
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${accessToken}`,
      "user-agent": "mo-devflow"
    }
  });
  const payload = (await response.json()) as { id?: unknown; login?: unknown; avatar_url?: unknown };
  if (!response.ok || typeof payload.id !== "number" || typeof payload.login !== "string") {
    throw new Error("GitHub OAuth user lookup failed.");
  }
  return {
    githubId: String(payload.id),
    githubLogin: payload.login,
    avatarUrl: typeof payload.avatar_url === "string" ? payload.avatar_url : null
  };
}

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  const tokenBindRateLimiter = new FixedWindowRateLimiter(tokenBindRateLimitConfigFromEnv());

  app.get("/api/session", async (request, reply) => sessionFromRequest(request, reply));

  app.get("/api/auth/github/start", async (request, reply) => {
    const oauth = githubOAuthConfigFromEnv();
    if (!oauth) {
      return reply.status(503).send({
        error: "github_oauth_not_configured",
        message: "GitHub OAuth sign-in is not configured on the API server."
      });
    }
    const state = createSessionToken();
    const redirectUri = githubOAuthRedirectUri(request, oauth.redirectUri);
    const authorizeUrl = new URL(githubOAuthAuthorizeUrl);
    authorizeUrl.searchParams.set("client_id", oauth.clientId);
    authorizeUrl.searchParams.set("redirect_uri", redirectUri);
    authorizeUrl.searchParams.set("scope", "read:user");
    authorizeUrl.searchParams.set("state", state);
    reply.header("set-cookie", buildOAuthStateCookie(state, cookieSecureFromEnv()));
    return reply.redirect(authorizeUrl.toString());
  });

  app.get("/api/auth/github/callback", async (request, reply) => {
    const oauth = githubOAuthConfigFromEnv();
    if (!oauth) {
      return reply.status(503).send({
        error: "github_oauth_not_configured",
        message: "GitHub OAuth sign-in is not configured on the API server."
      });
    }
    const query = request.query as { code?: unknown; state?: unknown };
    const code = typeof query.code === "string" ? query.code : "";
    const state = typeof query.state === "string" ? query.state : "";
    const expectedState = readCookieValue(request.headers.cookie, oauthStateCookieName);
    const secureCookie = cookieSecureFromEnv();
    if (!code || !state || !expectedState || state !== expectedState) {
      reply.header("set-cookie", buildClearOAuthStateCookie(secureCookie));
      return reply.status(400).send({
        error: "github_oauth_state_invalid",
        message: "GitHub sign-in state is missing or expired. Start sign-in again."
      });
    }

    try {
      const redirectUri = githubOAuthRedirectUri(request, oauth.redirectUri);
      const accessToken = await exchangeGitHubOAuthCode({
        code,
        clientId: oauth.clientId,
        clientSecret: oauth.clientSecret,
        redirectUri
      });
      const identity = await fetchGitHubOAuthUser(accessToken);
      const userId = await upsertGitHubIdentity(identity);
      const sessionToken = createSessionToken();
      const expiresAt = new Date(Date.now() + sessionTtlDaysFromEnv() * 24 * 3_600_000);
      await createUserSession({
        userId,
        sessionHash: hashSessionToken(sessionToken),
        expiresAt: expiresAt.toISOString()
      });
      reply.header("set-cookie", [
        buildSessionCookie(sessionToken, expiresAt, secureCookie),
        buildCsrfCookie(createCsrfToken(), expiresAt, secureCookie),
        buildClearOAuthStateCookie(secureCookie)
      ]);
      return reply.redirect(dashboardRedirectUrlFromEnv());
    } catch {
      reply.header("set-cookie", buildClearOAuthStateCookie(secureCookie));
      return reply.status(502).send({
        error: "github_oauth_failed",
        message: "GitHub OAuth sign-in failed."
      });
    }
  });

  app.post("/api/session/github-token", async (request, reply) => {
    const session = await getSessionRecordFromRequest(request, reply);
    if (!session) {
      return reply.status(401).send({
        error: "login_required",
        message: "Sign in with GitHub before connecting a personal token."
      });
    }
    if (!hasValidCsrfToken(request)) {
      return sendCsrfRequired(reply);
    }
    const rateLimit = tokenBindRateLimiter.consume(clientRateLimitKey(request, "github-token-bind"));
    if (!rateLimit.allowed) {
      reply.header("retry-after", String(rateLimit.retryAfterSeconds));
      return reply.status(429).send({
        error: "github_token_bind_rate_limited",
        message: "Too many GitHub token connect attempts. Retry later.",
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
    if (validation.githubId !== session.githubId) {
      return reply.status(409).send({
        error: "github_token_identity_mismatch",
        message: `This token belongs to ${validation.githubLogin}, but the current browser is signed in as ${session.githubLogin}.`
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
    const [connectedUsers, teamSignIn] = await Promise.all([
      listConnectedGitHubUsers({ currentUserId: userId }),
      safeTeamSignInSummary()
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
          sessionExpiresAt: session.sessionExpiresAt
        },
        { writeBackEnabled: profile.access.writeBackEnabled }
      ),
      connectedUsers,
      teamSignIn,
      tokenEncryptionConfigured: true,
      githubOAuthConfigured: githubOAuthConfigured()
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
    const [connectedUsers, teamSignIn] = await Promise.all([
      listConnectedGitHubUsers({ currentUserId: session.userId }),
      safeTeamSignInSummary()
    ]);
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
      teamSignIn,
      tokenEncryptionConfigured: isTokenEncryptionConfigured(),
      githubOAuthConfigured: githubOAuthConfigured()
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
