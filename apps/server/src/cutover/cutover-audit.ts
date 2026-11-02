/**
 * The cutover numbers audit (Story 8.8, owner request of 2026-11-02): every order, every transfer,
 * every customer's money and every network payout batch of the live copy, compared with the new
 * ledger and recomputed from the live rows alone. Each difference is listed with a reason code;
 * a difference with a documented reason (a live quirk the import report names, or a known live
 * discrepancy) is explained, any other fails the audit and so the cutover. The audit holds order
 * ids, payout ids, batch ids and customer codes only, never a name, a Zalo id or a bank number.
 */
import { differenceDong, sumDong } from "@cashback/money";

import type { AuditSources, LiveOrderRow } from "./audit-sources";
import { liveInstant } from "./audit-sources";
import { liveOrderStatus } from "./order-source";

export interface AuditDifference {
  readonly section: "orders" | "payouts" | "customers" | "batches";
  /** An order id, payout id, customer code or batch id. */
  readonly key: string;
  readonly field: string;
  readonly live: string | number | null;
  readonly imported: string | number | null;
  readonly reason: string;
  readonly explained: boolean;
}

/**
 * Live discrepancies the owner already knows and signed off: the transfer amount differs from the
 * covered cashback and bonuses by this many dong (transfer minus covered), carried over unchanged.
 * Payout 10 was transferred 6 dong less than the stored cashback of its three orders.
 */
export const KNOWN_TRANSFER_DIFFERENCES: Readonly<Record<number, number>> = { 10: -6 };

const show = (v: unknown): string | number | null => (v === null || v === undefined ? null : typeof v === "number" ? v : String(v));

/** The new status the import's rule gives a live order: a paid time makes it PAID (D4), an unknown status FROZEN. */
export function expectedStatus(row: LiveOrderRow): string {
  if (row.paid_at !== null && row.paid_at !== "") return "PAID";
  return liveOrderStatus(row.status) ?? "FROZEN";
}

function noteReason(src: AuditSources, table: string, key: string, kinds: readonly string[]): string | null {
  return (src.notes.get(`${table}:${key}`) ?? []).find((k) => kinds.includes(k)) ?? null;
}

/** Which transfer covers each paid order, as the live rows say: the earliest transfer naming it for the same owner. */
export function liveCoverage(src: AuditSources): { orderPayout: Map<string, number>; uncovered: Map<number, { orderId: string; reason: string }[]> } {
  const orders = new Map(src.liveOrders.map((o) => [o.order_id, o]));
  const orderPayout = new Map<string, number>();
  const uncovered = new Map<number, { orderId: string; reason: string }[]>();
  for (const t of src.transfers) {
    const owner = src.resolve(t.customer_id);
    const named = [...new Set((t.order_ids ?? "").split(",").map((id) => id.trim()).filter((id) => id !== ""))];
    const left: { orderId: string; reason: string }[] = [];
    for (const orderId of named) {
      const order = orders.get(orderId);
      const reason =
        order === undefined ? "transfer_order_missing" : src.resolve(order.customer_id) !== owner ? "transfer_order_other_customer" : expectedStatus(order) !== "PAID" ? "transfer_order_not_paid" : orderPayout.has(orderId) ? "transfer_order_named_twice" : null;
      if (reason === null) orderPayout.set(orderId, t.id);
      else left.push({ orderId, reason });
    }
    if (named.length === 0) left.push({ orderId: "", reason: "transfer_names_no_order" });
    uncovered.set(t.id, left);
  }
  return { orderPayout, uncovered };
}

function compareOrder(src: AuditSources, row: LiveOrderRow, expectedPayout: number | undefined, newPayout: number | undefined, out: AuditDifference[]): void {
  const imported = src.newOrders.get(row.order_id);
  const diff = (field: string, live: unknown, now: unknown, reason: string | null): void => {
    out.push({ section: "orders", key: row.order_id, field, live: show(live), imported: show(now), reason: reason ?? "unexplained", explained: reason !== null });
  };
  if (imported === undefined) return diff("order", row.order_id, null, noteReason(src, "orders", row.order_id, ["order_customer_missing"]));
  const owner = src.resolve(row.customer_id);
  if (owner !== imported.customer_id) diff("customer", src.codeOf(owner), src.codeOf(imported.customer_id), noteReason(src, "orders", row.order_id, ["order_customer_missing"]));
  if (expectedStatus(row) !== imported.status) diff("status", row.status, imported.status, null);
  for (const [field, live, now] of [
    ["order_value", row.order_value, imported.order_value],
    ["estimated_commission", row.estimated_commission, imported.estimated_commission],
    ["approved_commission", row.approved_commission, imported.approved_commission],
  ] as const) {
    if (live !== now) diff(field, live, now, noteReason(src, "orders", row.order_id, ["amount_not_whole_dong"]));
  }
  const guest = owner !== null && src.houseIds.has(owner);
  const cashback = guest ? 0 : row.cashback_amount;
  if (cashback !== imported.cashback) diff("cashback", row.cashback_amount, imported.cashback, noteReason(src, "orders", row.order_id, ["amount_not_whole_dong"]));
  else if (guest && (row.cashback_amount ?? 0) !== 0) diff("cashback", row.cashback_amount, imported.cashback, "house_cashback_zeroed");
  const paidAt = liveInstant("paid_at", row.order_id, row.paid_at);
  if (paidAt !== imported.paid_at) diff("paid_at", row.paid_at, imported.paid_at, noteReason(src, "orders", row.order_id, ["paid_at_missing"]));
  if ((row.platform ?? "shopee") !== imported.platform) diff("platform", row.platform, imported.platform, null);
  if ((row.request_id || null) !== imported.request_id) diff("request", row.request_id, imported.request_id, null);
  if (expectedPayout !== newPayout) diff("payout", expectedPayout ?? null, newPayout ?? null, null);
  // The live confirm screen could mark an order paid without naming it on a transfer: listed by the import, never given a payout.
  else if (expectedPayout === undefined && imported.status === "PAID") diff("payout", null, null, src.paidWithoutPayout.has(row.order_id) ? "paid_without_transfer_live" : null);
}

