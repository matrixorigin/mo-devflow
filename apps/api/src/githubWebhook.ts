import { createHmac, timingSafeEqual } from "node:crypto";
import type { FastifyRequest } from "fastify";

export interface GitHubWebhookHeaders {
  deliveryId: string | null;
  eventName: string | null;
  signature256: string | null;
}

function firstHeader(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return value ?? null;
}

export function readGitHubWebhookHeaders(request: FastifyRequest): GitHubWebhookHeaders {
  return {
    deliveryId: firstHeader(request.headers["x-github-delivery"]),
    eventName: firstHeader(request.headers["x-github-event"]),
    signature256: firstHeader(request.headers["x-hub-signature-256"])
  };
}

export function githubWebhookSecretFromEnv(): string | null {
  const value = process.env.MO_DEVFLOW_GITHUB_WEBHOOK_SECRET?.trim();
  return value ? value : null;
}

export function computeGitHubWebhookSignature(secret: string, rawBody: string): string {
  return `sha256=${createHmac("sha256", secret).update(rawBody, "utf8").digest("hex")}`;
}

export function isValidGitHubWebhookSignature(input: {
  secret: string;
  rawBody: string;
  signatureHeader: string | null;
}): boolean {
  if (!input.signatureHeader?.startsWith("sha256=")) {
    return false;
  }
  const expected = Buffer.from(computeGitHubWebhookSignature(input.secret, input.rawBody), "utf8");
  const received = Buffer.from(input.signatureHeader, "utf8");
  return expected.length === received.length && timingSafeEqual(expected, received);
}

export function webhookActionFromPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  const action = (payload as { action?: unknown }).action;
  return typeof action === "string" ? action : null;
}

export function webhookRepositoryFullNameFromPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  const repository = (payload as { repository?: unknown }).repository;
  if (!repository || typeof repository !== "object" || Array.isArray(repository)) {
    return null;
  }
  const fullName = (repository as { full_name?: unknown }).full_name;
  return typeof fullName === "string" ? fullName : null;
}

export function safeWebhookHeaders(headers: FastifyRequest["headers"]): Record<string, unknown> {
  const allowed = [
    "content-type",
    "user-agent",
    "x-github-delivery",
    "x-github-event",
    "x-github-hook-id",
    "x-github-hook-installation-target-id",
    "x-github-hook-installation-target-type",
    "x-hub-signature-256"
  ];
  return Object.fromEntries(
    allowed
      .map((key) => [key, headers[key]])
      .filter((entry): entry is [string, string | string[]] => entry[1] !== undefined)
  );
}
