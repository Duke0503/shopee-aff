/**
 * A customer's report of a purchase the website does not show (FR-14, INV-5; Story 7.4, pen.dev
 * Gc1Zb), inside the caller's transaction. It never records an order or money: it opens a review
 * case (`missing_order_report`) for staff, with the customer as its one candidate and what they
 * typed as its facts. Staff check it against the network and dismiss it; when the network reports
 * the order, attribution (or its own case) records it.
 *
 * - An order already recorded under the customer's own ids is not reported: the answer names it,
 *   so the page can open it.
 * - One OPEN case per order id (the review case rule). The same customer reporting it again
 *   changes nothing; another customer reporting the same id joins the case as a second candidate,
 *   and each is told only that the report was received.
 * - At most `MISSING_ORDER_DAILY_LIMIT` new reports per customer in 24 hours, counted from the
 *   cases this customer opened, so nothing else needs storing.
 */
import { instantFromMs, toMs, type Instant } from "@cashback/core";
import type { AffiliateNetwork } from "@cashback/money";
import { and, count, eq, gte } from "drizzle-orm";

import type { LedgerDb } from "../../platform/db/ledger";
import { findOrder } from "./order-ledger.repository";
import { MISSING_ORDER_REASON, openOrRefreshCase, type CaseWriters } from "./review-case.command";
import { reviewCases } from "./schema";

export const MISSING_ORDER_DAILY_LIMIT = 5;
export const MISSING_ORDER_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface MissingOrderReport {
  /** The session's customer (the survivor) and every stored id that is theirs. */
  readonly customerId: string;
  readonly customerIds: readonly string[];
  /** Upper case, checked against the order id rule by the caller. */
  readonly orderId: string;
  readonly purchasedOn: string;
  readonly productUrl: string | null;
  readonly note: string | null;
  readonly checks: { readonly openedInZalo: boolean; readonly otherCashbackLink: boolean; readonly guestLink: boolean };
}

export type MissingOrderOutcome =
  | { readonly result: "received"; readonly caseId: number }
  | { readonly result: "already_reported"; readonly caseId: number }
  | { readonly result: "already_recorded" }
  | { readonly result: "rate_limited" };

/** A TikTok Shop order id is digits only (AccessTrade); a Shopee one starts with its date and has letters. */
export const networkOfOrderId = (orderId: string): AffiliateNetwork => (/^\d+$/.test(orderId) ? "accesstrade" : "shopee");

function openCaseOf(db: LedgerDb, network: AffiliateNetwork, subject: string) {
  return db
    .select({ caseId: reviewCases.caseId, candidates: reviewCases.candidates, observation: reviewCases.observation })
    .from(reviewCases)
    .where(and(eq(reviewCases.network, network), eq(reviewCases.subject, subject), eq(reviewCases.reason, MISSING_ORDER_REASON), eq(reviewCases.status, "OPEN")))
    .get();
}

function candidatesOf(json: string): string[] {
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter((c): c is string => typeof c === "string") : [];
  } catch {
    return [];
  }
}

/** How many reports this customer opened in the last 24 hours. */
export function reportsInWindow(db: LedgerDb, customerId: string, now: Instant): number {
  const since = instantFromMs(toMs(now) - MISSING_ORDER_WINDOW_MS);
  const row = db
    .select({ n: count() })
    .from(reviewCases)
    .where(and(eq(reviewCases.reason, MISSING_ORDER_REASON), eq(reviewCases.openedBy, customerId), gte(reviewCases.openedAt, since)))
    .get();
  return row?.n ?? 0;
}

export function reportMissingOrder(db: LedgerDb, report: MissingOrderReport, w: CaseWriters): MissingOrderOutcome {
  const stored = findOrder(db, report.orderId);
  if (stored !== null && stored.customerId !== null && report.customerIds.includes(stored.customerId)) return { result: "already_recorded" };
  const network = stored?.network ?? networkOfOrderId(report.orderId);
  const open = openCaseOf(db, network, report.orderId);
  const candidates = open === undefined ? [] : candidatesOf(open.candidates);
  if (open !== undefined && report.customerIds.some((id) => candidates.includes(id))) return { result: "already_reported", caseId: open.caseId };
  if (reportsInWindow(db, report.customerId, w.at) >= MISSING_ORDER_DAILY_LIMIT) return { result: "rate_limited" };
  const observation = JSON.stringify({
    orderId: report.orderId,
    purchasedOn: report.purchasedOn,
    productUrl: report.productUrl,
    note: report.note,
    openedInZalo: report.checks.openedInZalo,
    otherCashbackLink: report.checks.otherCashbackLink,
    guestLink: report.checks.guestLink,
  });
  // A second customer joins the open case; the first one's facts stay as they were typed.
  const written = openOrRefreshCase(
    db,
    { network, subject: report.orderId, orderId: stored?.orderId ?? null, reason: MISSING_ORDER_REASON, candidates: [...candidates, report.customerId], observation: open?.observation ?? observation, fingerprint: null },
    w,
  );
  return { result: "received", caseId: written.caseId };
}
