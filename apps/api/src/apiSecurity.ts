import cors, { type FastifyCorsOptions } from "@fastify/cors";
import type { FastifyInstance } from "fastify";

const defaultSecurityHeaders: Record<string, string> = {
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  "cross-origin-resource-policy": "same-site",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY"
};

export function normalizeCorsOrigin(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`Invalid CORS origin: ${value}`);
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error(`CORS origin must use http or https: ${value}`);
  }
  if (parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new Error(`CORS origin must not include path, query, or fragment: ${value}`);
  }
  return parsed.origin;
}

export function allowedCorsOriginsFromEnv(env: Record<string, string | undefined> = process.env): string[] {
  const configured = env.MO_DEVFLOW_ALLOWED_ORIGINS;
  if (configured) {
    const origins = Array.from(
      new Set(
        configured
          .split(",")
          .map((origin) => origin.trim())
          .filter(Boolean)
          .map(normalizeCorsOrigin)
      )
    );
    if (origins.length === 0) {
      throw new Error("MO_DEVFLOW_ALLOWED_ORIGINS must contain at least one origin.");
    }
    return origins;
  }

  const webPort = env.MO_DEVFLOW_WEB_PORT ?? "5173";
  return [`http://localhost:${webPort}`, `http://127.0.0.1:${webPort}`].map(normalizeCorsOrigin);
}

export function corsOriginDecision(origin: string | undefined, allowedOrigins: readonly string[]): string | false {
  if (!origin) {
    return false;
  }
  return allowedOrigins.includes(origin) ? origin : false;
}

export function buildCorsOptions(env: Record<string, string | undefined> = process.env): FastifyCorsOptions {
  const allowedOrigins = allowedCorsOriginsFromEnv(env);
  return {
    origin: (origin, callback) => {
      callback(null, corsOriginDecision(origin, allowedOrigins));
    },
    credentials: true,
    methods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "content-type",
      "if-none-match",
      "x-github-delivery",
      "x-github-event",
      "x-hub-signature-256",
      "x-mo-devflow-csrf"
    ],
    exposedHeaders: [
      "etag",
      "retry-after",
      "x-mo-devflow-dashboard-cache",
      "x-mo-devflow-dashboard-version",
      "x-request-id"
    ],
    maxAge: 600
  };
}

export async function registerApiSecurity(
  app: FastifyInstance,
  env: Record<string, string | undefined> = process.env
): Promise<void> {
  await app.register(cors, buildCorsOptions(env));
  app.addHook("onSend", async (request, reply) => {
    reply.header("x-request-id", String(request.id));
    for (const [name, value] of Object.entries(defaultSecurityHeaders)) {
      reply.header(name, value);
    }
  });
}
