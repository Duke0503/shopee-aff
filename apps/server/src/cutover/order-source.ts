/**
 * Reading orders from the live copy (Story 2.3): each live order becomes one imported order with
 * its stored amounts, status and paid time, every time converted by its column rule. Nothing is
 * recomputed (D34). The live statuses map one to one (repository.py:25-28); a status that maps to
 * nothing is imported FROZEN, so it counts in no total, and listed, never guessed. An order with
 * `paid_at` set is PAID whatever its live status (D4); a paid order with no readable paid time
 * stays PAID and is listed. A guest (HOUSE) order is kept on HOUSE with cashback 0 (D5).
 */
import type { OrderStatus } from "@cashback/core";
import type BetterSqlite3 from "better-sqlite3";

import type { ImportedOrder } from "../modules/orders/index";
import { networkOfPlatform, ownerOf, type CutoverContext } from "./cutover-context";
import type { ImportReport } from "./import-report";
import { convertLiveTime } from "./live-time";
import { wholeDong } from "./live-values";

export interface LiveOrder {
  order_id: string;
  customer_id: string | null;
  request_id: string | null;
  order_value: unknown;
  estimated_commission: unknown;
  approved_commission: unknown;
  cashback_amount: unknown;
  status: string;
  rejection_reason: string | null;
  recorded_at: unknown;
  approved_at: unknown;
  paid_at: unknown;
  updated_at: unknown;
  platform: string;
  notified_status: string | null;
  payout_batch_id: string | null;
  settled_at: unknown;
}

/** The live order statuses (repository.py:25-28). */
export const LIVE_ORDER_STATUS: Readonly<Record<string, OrderStatus>> = {
  awaiting_approval: "AWAITING_APPROVAL",
  approved: "APPROVED",
  paid: "PAID",
  rejected: "REJECTED",
};

export const liveOrderStatus = (status: string): OrderStatus | null => (Object.hasOwn(LIVE_ORDER_STATUS, status) ? (LIVE_ORDER_STATUS[status] ?? null) : null);

type AmountColumn = "order_value" | "estimated_commission" | "approved_commission" | "cashback_amount";

function amount(row: LiveOrder, column: AmountColumn, report: ImportReport): number | null {
  const value = row[column];
  if (value === null || value === undefined) return null;
  const dong = wholeDong(value, { allowZero: true });
  if (dong !== null) return dong;
  report.notes.push({ kind: "amount_not_whole_dong", table: "orders", key: row.order_id, detail: column });
  return null;
}

function statusOf(row: LiveOrder, paidAt: string | null, report: ImportReport): OrderStatus {
  const mapped = liveOrderStatus(row.status);
  if (paidAt !== null || row.paid_at) {
    if (mapped !== "PAID") report.notes.push({ kind: "paid_at_status_conflict", table: "orders", key: row.order_id, detail: row.status });
    if (paidAt === null) report.notes.push({ kind: "paid_at_missing", table: "orders", key: row.order_id });
    return "PAID";
  }
  if (mapped === "PAID") report.notes.push({ kind: "paid_at_missing", table: "orders", key: row.order_id });
  if (mapped !== null) return mapped;
  report.notes.push({ kind: "unknown_order_status", table: "orders", key: row.order_id, detail: row.status });
  return "FROZEN";
}

function customerOf(row: LiveOrder, context: CutoverContext, report: ImportReport): string | null {
  const owner = ownerOf(context, row.customer_id);
  if (owner === null) {
    if (row.customer_id) report.notes.push({ kind: "order_customer_missing", table: "orders", key: row.order_id });
    return null;
  }
  if (owner.via === "alias") report.notes.push({ kind: "order_customer_via_alias", table: "orders", key: row.order_id });
  return owner.customerId;
}

function cashbackOf(row: LiveOrder, customerId: string | null, status: OrderStatus, context: CutoverContext, report: ImportReport): number | null {
  const stored = amount(row, "cashback_amount", report);
  if (customerId !== null && context.houseIds.has(customerId)) {
    if (stored !== null && stored !== 0) report.notes.push({ kind: "house_cashback_zeroed", table: "orders", key: row.order_id, detail: String(stored) });
    return 0;
  }
  if (status === "PAID" && stored === null) report.notes.push({ kind: "paid_cashback_missing", table: "orders", key: row.order_id });
  return stored;
}

function orderOf(row: LiveOrder, context: CutoverContext, requestIds: ReadonlySet<string>, report: ImportReport): ImportedOrder {
  const at = (column: string) => ({ table: "orders", column, key: row.order_id, orderId: row.order_id });
  const time = (column: string, value: unknown) => convertLiveTime(value, at(column), report).instant;
  const recorded = convertLiveTime(row.recorded_at, at("recorded_at"), report);
  const paidAt = time("paid_at", row.paid_at);
  const status = statusOf(row, paidAt, report);
  const customerId = customerOf(row, context, report);
  const network = networkOfPlatform(row.platform);
  if (network === null) report.notes.push({ kind: "unknown_platform", table: "orders", key: row.order_id, detail: row.platform });
  if (row.request_id && !requestIds.has(row.request_id)) report.notes.push({ kind: "order_request_missing", table: "orders", key: row.order_id });
  return {
    orderId: row.order_id,
    network,
    platform: row.platform,
    customerId,
    requestId: row.request_id || null,
    status,
    orderValue: amount(row, "order_value", report),
    estimatedCommission: amount(row, "estimated_commission", report),
    approvedCommission: amount(row, "approved_commission", report),
    cashback: cashbackOf(row, customerId, status, context, report),
    rejectionReason: row.rejection_reason || null,
    recordedAt: recorded.instant,
    recordedAtApproximate: recorded.approximate,
    approvedAt: time("approved_at", row.approved_at),
    paidAt,
    networkBatchId: row.payout_batch_id || null,
    settledAt: time("settled_at", row.settled_at),
    updatedAt: time("updated_at", row.updated_at),
  };
}

export function readLiveOrderRows(source: BetterSqlite3.Database): LiveOrder[] {
  return source.prepare("SELECT * FROM orders ORDER BY order_id").all() as LiveOrder[];
}

/** Reads every live order; `requestIds` are the live link request ids, for the missing-request note. */
export function readLiveOrders(rows: readonly LiveOrder[], context: CutoverContext, requestIds: ReadonlySet<string>, report: ImportReport): ImportedOrder[] {
  return rows.map((row) => orderOf(row, context, requestIds, report));
}
