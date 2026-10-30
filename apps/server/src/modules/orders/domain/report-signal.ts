/**
 * What one normalized report row says about its order (D31, status-flows.md §1), for the
 * transition function (AD-7) to act on. The checks run in a fixed order and the first one
 * that applies decides:
 *
 *   1. no order id                          FREEZE
 *   1b. the row has a reading problem       FREEZE  (malformed amount or quantity, sub_ids)
 *   2. the order-level status is CANCELLED  CANCEL  (no item status overrides it)
 *   3. the order-level status is UNKNOWN    FREEZE
 *   4. no items                             FREEZE
 *   5. every item is CANCELLED              CANCEL  (a cancelled item only drops out)
 *   6. a live item is UNKNOWN               FREEZE
 *   7. no live item reports a commission    FREEZE
 *   8. every reported live part is 0        CANCEL
 *   9. every live item is APPROVED          APPROVED, else AWAITING
 *
 * A live item is one not CANCELLED; its commission parts are the payable ones (R3).
 * The input is the shape the linking module's report rows have; this file imports no
 * module (code.md §1).
 */

export type ObservedStatus = "AWAITING" | "APPROVED" | "CANCELLED" | "UNKNOWN";

export interface ObservedItem {
  readonly status: ObservedStatus;
  readonly commissionParts: readonly number[];
}

/** A part of the row the adapter could not read safely; the reason a review case shows. */
export type RowProblem = "invalid_amount" | "invalid_quantity" | "ambiguous_sub_ids" | "conflicting_sub_ids";

export interface ReportObservation {
  readonly orderId: string;
  readonly problems?: readonly RowProblem[];
  readonly orderStatus: ObservedStatus | null;
  readonly items: readonly ObservedItem[];
}

export type CancelReason = "order_cancelled" | "all_items_cancelled" | "commission_zero";
export type FreezeReason = "missing_order_id" | "unknown_status" | "no_items" | "missing_commission" | RowProblem;

export type ReportSignal =
  | { readonly kind: "CANCEL"; readonly reason: CancelReason }
  | { readonly kind: "FREEZE"; readonly reason: FreezeReason }
  /** `liveItems` are the indexes of the items that are not cancelled. */
  | { readonly kind: "APPROVED" | "AWAITING"; readonly liveItems: readonly number[] };

export function reportSignal(row: ReportObservation): ReportSignal {
  if (row.orderId.trim() === "") return { kind: "FREEZE", reason: "missing_order_id" };
  const [problem] = row.problems ?? [];
  if (problem) return { kind: "FREEZE", reason: problem };
  if (row.orderStatus === "CANCELLED") return { kind: "CANCEL", reason: "order_cancelled" };
  if (row.orderStatus === "UNKNOWN") return { kind: "FREEZE", reason: "unknown_status" };
  if (row.items.length === 0) return { kind: "FREEZE", reason: "no_items" };

  const liveItems = row.items.flatMap((item, i) => (item.status === "CANCELLED" ? [] : [i]));
  const live = liveItems.map((i) => row.items[i] as ObservedItem);
  if (live.length === 0) return { kind: "CANCEL", reason: "all_items_cancelled" };
  if (live.some((item) => item.status === "UNKNOWN")) return { kind: "FREEZE", reason: "unknown_status" };

  const parts = live.flatMap((item) => item.commissionParts);
  if (parts.length === 0) return { kind: "FREEZE", reason: "missing_commission" };
  if (parts.every((part) => part === 0)) return { kind: "CANCEL", reason: "commission_zero" };

  return { kind: live.every((item) => item.status === "APPROVED") ? "APPROVED" : "AWAITING", liveItems };
}
