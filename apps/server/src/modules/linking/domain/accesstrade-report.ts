/**
 * AccessTrade's `/v1/transactions` lines (AD-22). The shapes and readings follow the live
 * `src/cashback/providers/accesstrade_reconciler.py`, read as reference and unchanged.
 *
 * A line's `status` is a code: 0 pending, 1 approved, 2 rejected. An approved line counts
 * only once AccessTrade has also confirmed it (`is_confirmed` 1, read the way the live
 * code's `int(x or 0)` reads it); until then it is still AWAITING. Any other code, or none,
 * is UNKNOWN (D38; the live code read a missing code as 0). One purchase arrives as several
 * lines sharing a `transaction_id`; they become the items of one order. A line with no id
 * at all is never grouped with another: it becomes its own row, which freezes, where the
 * live code dropped it. AccessTrade reports no order-level status.
 *
 * Commissions and prices are dong, as numbers or decimal strings, read through the money
 * package with scale 1. An item's value is price x quantity (quantity missing or 0 counts
 * as 1, as `int(q or 1)` does). The sub_ids come from the last line with non-empty
 * `_extra.sub_params`, as the live code keeps them; lines naming two customers freeze (D7).
 * A malformed amount or quantity freezes its own order only.
 */
import { fromNetworkUnitsTimes } from "@cashback/money";

import { defineStatusMap, mapStatus, type NetworkStatus } from "./network-status";
import { asId, asObject, asRawStatus, hasAmount, readAmount, uniqueProblems, type ReportItem, type ReportRow, type RowProblem } from "./report-row";

export const ACCESSTRADE_AMOUNT_SCALE = 1;

export const ACCESSTRADE_STATUS_MAP = defineStatusMap({
  AWAITING: ["0"],
  APPROVED: ["1"],
  CANCELLED: ["2"],
});

const SUB_ID_KEYS = ["sub1", "sub2", "sub3", "sub4", "sub5"] as const;

type Line = Record<string, unknown>;

/**
 * Python's `int(value or fallback)`: a falsy value takes the fallback, a boolean is 1 or
 * 0, a number is truncated, text is trimmed digits with an optional sign. Null where
 * Python would raise ("1.0", "yes", an object).
 */
export function pythonInt(value: unknown, fallback: number): number | null {
  if (value === null || value === undefined || value === "" || value === 0 || value === false) return fallback;
  if (value === true) return 1;
  if (typeof value === "number") return Number.isFinite(value) ? Math.trunc(value) : null;
  if (typeof value === "string" && /^\s*[+-]?\d+\s*$/.test(value)) return Number.parseInt(value.trim(), 10);
  return null;
}

/** A line's meaning: its status code, with an approved but unconfirmed line still awaiting. */
export function mapAccessTradeLine(status: unknown, isConfirmed: unknown): NetworkStatus {
  const mapped = mapStatus(ACCESSTRADE_STATUS_MAP, status);
  if (mapped !== "APPROVED") return mapped;
  const confirmed = pythonInt(isConfirmed, 0);
  if (confirmed === null) return "UNKNOWN";
  return confirmed === 1 ? "APPROVED" : "AWAITING";
}

function subParams(line: Line): Line {
  return asObject(asObject(line["_extra"])["sub_params"]);
}

/** The last non-empty sub_params, each key falling back to the first line's top-level value. */
function subIdsOf(lines: readonly Line[], problems: RowProblem[]): string[] {
  const nonEmpty = lines.map(subParams).filter((params) => Object.keys(params).length > 0);
  const params = nonEmpty.at(-1) ?? {};
  const first = lines[0] ?? {};
  const customers = new Set(lines.map((line) => asId(subParams(line)["sub1"]) || asId(line["sub1"])).filter((id) => id !== ""));
  if (customers.size > 1) problems.push("conflicting_sub_ids");
  return SUB_ID_KEYS.map((key) => asId(params[key]) || asId(first[key]));
}

/** Quantity as a whole number of at least 1, or null (a problem) when it is not one. */
function quantityOf(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "" || raw === 0 || raw === false) return 1;
  if (typeof raw === "number") return Number.isSafeInteger(raw) && raw >= 1 ? raw : null;
  if (typeof raw === "string" && /^\s*\d+\s*$/.test(raw)) {
    const n = Number.parseInt(raw.trim(), 10);
    return n >= 1 ? n : null;
  }
  return null;
}

function valueOf(line: Line, problems: RowProblem[]): number | null {
  const quantity = quantityOf(line["product_quantity"]);
  if (quantity === null) {
    problems.push("invalid_quantity");
    return null;
  }
  const price = line["product_price"];
  if (!hasAmount(price)) return null;
  try {
    return fromNetworkUnitsTimes(price, ACCESSTRADE_AMOUNT_SCALE, quantity);
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    problems.push("invalid_amount");
    return null;
  }
}

function readLine(line: Line, index: number, problems: RowProblem[]): ReportItem {
  const commission = readAmount(line["commission"], ACCESSTRADE_AMOUNT_SCALE, problems);
  return {
    itemId: asId(line["id"]) || asId(line["product_id"]) || String(index + 1),
    rawStatus: asRawStatus(line["status"]),
    status: mapAccessTradeLine(line["status"], line["is_confirmed"]),
    commissionParts: commission === null ? [] : [commission],
    value: valueOf(line, problems),
  };
}

function readGroup(orderId: string, lines: readonly Line[]): ReportRow {
  const problems: RowProblem[] = [];
  const items = lines.map((line, i) => readLine(line, i, problems));
  const subIds = subIdsOf(lines, problems);
  return { network: "accesstrade", orderId, rawOrderStatus: null, orderStatus: null, items, subIds, problems: uniqueProblems(problems) };
}

/** One row per transaction id, in the order the transactions first appear; a line with no id is a row of its own. */
export function readAccessTradeTransactions(lines: readonly unknown[]): ReportRow[] {
  const groups: { orderId: string; lines: Line[] }[] = [];
  const byId = new Map<string, Line[]>();
  for (const raw of lines) {
    const line = asObject(raw);
    const orderId = asId(line["transaction_id"]) || asId(line["order_id"]);
    const existing = orderId === "" ? undefined : byId.get(orderId);
    if (existing) {
      existing.push(line);
      continue;
    }
    const group = { orderId, lines: [line] };
    groups.push(group);
    if (orderId !== "") byId.set(orderId, group.lines);
  }
  return groups.map((group) => readGroup(group.orderId, group.lines));
}
