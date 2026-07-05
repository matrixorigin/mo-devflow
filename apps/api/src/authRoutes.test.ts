import type { OutgoingHttpHeaders } from "node:http";
import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { registerAuthRoutes } from "./authRoutes";
import { csrfCookieName, csrfHeaderName } from "./csrf";
import { sessionCookieName } from "./sessionCookie";

const mocks = vi.hoisted(() => ({
  getActiveSession: vi.fn(),
  getTeamSignInSummary: vi.fn(),
  listConnectedGitHubUsers: vi.fn(),
  revokeGitHubTokenForUser: vi.fn(),
  revokeSession: vi.fn(),
  createUserSession: vi.fn(),
  toAuthenticatedUserView: vi.fn(),
  upsertGitHubIdentity: vi.fn(),
  upsertGitHubTokenBinding: vi.fn(),
  loadRepoProfile: vi.fn(),
  classifyGitHubError: vi.fn(),
  fetchIssueWritePermission: vi.fn(),
  validateGitHubToken: vi.fn()
}));

vi.mock("@mo-devflow/config", () => ({
  loadRepoProfile: mocks.loadRepoProfile
}));

vi.mock("@mo-devflow/db", () => ({
  createUserSession: mocks.createUserSession,
  getActiveSession: mocks.getActiveSession,
  getTeamSignInSummary: mocks.getTeamSignInSummary,
  listConnectedGitHubUsers: mocks.listConnectedGitHubUsers,
  revokeGitHubTokenForUser: mocks.revokeGitHubTokenForUser,
  revokeSession: mocks.revokeSession,
  toAuthenticatedUserView: mocks.toAuthenticatedUserView,
  upsertGitHubIdentity: mocks.upsertGitHubIdentity,
  upsertGitHubTokenBinding: mocks.upsertGitHubTokenBinding
}));

vi.mock("@mo-devflow/github", () => ({
  classifyGitHubError: mocks.classifyGitHubError,
  fetchIssueWritePermission: mocks.fetchIssueWritePermission,
  validateGitHubToken: mocks.validateGitHubToken
}));

function setCookieHeaders(response: { headers: OutgoingHttpHeaders }): string[] {
  const header = response.headers["set-cookie"];
  return Array.isArray(header) ? header.map(String) : typeof header === "string" ? [header] : [];
}

const originalRateLimitEnv = {
  max: process.env.MO_DEVFLOW_TOKEN_BIND_RATE_LIMIT_MAX,
  windowSeconds: process.env.MO_DEVFLOW_TOKEN_BIND_RATE_LIMIT_WINDOW_SECONDS
};
const originalTokenEncryptionKey = process.env.MO_DEVFLOW_TOKEN_ENCRYPTION_KEY;
const originalOAuthEnv = {
  clientId: process.env.MO_DEVFLOW_GITHUB_OAUTH_CLIENT_ID,
  clientSecret: process.env.MO_DEVFLOW_GITHUB_OAUTH_CLIENT_SECRET,
  redirectUri: process.env.MO_DEVFLOW_GITHUB_OAUTH_REDIRECT_URI
};

function restoreRateLimitEnv(): void {
  if (originalRateLimitEnv.max === undefined) {
    delete process.env.MO_DEVFLOW_TOKEN_BIND_RATE_LIMIT_MAX;
  } else {
    process.env.MO_DEVFLOW_TOKEN_BIND_RATE_LIMIT_MAX = originalRateLimitEnv.max;
  }
  if (originalRateLimitEnv.windowSeconds === undefined) {
    delete process.env.MO_DEVFLOW_TOKEN_BIND_RATE_LIMIT_WINDOW_SECONDS;
  } else {
    process.env.MO_DEVFLOW_TOKEN_BIND_RATE_LIMIT_WINDOW_SECONDS = originalRateLimitEnv.windowSeconds;
  }
}

function restoreTokenEncryptionEnv(): void {
  if (originalTokenEncryptionKey === undefined) {
    delete process.env.MO_DEVFLOW_TOKEN_ENCRYPTION_KEY;
  } else {
    process.env.MO_DEVFLOW_TOKEN_ENCRYPTION_KEY = originalTokenEncryptionKey;
  }
}

