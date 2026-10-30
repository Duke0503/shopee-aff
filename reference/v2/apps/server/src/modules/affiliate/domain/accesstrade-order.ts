import { parseOrderTime } from "../../orders";

/**
 * Turning AccessTrade commission lines into plain orders. Ports
 * `providers/accesstrade_reconciler.py::normalize_transactions`.
 *
 * TikTok reports one purchase as several lines -- the product, and often a
 * brand bonus -- and a customer looking at them sees "two orders". They are
 * one purchase: values and commissions are summed. An order counts as approved
 * only once AccessTrade has confirmed every line that was not rejected.
 */
export type AccessTradeTransaction = Record<string, unknown>;

export type AccessTradeOrderStatus = "awaiting_approval" | "approved" | "rejected";

export interface NormalizedAccessTradeOrder {
  orderId: string;
  platform: string;
  subId1: string | null;
  subId2: string | null;
  orderValueVnd: number;
  estimatedCommissionVnd: number;
  approvedCommissionVnd: number | null;
  status: AccessTradeOrderStatus;
  rejectionReason: string | null;
  orderTime: string;
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim() !== "") return value.trim();
  }
  return "";
}

function toNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** The non-empty `_extra.sub_params` of one line, or null. */
function subParams(line: AccessTradeTransaction): Record<string, unknown> | null {
  const extra = line._extra;
  if (extra === null || typeof extra !== "object") return null;
  const params = (extra as Record<string, unknown>).sub_params;
  if (params === null || typeof params !== "object") return null;
  const record = params as Record<string, unknown>;
  return Object.keys(record).length > 0 ? record : null;
}

function platformForMerchant(merchant: unknown): string {
  const name = String(merchant ?? "").toLowerCase();
  if (name.includes("highland")) return "highlands";
  if (name.includes("thecoffeehouse") || name.includes("coffeehouse")) return "thecoffeehouse";
  if (name.includes("lazada")) return "lazada";
  return "tiktok";
}

export function normalizeTransactions(rows: AccessTradeTransaction[]): NormalizedAccessTradeOrder[] {
  const grouped = new Map<string, AccessTradeTransaction[]>();
  for (const row of rows) {
    const orderId = firstString(row.transaction_id, row.order_id);
    if (orderId === "") continue;
    const lines = grouped.get(orderId);
    if (lines) lines.push(row);
    else grouped.set(orderId, [row]);
  }

  const orders: NormalizedAccessTradeOrder[] = [];
  for (const [orderId, lines] of grouped) {
    const first = lines[0] ?? {};
    let subs: Record<string, unknown> | null = null;
    for (const line of lines) subs = subParams(line) ?? subs;
    const subId1 = firstString(subs?.sub1, first.sub1) || null;
    const subId2 = firstString(subs?.sub2, first.sub2) || null;

    let value = 0;
    let commission = 0;
    for (const line of lines) {
      value += toNumber(line.product_price) * (Number(line.product_quantity) || 1);
      commission += toNumber(line.commission);
    }

    const live = lines.filter((line) => (Number(line.status) || 0) !== 2);
    let status: AccessTradeOrderStatus;
    let approved: number | null;
    if (live.length === 0) {
      status = "rejected";
      approved = null;
    } else if (live.every((line) => (Number(line.status) || 0) === 1 && (Number(line.is_confirmed) || 0) === 1)) {
      status = "approved";
      approved = Math.round(live.reduce((total, line) => total + toNumber(line.commission), 0));
    } else {
      status = "awaiting_approval";
      approved = null;
    }

    // Voucher redemptions / CPA campaigns report no product price.
    if (value === 0) {
      value = lines.reduce((total, line) => total + toNumber(line.transaction_value), 0);
      if (value === 0 && commission > 0) value = Math.round(commission);
    }

    const rejectionReason = lines.map((line) => firstString(line.reason_rejected)).find((reason) => reason !== "") ?? null;
    const rawTime = firstString(first.transaction_time, first.created_time);

    orders.push({
      orderId,
      platform: platformForMerchant(first.merchant),
      subId1,
      subId2,
      orderValueVnd: Math.round(value),
      estimatedCommissionVnd: Math.round(commission),
      approvedCommissionVnd: approved,
      status,
      rejectionReason,
      orderTime: parseOrderTime(rawTime, orderId),
    });
  }
  return orders;
}
