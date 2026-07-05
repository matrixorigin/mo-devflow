import Fastify from "fastify";
import { describe, expect, test } from "vitest";
import {
  allowedCorsOriginsFromEnv,
  buildCorsOptions,
  corsOriginDecision,
  normalizeCorsOrigin,
  registerApiSecurity
} from "./apiSecurity";

describe("API security", () => {
  test("defaults CORS to exact local web origins", () => {
    expect(allowedCorsOriginsFromEnv({ MO_DEVFLOW_WEB_PORT: "5179" })).toEqual([
      "http://localhost:5179",
      "http://127.0.0.1:5179"
    ]);
  });

  test("uses explicit allowed origins without wildcard expansion", () => {
    expect(
      allowedCorsOriginsFromEnv({
        MO_DEVFLOW_ALLOWED_ORIGINS: " https://devflow.example.com, http://localhost:5173/, https://devflow.example.com "
      })
    ).toEqual(["https://devflow.example.com", "http://localhost:5173"]);
  });

  test("rejects invalid configured CORS origins", () => {
    expect(normalizeCorsOrigin("https://devflow.example.com")).toBe("https://devflow.example.com");
    expect(() => normalizeCorsOrigin("*")).toThrow("Invalid CORS origin");
    expect(() => normalizeCorsOrigin("file:///tmp/app.html")).toThrow("CORS origin must use http or https");
    expect(() => normalizeCorsOrigin("https://devflow.example.com/app")).toThrow(
      "CORS origin must not include path, query, or fragment"
    );
    expect(() => allowedCorsOriginsFromEnv({ MO_DEVFLOW_ALLOWED_ORIGINS: " , " })).toThrow(
      "MO_DEVFLOW_ALLOWED_ORIGINS must contain at least one origin"
    );
  });

  test("allows only exact configured CORS origins", () => {
    const allowed = ["https://devflow.example.com"];

    expect(corsOriginDecision("https://devflow.example.com", allowed)).toBe("https://devflow.example.com");
    expect(corsOriginDecision("https://evil.example.com", allowed)).toBe(false);
    expect(corsOriginDecision(undefined, allowed)).toBe(false);
  });

  test("registers credentialed CORS for allowed origins only", async () => {
    const app = Fastify();
    await registerApiSecurity(app, { MO_DEVFLOW_ALLOWED_ORIGINS: "https://devflow.example.com" });
    app.get("/probe", async () => ({ ok: true }));

    try {
      const allowed = await app.inject({
        method: "GET",
        url: "/probe",
        headers: { origin: "https://devflow.example.com" }
      });
      const denied = await app.inject({
        method: "GET",
        url: "/probe",
        headers: { origin: "https://evil.example.com" }
      });

      expect(allowed.headers["access-control-allow-origin"]).toBe("https://devflow.example.com");
      expect(allowed.headers["access-control-allow-credentials"]).toBe("true");
      expect(String(allowed.headers["access-control-expose-headers"])).toContain("x-request-id");
      expect(String(allowed.headers["access-control-expose-headers"])).toContain("x-mo-devflow-dashboard-cache");
      expect(denied.headers["access-control-allow-origin"]).toBeUndefined();
    } finally {
      await app.close();
    }
  });

  test("adds baseline security headers to API responses", async () => {
    const app = Fastify();
    await registerApiSecurity(app, { MO_DEVFLOW_ALLOWED_ORIGINS: "http://localhost:5173" });
    app.get("/probe", async () => ({ ok: true }));

    try {
      const response = await app.inject({
        method: "GET",
        url: "/probe",
        headers: { origin: "http://localhost:5173" }
      });

      expect(response.headers["content-security-policy"]).toContain("default-src 'none'");
      expect(response.headers["x-content-type-options"]).toBe("nosniff");
      expect(response.headers["x-frame-options"]).toBe("DENY");
      expect(response.headers["referrer-policy"]).toBe("no-referrer");
      expect(response.headers["cross-origin-resource-policy"]).toBe("same-site");
      expect(response.headers["permissions-policy"]).toBe("camera=(), microphone=(), geolocation=()");
      expect(response.headers["x-request-id"]).toBeTruthy();
    } finally {
      await app.close();
    }
  });

  test("keeps CORS options strict for preflight requests", () => {
    expect(buildCorsOptions({ MO_DEVFLOW_ALLOWED_ORIGINS: "http://localhost:5173" })).toMatchObject({
      credentials: true,
      methods: ["GET", "POST", "DELETE", "OPTIONS"],
      allowedHeaders: [
        "content-type",
        "if-none-match",
        "x-github-delivery",
        "x-github-event",
        "x-hub-signature-256",
        "x-mo-devflow-csrf",
        "x-request-id"
      ],
      exposedHeaders: [
        "etag",
        "retry-after",
        "x-mo-devflow-dashboard-cache",
        "x-mo-devflow-dashboard-version",
        "x-request-id"
      ],
      maxAge: 600
    });
  });

  test("allows dashboard cache and CSRF headers in CORS preflight", async () => {
    const app = Fastify();
    await registerApiSecurity(app, { MO_DEVFLOW_ALLOWED_ORIGINS: "http://localhost:5173" });
    app.get("/probe", async () => ({ ok: true }));

    try {
      const response = await app.inject({
        method: "OPTIONS",
        url: "/probe",
        headers: {
          origin: "http://localhost:5173",
          "access-control-request-method": "GET",
          "access-control-request-headers": "if-none-match,x-mo-devflow-csrf,x-request-id"
        }
      });

      expect(response.statusCode).toBe(204);
      expect(String(response.headers["access-control-allow-headers"])).toContain("if-none-match");
      expect(String(response.headers["access-control-allow-headers"])).toContain("x-mo-devflow-csrf");
      expect(String(response.headers["access-control-allow-headers"])).toContain("x-request-id");
    } finally {
      await app.close();
    }
  });
});
