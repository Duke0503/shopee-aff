/**
 * When a repeat request may get an existing link back (FR-5, D5, D6, D23, INV-1; Story 5.2).
 *
 * A link carries its customer's id in sub_id1 and reconciliation credits every order on it to that
 * customer, so a link is reused only for the same customer: a candidate must belong to one of the
 * requester's own keys (the surviving customer id and the aliases that resolve to it). Reusing by
 * product alone paid customer B's purchase to customer A in production (fixed on 2026-09-25).
 * Product facts may be shared; links never are.
 *
 * The attribution window is not an expiry (a link never expires, D23): it separates "I never got
 * it" from "I am shopping for this again". Inside it the customer's own newest live request is
 * handed back; outside it a fresh request is made, so the rates quoted are fresh. The guest
 * account is one payee for every guest, so it keeps one link per product with no window (D5, as
 * the live `find_house_link` does).
 *
 * A FAILED request is never handed back, nor an imported request still QUEUED (the link job never
 * serves imported requests). In dev only dev requests (the `DEV` request id prefix) are handed
 * back, so a production link imported for a rehearsal never reaches a dev requester (AD-25).
 * A request whose time cannot be read as an instant is never handed back (the cutover stores
 * canonical instants, so this is damaged data): `unreadableTimes` names it for the caller to log.
 */
import { parseInstant, toMs, type Instant } from "@cashback/core";

export const LINK_REUSE_WINDOW_DAYS = 7;
const DAY_MS = 86_400_000;

export interface ReuseCandidate {
  readonly requestId: string;
  readonly customerId: string;
  readonly status: "QUEUED" | "ISSUED" | "DELIVERED" | "CONVERTED" | "FAILED";
  readonly origin: "CUTOVER" | "REQUEST";
  readonly createdAt: string | null;
  readonly hasLink: boolean;
}

export interface ReuseRule {
  /** The requester's surviving id and every alias that resolves to it. */
  readonly ownerKeys: readonly string[];
  /** True for the guest account (D5): one link per product, no window. */
  readonly guest: boolean;
  readonly now: Instant;
  /** `DEV` in dev, empty in production (AD-25). */
  readonly requestIdPrefix: string;
}

const msOf = (text: string | null): number | null => {
  if (text === null) return null;
  try {
    return toMs(parseInstant(text));
  } catch {
    return null;
  }
};

export function isReusable(candidate: ReuseCandidate, rule: ReuseRule): boolean {
  if (!rule.ownerKeys.includes(candidate.customerId)) return false;
  const created = msOf(candidate.createdAt);
  if (created === null) return false;
  if (candidate.status === "FAILED") return false;
  if (candidate.status === "QUEUED" && candidate.origin !== "REQUEST") return false;
  if (!candidate.requestId.startsWith(rule.requestIdPrefix)) return false;
  if (rule.guest) return true;
  return created >= toMs(rule.now) - LINK_REUSE_WINDOW_DAYS * DAY_MS;
}

/** The candidates of this owner whose stored time is not an instant: never reused, to be logged. */
export function unreadableTimes(candidates: readonly ReuseCandidate[], rule: ReuseRule): string[] {
  return candidates.filter((c) => rule.ownerKeys.includes(c.customerId) && msOf(c.createdAt) === null).map((c) => c.requestId);
}

/** Newest first; a time that cannot be read sorts after every readable one. */
const newestFirst = (a: ReuseCandidate, b: ReuseCandidate): number => (msOf(b.createdAt) ?? Number.NEGATIVE_INFINITY) - (msOf(a.createdAt) ?? Number.NEGATIVE_INFINITY);

/** The request to hand back, or null for a fresh request: one with a link first, then the newest. */
export function chooseReusable(candidates: readonly ReuseCandidate[], rule: ReuseRule): ReuseCandidate | null {
  const usable = candidates.filter((c) => isReusable(c, rule));
  usable.sort((a, b) => Number(b.hasLink) - Number(a.hasLink) || newestFirst(a, b) || (a.requestId < b.requestId ? 1 : -1));
  return usable[0] ?? null;
}
