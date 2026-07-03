export const sessionCookieName = "mo_devflow_session";

export function readCookieValue(cookieHeader: string | undefined, name: string): string | null {
  if (!cookieHeader) {
    return null;
  }
  for (const segment of cookieHeader.split(";")) {
    const [rawKey, ...valueParts] = segment.trim().split("=");
    if (rawKey === name) {
      try {
        return decodeURIComponent(valueParts.join("="));
      } catch {
        return null;
      }
    }
  }
  return null;
}

export function buildSessionCookie(value: string, expiresAt: Date, secure: boolean): string {
  const maxAge = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
  return [
    `${sessionCookieName}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
    `Expires=${expiresAt.toUTCString()}`,
    secure ? "Secure" : null
  ]
    .filter(Boolean)
    .join("; ");
}

export function buildClearSessionCookie(secure: boolean): string {
  return [
    `${sessionCookieName}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
    secure ? "Secure" : null
  ]
    .filter(Boolean)
    .join("; ");
}

export function cookieSecureFromEnv(env: Record<string, string | undefined> = process.env): boolean {
  const configured = env.MO_DEVFLOW_COOKIE_SECURE?.toLowerCase();
  if (configured === "true" || configured === "1") {
    return true;
  }
  if (configured === "false" || configured === "0") {
    return false;
  }
  return env.NODE_ENV === "production";
}
