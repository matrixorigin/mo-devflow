import Fastify from "fastify";
import { describe, expect, test } from "vitest";
import {
  buildClearCsrfCookie,
  buildCsrfCookie,
  createCsrfToken,
  csrfCookieName,
  csrfHeaderName,
  hasValidCsrfToken
} from "./csrf";

describe("CSRF protection", () => {
  test("creates strict browser tokens", () => {
    const token = createCsrfToken();

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  test("builds a readable SameSite CSRF cookie", () => {
    const cookie = buildCsrfCookie("a".repeat(43), new Date(Date.now() + 60_000), true);

    expect(cookie).toContain(`${csrfCookieName}=${"a".repeat(43)}`);
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Secure");
    expect(cookie).not.toContain("HttpOnly");
  });

  test("builds an expiring clear cookie", () => {
    const cookie = buildClearCsrfCookie(false);

    expect(cookie).toContain(`${csrfCookieName}=`);
    expect(cookie).toContain("Max-Age=0");
    expect(cookie).not.toContain("Secure");
  });

  test("requires matching cookie and header tokens", async () => {
    const token = "b".repeat(43);
    const app = Fastify();
    app.post("/protected", async (request) => ({ valid: hasValidCsrfToken(request) }));

    try {
      const missingHeader = await app.inject({
        method: "POST",
        url: "/protected",
        headers: {
          cookie: `${csrfCookieName}=${token}`
        }
      });
      expect(missingHeader.json()).toEqual({ valid: false });

      const mismatch = await app.inject({
        method: "POST",
        url: "/protected",
        headers: {
          cookie: `${csrfCookieName}=${token}`,
          [csrfHeaderName]: "c".repeat(43)
        }
      });
      expect(mismatch.json()).toEqual({ valid: false });

      const matched = await app.inject({
        method: "POST",
        url: "/protected",
        headers: {
          cookie: `${csrfCookieName}=${token}`,
          [csrfHeaderName]: token
        }
      });
      expect(matched.json()).toEqual({ valid: true });
    } finally {
      await app.close();
    }
  });
});
