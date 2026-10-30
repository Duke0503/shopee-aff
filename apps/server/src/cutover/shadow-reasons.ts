/**
 * Why the shadow run's state or amount for an order differs from the live one (D44, Story 2.9).
 * Each reason is one sentence the owner reads in the sign-off report. The live readers took the
 * first order's first item of a Shopee conversion (report_reader.py `_row_to_report_row`), so
 * the first three reasons name the live defect behind the difference; the rest are what the
 * new reconciliation does with a report the live system had not applied yet.
 */
import type { OrderStatus } from "@cashback/core";
import type { AffiliateNetwork } from "@cashback/money";

import type { ReportRow } from "../modules/linking/index";
import { reportSignal, type ReportSignal } from "../modules/orders/index";

export const SHADOW_REASONS = {
  order_cancel_ignored_by_first_item: "live first-item status ignored an order-level cancel: live would have paid a cancelled order",
  cancelled_item_counted: "live counted the commission of a cancelled item",
  first_item_cancel_rejected_order: "live rejected the whole order on its cancelled first item; other items are still live",
  cancelled_by_report: "the report cancels the order",
  approved_by_report: "the report approves the order",
  commission_drop: "the approved commission dropped below the stored one: frozen for a review case",
  report_estimate_differs: "the report's live items estimate a different commission",
  report_unreadable: "the report row cannot be read safely: frozen for a review case",
  clawback_after_payout: "cancelled after payout: the order stays PAID and the cashback is clawed back",
  partial_clawback_after_payout: "the commission dropped after payout: the order stays PAID and the difference is clawed back",
  live_rejection_disputed: "live rejected the order but the report does not cancel it: a wrong-rejection review case",
  older_than_report_window: "unpaid order older than the report window: the report can no longer verify it",
  missing_from_report: "unpaid order inside the report window but missing from the report",
  newer_than_report_window: "unpaid order recorded after the report window ends: not judged, the report cannot say anything about it yet",
  live_orphan_owed: "live owes this order to a customer id that is no customer, so live payouts never list it; the new ledger owes it to the survivor",
  not_in_live_ledger: "the report holds an order the live ledger does not",
  unattributed_report_row: "the report row resolves to no customer: a review case",
  no_report_source: "no report was given for this order's network",
  unknown_network: "the order's live platform maps to no network",
  unchanged: "no difference",
} as const;

export type ShadowReason = keyof typeof SHADOW_REASONS;

export interface Classified {
  reason: ShadowReason;
  /** The report signal's reason or the frozen review case, when one applies. */
  detail: string | null;
}

export interface ReasonFacts {
  network: AffiliateNetwork;
  liveStatus: OrderStatus;
  shadowStatus: OrderStatus | null;
  /** The last report row applied; its signal decided the state. */
  last: ReportRow;
  clawback: number;
  reviewCases: readonly string[];
  payableDifference: number;
  waitingDifference: number;
}

const owed = (status: OrderStatus): boolean => status === "AWAITING_APPROVAL" || status === "APPROVED";

function firstItemCancelled(row: ReportRow): boolean {
  return row.items[0]?.status === "CANCELLED";
}

function onCancel(facts: ReasonFacts, signal: Extract<ReportSignal, { kind: "CANCEL" }>): Classified {
  if (!owed(facts.liveStatus)) return { reason: "unchanged", detail: null };
  const ignored = facts.network === "shopee" && signal.reason === "order_cancelled" && !firstItemCancelled(facts.last);
  return { reason: ignored ? "order_cancel_ignored_by_first_item" : "cancelled_by_report", detail: signal.reason };
}

function onLive(facts: ReasonFacts): Classified {
  const shopee = facts.network === "shopee";
  if (facts.liveStatus === "REJECTED") return { reason: shopee && firstItemCancelled(facts.last) ? "first_item_cancel_rejected_order" : "live_rejection_disputed", detail: null };
  if (!owed(facts.liveStatus)) return { reason: "unchanged", detail: null };
  const drop = facts.reviewCases.includes("commission_drop") ? "commission_drop" : null;
  const differs = drop !== null || facts.payableDifference !== 0 || facts.waitingDifference !== 0;
  if (shopee && differs && facts.last.items.some((i) => i.status === "CANCELLED")) return { reason: "cancelled_item_counted", detail: drop };
  if (drop !== null) return { reason: "commission_drop", detail: drop };
  if (facts.liveStatus === "AWAITING_APPROVAL" && facts.shadowStatus === "APPROVED") return { reason: "approved_by_report", detail: null };
  if (facts.waitingDifference !== 0) return { reason: "report_estimate_differs", detail: null };
  return { reason: "unchanged", detail: null };
}

/** The reason for an imported order the report holds. */
export function classify(facts: ReasonFacts): Classified {
  const signal = reportSignal(facts.last);
  if (facts.liveStatus === "PAID") {
    if (facts.clawback > 0) return { reason: signal.kind === "CANCEL" ? "clawback_after_payout" : "partial_clawback_after_payout", detail: signal.kind === "CANCEL" ? signal.reason : null };
    return signal.kind === "FREEZE" ? { reason: "report_unreadable", detail: signal.reason } : { reason: "unchanged", detail: null };
  }
  if (signal.kind === "FREEZE") return owed(facts.liveStatus) ? { reason: "report_unreadable", detail: signal.reason } : { reason: "unchanged", detail: null };
  if (signal.kind === "CANCEL") return onCancel(facts, signal);
  return onLive(facts);
}
