import { describe, expect, test } from "vitest";
import {
  buildClearSessionCookie,
  buildSessionCookie,
  cookieSecureFromEnv,
  readCookieValue,
  sessionCookieName
} from "./sessionCookie";

describe("session cookies", () => {
  test("reads a named cookie from a browser cookie header", () => {
    expect(readCookieValue("other=1; mo_devflow_session=abc%20123", sessionCookieName)).toBe("abc 123");
    expect(readCookieValue("other=1", sessionCookieName)).toBeNull();
    expect(readCookieValue("mo_devflow_session=%", sessionCookieName)).toBeNull();
  });

  test("builds httpOnly SameSite session cookies", () => {
    const cookie = buildSessionCookie("session-value", new Date(Date.now() + 60_000), true);

    expect(cookie).toContain(`${sessionCookieName}=session-value`);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Secure");
  });

  test("builds an expiring clear cookie", () => {
    const cookie = buildClearSessionCookie(false);

    expect(cookie).toContain(`${sessionCookieName}=`);
    expect(cookie).toContain("Max-Age=0");
    expect(cookie).not.toContain("Secure");
  });

  test("defaults secure cookies on in production", () => {
    expect(cookieSecureFromEnv({ NODE_ENV: "production" })).toBe(true);
    expect(cookieSecureFromEnv({ NODE_ENV: "production", MO_DEVFLOW_COOKIE_SECURE: "false" })).toBe(false);
  });
});
