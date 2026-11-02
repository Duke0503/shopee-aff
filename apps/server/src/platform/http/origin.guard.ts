/**
 * The Origin check of every public route that changes something (AD-18, NFR-5). The session
 * cookie is SameSite=Lax, which already keeps it off cross-site POSTs; this check refuses any
 * request whose browser says it came from another site, and any request without an Origin, so a
 * form on another page can never sign someone in or out. A refusal asks the person to reload:
 * the usual honest cause is a page opened on another address of the site before a change.
 */
import type { FastifyRequest } from "fastify";

import { HttpError } from "./error-envelope";

export function requireOrigin(request: FastifyRequest, allowed: readonly string[]): void {
  const origin = request.headers.origin;
  if (typeof origin !== "string" || !allowed.includes(origin)) throw new HttpError("forbidden", "error.reload_page");
}

/** The public origin and its www twin (or the bare host for a www base): both serve the website. */
export function siteOrigins(publicBaseUrl: string): string[] {
  const url = new URL(publicBaseUrl);
  const twin = url.hostname.startsWith("www.") ? url.hostname.slice(4) : `www.${url.hostname}`;
  return [url.origin, `${url.protocol}//${twin}${url.port === "" ? "" : `:${url.port}`}`];
}
