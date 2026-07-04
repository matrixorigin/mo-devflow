import type { OutgoingHttpHeaders } from "node:http";
import Fastify from "fastify";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { registerAuthRoutes } from "./authRoutes";
import { csrfCookieName, csrfHeaderName } from "./csrf";
import { sessionCookieName } from "./sessionCookie";

const mocks = vi.hoisted(() => ({
  getActiveSession: vi.fn(),
  revokeSession: vi.fn(),
  toAuthenticatedUserView: vi.fn(),
  loadRepoProfile: vi.fn()
}));

vi.mock("@mo-devflow/config", () => ({
  loadRepoProfile: mocks.loadRepoProfile
}));

vi.mock("@mo-devflow/db", () => ({
  createUserSession: vi.fn(),
  getActiveSession: mocks.getActiveSession,
  revokeSession: mocks.revokeSession,
  toAuthenticatedUserView: mocks.toAuthenticatedUserView,
  upsertGitHubTokenBinding: vi.fn()
}));

vi.mock("@mo-devflow/github", () => ({
  validateGitHubToken: vi.fn()
}));

function setCookieHeaders(response: { headers: OutgoingHttpHeaders }): string[] {
  const header = response.headers["set-cookie"];
  return Array.isArray(header) ? header.map(String) : typeof header === "string" ? [header] : [];
}

describe("auth routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadRepoProfile.mockReturnValue({ access: { writeBackEnabled: true } });
    mocks.toAuthenticatedUserView.mockReturnValue({
      githubLogin: "alice",
      githubId: "1001",
      avatarUrl: null,
      tokenScopes: ["repo"],
      tokenLastValidatedAt: "2026-07-04T00:00:00.000Z",
      sessionExpiresAt: "2999-07-04T00:00:00.000Z",
      writeCapabilities: { issueLabels: { enabled: true, message: "ok", missingScopes: [] } }
    });
    mocks.getActiveSession.mockResolvedValue({
      userId: 1,
      githubLogin: "alice",
      githubId: "1001",
      avatarUrl: null,
      tokenScopes: ["repo"],
      tokenLastValidatedAt: "2026-07-04T00:00:00.000Z",
      sessionExpiresAt: "2999-07-04T00:00:00.000Z"
    });
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
      expect(response.json()).toMatchObject({ authenticated: true });
      const csrfCookie = setCookieHeaders(response).find((cookie) => cookie.startsWith(`${csrfCookieName}=`));
      expect(csrfCookie).toContain("SameSite=Lax");
      expect(csrfCookie).not.toContain("HttpOnly");
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
        tokenEncryptionConfigured: false
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
        tokenEncryptionConfigured: false
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
});
