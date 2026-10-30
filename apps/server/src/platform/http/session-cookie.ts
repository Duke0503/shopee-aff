/**
 * The two session cookies (AD-18, INV-8). Staff and customer sessions travel in separate cookies,
 * each HttpOnly, Secure and SameSite=Lax, with the `__Host-` prefix so the browser binds each one
 * to the exact host that set it (no Domain, Path=/): the admin host's staff cookie is never sent
 * to hoantiendp.com and the other way round. A staff route reads only the staff cookie.
 */
export const STAFF_SESSION_COOKIE = "__Host-cashback_staff";
export const CUSTOMER_SESSION_COOKIE = "__Host-cashback_session";

const ATTRIBUTES = "Path=/; HttpOnly; Secure; SameSite=Lax";

/** The value of one cookie in a `Cookie` header, or null; the first of repeated names wins. */
export function readCookie(header: string | undefined, name: string): string | null {
  if (header === undefined) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

/** A `Set-Cookie` value carrying a session token; `maxAgeSeconds` null makes it last until ended. */
export function sessionCookie(name: string, token: string, maxAgeSeconds: number | null): string {
  return `${name}=${token}; ${ATTRIBUTES}${maxAgeSeconds === null ? "" : `; Max-Age=${maxAgeSeconds}`}`;
}

export function clearedCookie(name: string): string {
  return `${name}=; ${ATTRIBUTES}; Max-Age=0`;
}