export function auditOrders(src: AuditSources): { checked: number; statusMap: Record<string, number>; differences: AuditDifference[] } {
  const { orderPayout } = liveCoverage(src);
  const newPayoutOf = new Map(src.items.filter((i) => i.kind === "ORDER" && i.order_id !== null).map((i) => [i.order_id as string, i.payout_id]));
  const differences: AuditDifference[] = [];
  const statusMap: Record<string, number> = {};
  for (const row of src.liveOrders) {
    const now = src.newOrders.get(row.order_id)?.status ?? "missing";
    statusMap[`${row.status}->${now}`] = (statusMap[`${row.status}->${now}`] ?? 0) + 1;
    compareOrder(src, row, orderPayout.get(row.order_id), newPayoutOf.get(row.order_id), differences);
  }
  for (const id of src.newOrders.keys()) if (!src.liveOrders.some((o) => o.order_id === id)) differences.push({ section: "orders", key: id, field: "order", live: null, imported: id, reason: "unexplained", explained: false });
  return { checked: src.liveOrders.length, statusMap, differences };
}

export interface TransferLine {
  readonly payoutId: number;
  readonly customer: string;
  readonly amount: number;
  readonly orders: readonly string[];
  readonly awards: readonly number[];
  readonly covered: number;
  /** Transfer minus covered cashback and bonuses. */
  readonly difference: number;
}

export function auditPayouts(src: AuditSources): { checked: number; lines: TransferLine[]; differences: AuditDifference[] } {
  const { orderPayout, uncovered } = liveCoverage(src);
  const orders = new Map(src.liveOrders.map((o) => [o.order_id, o]));
  const differences: AuditDifference[] = [];
  const lines: TransferLine[] = [];
  for (const t of src.transfers) {
    const key = String(t.id);
    const diff = (field: string, live: unknown, now: unknown, reason: string | null): void => {
      differences.push({ section: "payouts", key, field, live: show(live), imported: show(now), reason: reason ?? "unexplained", explained: reason !== null });
    };
    const owner = src.resolve(t.customer_id);
    const payout = src.newPayouts.get(t.id);
    if (payout === undefined) {
      diff("payout", t.amount, null, noteReason(src, "payouts", key, ["payout_customer_missing", "payout_to_guest", "payout_amount_not_whole_dong"]));
      continue;
    }
    if (payout.transfer_amount !== t.amount) diff("amount", t.amount, payout.transfer_amount, null);
    if (payout.customer_id !== owner) diff("customer", src.codeOf(owner), src.codeOf(payout.customer_id), null);
    const liveOrders = [...orderPayout].filter(([, p]) => p === t.id).map(([o]) => o).sort();
    const liveAwards = src.liveAwards.filter((a) => a.status === "paid" && liveOrders.includes(a.order_id) && src.resolve(a.customer_id) === owner).map((a) => a.id).sort((a, b) => a - b);
    const mine = src.items.filter((i) => i.payout_id === t.id);
    const newOrders = mine.filter((i) => i.kind === "ORDER").map((i) => i.order_id ?? "").sort();
    const newAwards = mine.filter((i) => i.kind === "AWARD").map((i) => i.award_id ?? 0).sort((a, b) => a - b);
    if (liveOrders.join(",") !== newOrders.join(",")) diff("orders", liveOrders.join(","), newOrders.join(","), null);
    if (liveAwards.join(",") !== newAwards.join(",")) diff("awards", liveAwards.join(","), newAwards.join(","), null);
    for (const u of uncovered.get(t.id) ?? []) diff("named_order", u.orderId || null, null, u.reason);
    const liveCovered = sumDong([...liveOrders.map((o) => orders.get(o)?.cashback_amount ?? 0), ...src.liveAwards.filter((a) => liveAwards.includes(a.id)).map((a) => a.amount)], "covered");
    const covered = sumDong(mine.map((i) => i.amount), "covered");
    if (liveCovered !== covered) diff("covered", liveCovered, covered, null);
    const difference = differenceDong(t.amount, covered);
    if (difference !== 0) {
      const known = KNOWN_TRANSFER_DIFFERENCES[t.id] === difference;
      const noOrder = (uncovered.get(t.id) ?? []).some((u) => u.reason === "transfer_names_no_order");
      diff("transfer_vs_covered", t.amount, covered, known ? "known_live_discrepancy" : noOrder ? "transfer_names_no_order" : null);
    }
    lines.push({ payoutId: t.id, customer: src.codeOf(owner), amount: t.amount, orders: newOrders, awards: newAwards, covered, difference });
  }
  for (const id of src.newPayouts.keys()) if (!src.transfers.some((t) => t.id === id)) differences.push({ section: "payouts", key: String(id), field: "payout", live: null, imported: id, reason: "unexplained", explained: false });
  return { checked: src.transfers.length, lines, differences };
}
