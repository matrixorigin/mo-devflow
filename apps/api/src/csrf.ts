import { randomBytes } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { csrfCookieName, csrfHeaderName } from "@mo-devflow/shared";
import { readCookieValue } from "./sessionCookie";

export { csrfCookieName, csrfHeaderName };

const csrfTokenPattern = /^[A-Za-z0-9_-]{43}$/;

export function createCsrfToken(): string {
  return randomBytes(32).toString("base64url");
}

export function isCsrfTokenValue(value: string | null): value is string {
  return value !== null && csrfTokenPattern.test(value);
}

export function buildCsrfCookie(value: string, expiresAt: Date, secure: boolean): string {
  const maxAge = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
  return [
    `${csrfCookieName}=${encodeURIComponent(value)}`,
    "Path=/",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
    `Expires=${expiresAt.toUTCString()}`,
    secure ? "Secure" : null
  ]
    .filter(Boolean)
    .join("; ");
}

export function buildClearCsrfCookie(secure: boolean): string {
  return [
    `${csrfCookieName}=`,
    "Path=/",
    "SameSite=Lax",
    "Max-Age=0",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
    secure ? "Secure" : null
  ]
    .filter(Boolean)
    .join("; ");
}

export function buildCsrfCookieForSession(request: FastifyRequest, expiresAt: Date, secure: boolean): string {
  const existingToken = readCookieValue(request.headers.cookie, csrfCookieName);
  return buildCsrfCookie(isCsrfTokenValue(existingToken) ? existingToken : createCsrfToken(), expiresAt, secure);
}

export function hasValidCsrfToken(request: FastifyRequest): boolean {
  const cookieToken = readCookieValue(request.headers.cookie, csrfCookieName);
  const headerToken = request.headers[csrfHeaderName];
  if (!isCsrfTokenValue(cookieToken) || typeof headerToken !== "string") {
    return false;
  }
  return headerToken === cookieToken;
}

export function sendCsrfRequired(reply: FastifyReply): FastifyReply {
  return reply.status(403).send({
    error: "csrf_required",
    message: "Refresh the session and retry the request."
  });
}
