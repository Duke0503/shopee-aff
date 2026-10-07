/**
 * The login cookie, byte-compatible with the Python so a cookie set by one
 * runtime is read by the other. Ports `web/dashboard.py`.
 *   name: cashback_session; Path=/; HttpOnly; SameSite=Lax; Max-Age; Expires;
 *   and Secure only when the request arrived over HTTPS.
 */
export const SESSION_COOKIE = "cashback_session";

export const SECONDS_PER_DAY = 86_400;

export function sessionMaxAgeSeconds(sessionDays: number): number {
  return sessionDays * SECONDS_PER_DAY;
}

export function buildSessionCookie(
  token: string,
  expiresAtGmt: string,
  maxAgeSeconds: number,
  secure: boolean,
): string {
  const parts = [
    `${SESSION_COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
    `Expires=${expiresAtGmt}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function clearSessionCookie(): string {
  return [
    `${SESSION_COOKIE}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
  ].join("; ");
}

/** The session token in a Cookie header, or "" when absent. */
export function parseSessionToken(cookieHeader: string | null): string {
  if (!cookieHeader) return "";
  for (const part of cookieHeader.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === SESSION_COOKIE) return rest.join("=");
  }
  return "";
}
