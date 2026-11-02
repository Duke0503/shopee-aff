/**
 * The website's link quota (FR-2, AD-14, SECURITY_MODEL.md "missing rate limit on the web link
 * quota"; Story 7.6 and its review). The browser bridge is one real Chrome at a human pace, so the
 * public page is limited, but never in a way one anonymous script can spend for everyone:
 *
 * - a guest link (no code) and a typed code (signed out) count per client, the HMAC of the
 *   caller's address: 10 new links an hour each; a typed code never touches that customer's own
 *   allowance, so nobody can use up someone else's day by typing their code;
 * - a signed-in customer counts per customer: 20 new links a Vietnam day;
 * - over everyone, 600 new website links an hour is a safety cap: beyond it the page hands over to
 *   Zalo and the owner is alerted (the caller raises it), so it never blocks silently.
 *
 * Only new requests count: a link handed back by the reuse rule costs the bridge nothing. Counted
 * from the stored requests (migration 0030 indexes them), so a restart forgets nothing.
 */
import { instantFromMs, toMs, vnDayStart, vnToday, type Clock } from "@cashback/core";
import { and, eq, gte, sql, type SQL } from "drizzle-orm";

import type { LedgerDb } from "../../platform/db/ledger";
import { linkRequests } from "./schema";

export const WEB_LINKS_PER_CLIENT_HOUR = 10;
export const WEB_LINKS_PER_CUSTOMER_DAY = 20;
export const WEB_LINKS_SAFETY_CAP_HOUR = 600;
export const WEB_LINK_CAP_ALERT = { kind: "web_link_safety_cap", severity: "high" } as const;
const HOUR_MS = 3_600_000;

export const WEB_ACCESS = ["SESSION", "CODE", "GUEST"] as const;
export type WebAccess = (typeof WEB_ACCESS)[number];

export interface WebLinkAsker {
  readonly access: WebAccess;
  /** The customer the link is for (the guest account for a guest link). */
  readonly customerId: string;
  /** The HMAC of the caller's address (platform/http/client-key.ts). */
  readonly clientKey: string;
}

/** `ok`, or which limit a new website link would pass. */
export type WebLinkQuota = "ok" | "client" | "customer" | "safety_cap";

const count = (db: LedgerDb, where: SQL | undefined): number => db.select({ n: sql<number>`count(*)` }).from(linkRequests).where(where).get()?.n ?? 0;

export function webLinkQuota(db: LedgerDb, asker: WebLinkAsker, clock: Clock): WebLinkQuota {
  const hourAgo = gte(linkRequests.createdAt, instantFromMs(toMs(clock.now()) - HOUR_MS));
  const web = and(eq(linkRequests.channel, "web"), eq(linkRequests.origin, "REQUEST"));
  if (count(db, and(web, hourAgo)) >= WEB_LINKS_SAFETY_CAP_HOUR) return "safety_cap";
  if (asker.access === "SESSION") {
    const today = gte(linkRequests.createdAt, vnDayStart(vnToday(clock)));
    return count(db, and(web, eq(linkRequests.webAccess, "SESSION"), eq(linkRequests.customerId, asker.customerId), today)) < WEB_LINKS_PER_CUSTOMER_DAY ? "ok" : "customer";
  }
  return count(db, and(web, eq(linkRequests.webAccess, asker.access), eq(linkRequests.webClientKey, asker.clientKey), hourAgo)) < WEB_LINKS_PER_CLIENT_HOUR ? "ok" : "client";
}
