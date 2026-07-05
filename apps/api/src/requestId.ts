import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";

const requestIdPattern = /^[A-Za-z0-9._:-]{8,128}$/;

export function normalizeIncomingRequestId(value: string | string[] | undefined): string | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (!candidate) {
    return null;
  }
  const trimmed = candidate.trim();
  return requestIdPattern.test(trimmed) ? trimmed : null;
}

export function generateApiRequestId(request: IncomingMessage): string {
  return normalizeIncomingRequestId(request.headers["x-request-id"]) ?? randomUUID();
}
