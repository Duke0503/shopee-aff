/**
 * Shopee's conversion report, as `/api/v3/report/list` returns it through the browser
 * bridge (AD-22, D38). The status map starts from the live `STATUS_MAP` in
 * `src/cashback/shopee/report_reader.py`, read as reference and unchanged, plus `closed`,
 * which status-flows.md lists among Shopee's cancels.
 *
 * Two fields carry a status. `order_status` (UNPAID, PAID, COMPLETED, CANCELLED, ...) is the
 * buyer's order; `display_item_status` (Pending, Validated, Cancelled, ...) is the item's
 * commission, and it decides the item. An item without one falls back to the order's
 * status, as the live reader does. UNPAID means the buyer has not paid yet: AWAITING,
 * never a cancel. A completed or delivered order is still AWAITING: Shopee validates the
 * commission separately, so only validated or approved is APPROVED. `conversion_status`
 * is an undocumented number and is never read.
 *
 * One conversion (a checkout) can hold several orders, and each becomes its own row with
 * every item kept (R3), where the live reader read only the first order's first item.
 * Amounts arrive multiplied by 100,000 and go through `fromNetworkUnits` only; a malformed
 * amount freezes its own order and the rest of the report is read normally.
 */
import { defineStatusMap, mapStatus, normaliseRawStatus } from "./network-status";
import { asArray, asId, asObject, asRawStatus, readAmount, uniqueProblems, type ReportItem, type ReportRow, type RowProblem } from "./report-row";

/** Measured on 2026-09-16 against the amounts the report page prints (report_reader.py). */
export const SHOPEE_AMOUNT_SCALE = 100_000;

export const SHOPEE_STATUS_MAP = defineStatusMap({
  AWAITING: ["pending", "completed", "delivered", "shipping", "to_ship", "processing", "unpaid", "paid"],
  APPROVED: ["validated", "approved"],
  CANCELLED: ["cancelled", "canceled", "invalid", "rejected", "fraud", "closed"],
});

const SUB_ID_COUNT = 5;

export interface ShopeeSubIds {
  /** Always sub_id1 to sub_id5, missing ones empty, the same shape AccessTrade gives. */
  subIds: string[];
  /** More than five pieces: which piece is which customer cannot be known, so the row freezes. */
  ambiguous: boolean;
}

/** Shopee joins the five sub_ids with "-" in `utm_content`; a sub_id is alphanumeric (D7), so "-" only separates. */
export function parseShopeeSubIds(utmContent: unknown): ShopeeSubIds {
  const pieces = (typeof utmContent === "string" ? utmContent : "").split("-");
  const subIds = Array.from({ length: SUB_ID_COUNT }, (_, i) => pieces[i] ?? "");
  return { subIds, ambiguous: pieces.length > SUB_ID_COUNT };
}

function readItem(raw: unknown, index: number, rawOrderStatus: string, problems: RowProblem[]): ReportItem {
  const item = asObject(raw);
  const written = asRawStatus(item["display_item_status"]);
  const rawStatus = normaliseRawStatus(written) === "" ? rawOrderStatus : written;
  const parts = [readAmount(item["item_commission"], SHOPEE_AMOUNT_SCALE, problems), readAmount(item["capped_brand_commission"], SHOPEE_AMOUNT_SCALE, problems)];
  return {
    itemId: asId(item["item_id"]) || String(index + 1),
    rawStatus,
    status: mapStatus(SHOPEE_STATUS_MAP, rawStatus),
    commissionParts: parts.filter((p): p is number => p !== null),
    value: readAmount(item["actual_amount"], SHOPEE_AMOUNT_SCALE, problems),
  };
}

function readOrder(raw: unknown, sub: ShopeeSubIds): ReportRow {
  const order = asObject(raw);
  const rawOrderStatus = asRawStatus(order["order_status"]);
  const hasOrderStatus = normaliseRawStatus(rawOrderStatus) !== "";
  const problems: RowProblem[] = sub.ambiguous ? ["ambiguous_sub_ids"] : [];
  const items = asArray(order["items"]).map((item, i) => readItem(item, i, rawOrderStatus, problems));
  return {
    network: "shopee",
    orderId: asId(order["order_sn"]),
    rawOrderStatus: hasOrderStatus ? rawOrderStatus : null,
    orderStatus: hasOrderStatus ? mapStatus(SHOPEE_STATUS_MAP, rawOrderStatus) : null,
    items,
    subIds: sub.subIds,
    problems: uniqueProblems(problems),
  };
}

/**
 * The rows of one conversion: one per order it holds. A conversion with no order gives one
 * row with an empty order id, which freezes; the checkout id is never used as an order id.
 */
export function readShopeeConversion(raw: unknown): ReportRow[] {
  const conversion = asObject(raw);
  const sub = parseShopeeSubIds(conversion["utm_content"]);
  const orders = asArray(conversion["orders"]);
  if (orders.length === 0) return [readOrder({}, sub)];
  return orders.map((order) => readOrder(order, sub));
}
