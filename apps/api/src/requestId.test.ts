import Fastify from "fastify";
import { describe, expect, test } from "vitest";
import { registerApiSecurity } from "./apiSecurity";
import { generateApiRequestId, normalizeIncomingRequestId } from "./requestId";

describe("API request ids", () => {
  test("accepts bounded upstream request ids", () => {
    expect(normalizeIncomingRequestId("edge-01:abc_DEF.123")).toBe("edge-01:abc_DEF.123");
    expect(normalizeIncomingRequestId(["trace-12345678", "ignored-12345678"])).toBe("trace-12345678");
  });

  test("rejects missing, short, oversized, or unsafe request ids", () => {
    expect(normalizeIncomingRequestId(undefined)).toBeNull();
    expect(normalizeIncomingRequestId("short")).toBeNull();
    expect(normalizeIncomingRequestId("a".repeat(129))).toBeNull();
    expect(normalizeIncomingRequestId("bad request id")).toBeNull();
    expect(normalizeIncomingRequestId("bad\nheader")).toBeNull();
  });

  test("uses upstream request id for response correlation when valid", async () => {
    const app = Fastify({ genReqId: generateApiRequestId, logger: false });
    await registerApiSecurity(app, { MO_DEVFLOW_ALLOWED_ORIGINS: "http://localhost:5173" });
    app.get("/probe", async (request) => ({ requestId: request.id }));

    try {
      const response = await app.inject({
        method: "GET",
        url: "/probe",
        headers: { "x-request-id": "edge-trace-12345678", origin: "http://localhost:5173" }
      });

      expect(response.headers["x-request-id"]).toBe("edge-trace-12345678");
      expect(response.json()).toEqual({ requestId: "edge-trace-12345678" });
    } finally {
      await app.close();
    }
  });

  test("generates a fresh request id when upstream value is unsafe", async () => {
    const app = Fastify({ genReqId: generateApiRequestId, logger: false });
    await registerApiSecurity(app, { MO_DEVFLOW_ALLOWED_ORIGINS: "http://localhost:5173" });
    app.get("/probe", async (request) => ({ requestId: request.id }));

    try {
      const response = await app.inject({
        method: "GET",
        url: "/probe",
        headers: { "x-request-id": "bad request id", origin: "http://localhost:5173" }
      });
      const requestId = String(response.headers["x-request-id"]);

      expect(requestId).not.toBe("bad request id");
      expect(requestId).toMatch(/^[0-9a-f-]{36}$/);
      expect(response.json()).toEqual({ requestId });
    } finally {
      await app.close();
    }
  });
});