function restoreOAuthEnv(): void {
  if (originalOAuthEnv.clientId === undefined) {
    delete process.env.MO_DEVFLOW_GITHUB_OAUTH_CLIENT_ID;
  } else {
    process.env.MO_DEVFLOW_GITHUB_OAUTH_CLIENT_ID = originalOAuthEnv.clientId;
  }
  if (originalOAuthEnv.clientSecret === undefined) {
    delete process.env.MO_DEVFLOW_GITHUB_OAUTH_CLIENT_SECRET;
  } else {
    process.env.MO_DEVFLOW_GITHUB_OAUTH_CLIENT_SECRET = originalOAuthEnv.clientSecret;
  }
  if (originalOAuthEnv.redirectUri === undefined) {
    delete process.env.MO_DEVFLOW_GITHUB_OAUTH_REDIRECT_URI;
  } else {
    process.env.MO_DEVFLOW_GITHUB_OAUTH_REDIRECT_URI = originalOAuthEnv.redirectUri;
  }
}

function csrfHeaders(token = "c".repeat(43)) {
  return {
    cookie: `${sessionCookieName}=session-value; ${csrfCookieName}=${token}`,
    [csrfHeaderName]: token
  };
}

describe("auth routes", () => {
  beforeEach(() => {
    restoreRateLimitEnv();
    restoreTokenEncryptionEnv();
    restoreOAuthEnv();
    vi.clearAllMocks();
    mocks.loadRepoProfile.mockReturnValue({
      key: "matrixorigin/matrixone",
      repo: { owner: "matrixorigin", name: "matrixone" },
      access: { writeBackEnabled: true }
    });
    mocks.validateGitHubToken.mockResolvedValue({
      githubId: "1001",
      githubLogin: "alice",
      avatarUrl: null,
      scopes: ["repo"],
      rateLimitRemaining: 99
    });
    mocks.fetchIssueWritePermission.mockResolvedValue({
      allowed: true,
      permission: "write",
      message: "GitHub token has write permission for issue workflow fixes.",
      rateLimitRemaining: 98
    });
    mocks.classifyGitHubError.mockReturnValue({
      kind: "unknown",
      retriable: true,
      status: null,
      message: "unknown",
      rateLimitRemaining: null,
      rateLimitResetAt: null,
      retryAfterSeconds: null
    });
    mocks.upsertGitHubTokenBinding.mockResolvedValue(1);
    mocks.upsertGitHubIdentity.mockResolvedValue(1);
    mocks.getTeamSignInSummary.mockResolvedValue({
      connectedUsers: 2,
      tokenConnectedUsers: 2,
      activeBrowserSessions: 3,
      lastSeenAt: "2026-07-04T01:00:00.000Z"
    });
    mocks.listConnectedGitHubUsers.mockResolvedValue([
      {
        githubLogin: "alice",
        githubId: "1001",
        avatarUrl: null,
        tokenConnected: true,
        tokenRepoPermission: "write",
        tokenLastValidatedAt: "2026-07-04T00:00:00.000Z",
        activeSessionCount: 1,
        lastSeenAt: "2026-07-04T01:00:00.000Z",
        isCurrentUser: true
      }
    ]);
    mocks.toAuthenticatedUserView.mockReturnValue({
      githubLogin: "alice",
      githubId: "1001",
      avatarUrl: null,
      tokenScopes: ["repo"],
      tokenRepoPermission: "write",
      tokenLastValidatedAt: "2026-07-04T00:00:00.000Z",
      sessionExpiresAt: "2999-07-04T00:00:00.000Z",
      writeCapabilities: {
        issueLabels: {
          enabled: true,
          status: "ready",
          message: "ok",
          requiredScopes: ["repo", "public_repo"],
          currentScopes: ["repo"],
          requiredRepoPermissions: ["admin", "maintain", "write", "triage"],
          repoPermission: "write"
        }
      }
    });
    mocks.getActiveSession.mockResolvedValue({
      userId: 1,
      githubLogin: "alice",
      githubId: "1001",
      avatarUrl: null,
      tokenScopes: ["repo"],
      tokenRepoPermission: "write",
      tokenLastValidatedAt: "2026-07-04T00:00:00.000Z",
      sessionExpiresAt: "2999-07-04T00:00:00.000Z"
    });
  });

  afterEach(() => {
    restoreRateLimitEnv();
    restoreTokenEncryptionEnv();
    restoreOAuthEnv();
    vi.unstubAllGlobals();
  });

  test("returns only aggregate team sign-in state for anonymous sessions", async () => {
    const app = Fastify();
    await registerAuthRoutes(app);

    try {
      const response = await app.inject({
        method: "GET",
        url: "/api/session"
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        authenticated: false,
        user: null,
        connectedUsers: [],
        teamSignIn: {
          connectedUsers: 2,
          tokenConnectedUsers: 2,
          activeBrowserSessions: 3,
          lastSeenAt: "2026-07-04T01:00:00.000Z"
        },
        tokenEncryptionConfigured: false,
        githubOAuthConfigured: false
      });
      expect(mocks.getTeamSignInSummary).toHaveBeenCalledTimes(1);
      expect(mocks.listConnectedGitHubUsers).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  test("keeps anonymous sessions available when team sign-in summary fails", async () => {
    mocks.getTeamSignInSummary.mockRejectedValue(new Error("summary unavailable"));
    const app = Fastify();
    await registerAuthRoutes(app);

    try {
      const response = await app.inject({
        method: "GET",
        url: "/api/session"
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        authenticated: false,
        user: null,
        connectedUsers: [],
        teamSignIn: {
          connectedUsers: 0,
          tokenConnectedUsers: 0,
          activeBrowserSessions: 0,
          lastSeenAt: null
        },
        tokenEncryptionConfigured: false,
        githubOAuthConfigured: false
      });
      expect(mocks.listConnectedGitHubUsers).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  test("sets a readable CSRF cookie for authenticated sessions", async () => {
    const app = Fastify();
    await registerAuthRoutes(app);

    try {
      const response = await app.inject({
        method: "GET",
        url: "/api/session",
        headers: { cookie: `${sessionCookieName}=session-value` }
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        authenticated: true,
        connectedUsers: [
          expect.objectContaining({
            githubLogin: "alice",
            activeSessionCount: 1,
            isCurrentUser: true
          })
        ],
        teamSignIn: {
          connectedUsers: 2,
          tokenConnectedUsers: 2,
          activeBrowserSessions: 3,
          lastSeenAt: "2026-07-04T01:00:00.000Z"
        }
      });
      expect(mocks.getTeamSignInSummary).toHaveBeenCalled();
      expect(mocks.listConnectedGitHubUsers).toHaveBeenCalledWith({ currentUserId: 1 });
      const csrfCookie = setCookieHeaders(response).find((cookie) => cookie.startsWith(`${csrfCookieName}=`));
      expect(csrfCookie).toContain("SameSite=Lax");
      expect(csrfCookie).not.toContain("HttpOnly");
    } finally {
      await app.close();
    }
  });

  test("reports GitHub OAuth sign-in availability from session state", async () => {
    process.env.MO_DEVFLOW_GITHUB_OAUTH_CLIENT_ID = "client-id";
    process.env.MO_DEVFLOW_GITHUB_OAUTH_CLIENT_SECRET = "client-secret";
    const app = Fastify();
    await registerAuthRoutes(app);

    try {
      const response = await app.inject({
        method: "GET",
        url: "/api/session"
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        authenticated: false,
        githubOAuthConfigured: true
      });
    } finally {
      await app.close();
    }
  });

  test("starts GitHub OAuth sign-in when configured", async () => {
    process.env.MO_DEVFLOW_GITHUB_OAUTH_CLIENT_ID = "client-id";
    process.env.MO_DEVFLOW_GITHUB_OAUTH_CLIENT_SECRET = "client-secret";
    process.env.MO_DEVFLOW_GITHUB_OAUTH_REDIRECT_URI = "http://localhost:18081/api/auth/github/callback";
    const app = Fastify();
    await registerAuthRoutes(app);

    try {
      const response = await app.inject({
        method: "GET",
        url: "/api/auth/github/start"
      });

      expect(response.statusCode).toBe(302);
      expect(String(response.headers.location)).toContain("https://github.com/login/oauth/authorize");
      expect(String(response.headers.location)).toContain("client_id=client-id");
      expect(String(response.headers.location)).toContain("scope=read%3Auser");
      expect(setCookieHeaders(response).some((cookie) => cookie.startsWith("mo_devflow_oauth_state="))).toBe(true);
    } finally {
      await app.close();
    }
  });

  test("creates a browser session from GitHub OAuth callback without storing an OAuth token", async () => {
    process.env.MO_DEVFLOW_GITHUB_OAUTH_CLIENT_ID = "client-id";
    process.env.MO_DEVFLOW_GITHUB_OAUTH_CLIENT_SECRET = "client-secret";
    process.env.MO_DEVFLOW_GITHUB_OAUTH_REDIRECT_URI = "http://localhost:18081/api/auth/github/callback";
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ access_token: "oauth-access-token" })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ id: 1001, login: "alice", avatar_url: "https://example.test/avatar.png" })
        })
    );
    const app = Fastify();
    await registerAuthRoutes(app);

    try {
      const response = await app.inject({
        method: "GET",
        url: "/api/auth/github/callback?code=code-1&state=state-1",
        headers: { cookie: "mo_devflow_oauth_state=state-1" }
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toBe("/");
      expect(mocks.upsertGitHubIdentity).toHaveBeenCalledWith({
        githubId: "1001",
        githubLogin: "alice",
        avatarUrl: "https://example.test/avatar.png"
      });
      expect(mocks.upsertGitHubTokenBinding).not.toHaveBeenCalled();
      expect(mocks.createUserSession).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 1,
          sessionHash: expect.any(String),
          expiresAt: expect.any(String)
        })
      );
      const cookies = setCookieHeaders(response);
      expect(cookies.some((cookie) => cookie.startsWith(`${sessionCookieName}=`))).toBe(true);
      expect(cookies.some((cookie) => cookie.startsWith(`${csrfCookieName}=`))).toBe(true);
      expect(cookies.some((cookie) => cookie.startsWith("mo_devflow_oauth_state=") && cookie.includes("Max-Age=0"))).toBe(
        true
      );
    } finally {
      await app.close();
    }
  });

  test("rejects GitHub OAuth callback with missing state", async () => {
    process.env.MO_DEVFLOW_GITHUB_OAUTH_CLIENT_ID = "client-id";
    process.env.MO_DEVFLOW_GITHUB_OAUTH_CLIENT_SECRET = "client-secret";
    const app = Fastify();
    await registerAuthRoutes(app);

    try {
      const response = await app.inject({
        method: "GET",
        url: "/api/auth/github/callback?code=code-1&state=state-1"
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({
        error: "github_oauth_state_invalid",
        message: "GitHub sign-in state is missing or expired. Start sign-in again."
      });
      expect(mocks.createUserSession).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  test("clears session and CSRF cookies when the session is no longer active", async () => {
    mocks.getActiveSession.mockResolvedValue(null);
    const app = Fastify();
    await registerAuthRoutes(app);

    try {
      const response = await app.inject({
        method: "GET",
        url: "/api/session",
        headers: { cookie: `${sessionCookieName}=stale-session` }
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        authenticated: false,
        user: null,
        connectedUsers: [],
        teamSignIn: {
          connectedUsers: 2,
          tokenConnectedUsers: 2,
          activeBrowserSessions: 3,
          lastSeenAt: "2026-07-04T01:00:00.000Z"
        },
        tokenEncryptionConfigured: false,
        githubOAuthConfigured: false
      });
      const cookies = setCookieHeaders(response);
      expect(cookies.some((cookie) => cookie.startsWith(`${sessionCookieName}=`) && cookie.includes("Max-Age=0"))).toBe(
        true
      );
      expect(cookies.some((cookie) => cookie.startsWith(`${csrfCookieName}=`) && cookie.includes("Max-Age=0"))).toBe(
        true
      );
    } finally {
      await app.close();
    }
  });

  test("rejects active session logout without a valid CSRF token", async () => {
    const app = Fastify();
    await registerAuthRoutes(app);

    try {
      const response = await app.inject({
        method: "DELETE",
        url: "/api/session",
        headers: { cookie: `${sessionCookieName}=session-value` }
      });

      expect(response.statusCode).toBe(403);
      expect(response.json()).toEqual({
        error: "csrf_required",
        message: "Refresh the session and retry the request."
      });
      expect(mocks.revokeSession).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  test("clears session and CSRF cookies when logout carries a valid CSRF token", async () => {
    const token = "c".repeat(43);
    const app = Fastify();
    await registerAuthRoutes(app);

    try {
      const response = await app.inject({
        method: "DELETE",
        url: "/api/session",
        headers: {
          cookie: `${sessionCookieName}=session-value; ${csrfCookieName}=${token}`,
          [csrfHeaderName]: token
        }
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        authenticated: false,
        user: null,
        connectedUsers: [],
        teamSignIn: {
          connectedUsers: 2,
          tokenConnectedUsers: 2,
          activeBrowserSessions: 3,
          lastSeenAt: "2026-07-04T01:00:00.000Z"
        },
        tokenEncryptionConfigured: false,
        githubOAuthConfigured: false
      });
      expect(mocks.revokeSession).toHaveBeenCalledTimes(1);
      const cookies = setCookieHeaders(response);
      expect(cookies.some((cookie) => cookie.startsWith(`${sessionCookieName}=`) && cookie.includes("Max-Age=0"))).toBe(
        true
      );
      expect(cookies.some((cookie) => cookie.startsWith(`${csrfCookieName}=`) && cookie.includes("Max-Age=0"))).toBe(
        true
      );
    } finally {
      await app.close();
    }
  });

  test("rejects saved token removal without a valid CSRF token", async () => {
    const app = Fastify();
    await registerAuthRoutes(app);

    try {
      const response = await app.inject({
        method: "DELETE",
        url: "/api/session/github-token",
        headers: { cookie: `${sessionCookieName}=session-value` }
      });

      expect(response.statusCode).toBe(403);
      expect(response.json()).toEqual({
        error: "csrf_required",
        message: "Refresh the session and retry the request."
      });
      expect(mocks.revokeGitHubTokenForUser).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  test("removes only the current user's saved GitHub token without signing out", async () => {
    const token = "d".repeat(43);
    const app = Fastify();
    await registerAuthRoutes(app);

    try {
      const response = await app.inject({
        method: "DELETE",
        url: "/api/session/github-token",
        headers: {
          cookie: `${sessionCookieName}=session-value; ${csrfCookieName}=${token}`,
          [csrfHeaderName]: token
        }
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ authenticated: true });
      expect(mocks.revokeGitHubTokenForUser).toHaveBeenCalledWith(1);
      expect(mocks.toAuthenticatedUserView).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 1,
          githubLogin: "alice",
          tokenScopes: [],
          tokenRepoPermission: "none",
          tokenLastValidatedAt: null
        }),
        { writeBackEnabled: true }
      );
    } finally {
      await app.close();
    }
  });

  test("rate limits GitHub token binding attempts before validation work continues", async () => {
    process.env.MO_DEVFLOW_TOKEN_BIND_RATE_LIMIT_MAX = "1";
    process.env.MO_DEVFLOW_TOKEN_BIND_RATE_LIMIT_WINDOW_SECONDS = "60";
    const app = Fastify();
    await registerAuthRoutes(app);

    try {
      const first = await app.inject({
        method: "POST",
        url: "/api/session/github-token",
        headers: csrfHeaders(),
        payload: { token: "too-short" }
      });
      expect(first.statusCode).toBe(422);

      const second = await app.inject({
        method: "POST",
        url: "/api/session/github-token",
        headers: csrfHeaders(),
        payload: { token: "too-short" }
      });

      expect(second.statusCode).toBe(429);
      const body = second.json();
      expect(body).toEqual({
        error: "github_token_bind_rate_limited",
        message: "Too many GitHub token connect attempts. Retry later.",
        retryAfterSeconds: expect.any(Number)
      });
      expect(Number(body.retryAfterSeconds)).toBeGreaterThan(0);
      expect(second.headers["retry-after"]).toBe(String(body.retryAfterSeconds));
      expect(mocks.validateGitHubToken).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  test("stores repository permission when binding a GitHub token", async () => {
    process.env.MO_DEVFLOW_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
    mocks.fetchIssueWritePermission.mockResolvedValue({
      allowed: true,
      permission: "triage",
      message: "GitHub token has triage permission for issue workflow fixes.",
      rateLimitRemaining: 98
    });
    const token = `ghp_${"a".repeat(40)}`;
    const app = Fastify();
    await registerAuthRoutes(app);

    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/session/github-token",
        headers: csrfHeaders(),
        payload: { token }
      });

      expect(response.statusCode).toBe(200);
      expect(mocks.fetchIssueWritePermission).toHaveBeenCalledWith({
        token,
        profile: {
          key: "matrixorigin/matrixone",
          repo: { owner: "matrixorigin", name: "matrixone" },
          access: { writeBackEnabled: true }
        }
      });
      expect(mocks.upsertGitHubTokenBinding).toHaveBeenCalledWith(
        expect.objectContaining({
          githubId: "1001",
          githubLogin: "alice",
          scopes: ["repo"],
          repoPermission: "triage"
        })
      );
      expect(mocks.toAuthenticatedUserView).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 1,
          githubLogin: "alice",
          tokenScopes: ["repo"],
          tokenRepoPermission: "triage",
          sessionExpiresAt: "2999-07-04T00:00:00.000Z"
        }),
        { writeBackEnabled: true }
      );
      expect(mocks.createUserSession).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  test("rejects connecting a token that belongs to a different GitHub identity", async () => {
    process.env.MO_DEVFLOW_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
    mocks.validateGitHubToken.mockResolvedValue({
      githubId: "2002",
      githubLogin: "bob",
      avatarUrl: null,
      scopes: ["repo"],
      rateLimitRemaining: 99
    });
    const app = Fastify();
    await registerAuthRoutes(app);

    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/session/github-token",
        headers: csrfHeaders(),
        payload: { token: `ghp_${"d".repeat(40)}` }
      });

      expect(response.statusCode).toBe(409);
      expect(response.json()).toEqual({
        error: "github_token_identity_mismatch",
        message: "This token belongs to bob, but the current browser is signed in as alice."
      });
      expect(mocks.upsertGitHubTokenBinding).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  test("keeps a valid token bound as repository none when the target repo is inaccessible", async () => {
    process.env.MO_DEVFLOW_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
    mocks.fetchIssueWritePermission.mockRejectedValue(new Error("not found"));
    mocks.classifyGitHubError.mockReturnValue({
      kind: "not_found",
      retriable: false,
      status: 404,
      message: "not found",
      rateLimitRemaining: 97,
      rateLimitResetAt: null,
      retryAfterSeconds: null
    });
    const token = `ghp_${"b".repeat(40)}`;
    const app = Fastify();
    await registerAuthRoutes(app);

    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/session/github-token",
        headers: csrfHeaders(),
        payload: { token }
      });

      expect(response.statusCode).toBe(200);
      expect(mocks.upsertGitHubTokenBinding).toHaveBeenCalledWith(
        expect.objectContaining({
          repoPermission: "none"
        })
      );
      expect(mocks.toAuthenticatedUserView).toHaveBeenCalledWith(
        expect.objectContaining({
          tokenRepoPermission: "none"
        }),
        { writeBackEnabled: true }
      );
    } finally {
      await app.close();
    }
  });

  test("returns retry guidance when repository permission checks are rate limited", async () => {
    process.env.MO_DEVFLOW_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
    mocks.fetchIssueWritePermission.mockRejectedValue(new Error("rate limited"));
    mocks.classifyGitHubError.mockReturnValue({
      kind: "rate_limited",
      retriable: true,
      status: 403,
      message: "rate limited",
      rateLimitRemaining: 0,
      rateLimitResetAt: "2026-07-04T01:00:00.000Z",
      retryAfterSeconds: 120
    });
    const token = `ghp_${"c".repeat(40)}`;
    const app = Fastify();
    await registerAuthRoutes(app);

    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/session/github-token",
        headers: csrfHeaders(),
        payload: { token }
      });

      expect(response.statusCode).toBe(429);
      expect(response.headers["retry-after"]).toBe("120");
      expect(response.json()).toEqual({
        error: "github_repo_permission_check_rate_limited",
        message: "GitHub rate limited the repository permission check. Retry later.",
        retryAfterSeconds: 120
      });
      expect(mocks.upsertGitHubTokenBinding).not.toHaveBeenCalled();
      expect(mocks.createUserSession).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
});
