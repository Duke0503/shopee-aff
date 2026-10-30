/**
 * The normalized report row every network adapter yields (AD-8): one order with its items,
 * statuses already read through the network's status map, amounts already in whole dong
 * through `fromNetworkUnits`, and the sub_ids the link carried. Nothing downstream reads a
 * raw status or a raw amount. The raw values stay beside the mapped ones for review cases.
 */
import { instantFromMs, parseLegacyTime, type Instant } from "@cashback/core";
import { fromNetworkUnits, type AffiliateNetwork } from "@cashback/money";

import type { NetworkStatus } from "./network-status";

export interface ReportItem {
  readonly itemId: string;
  readonly rawStatus: string;
  readonly status: NetworkStatus;
  /**
   * The commission parts the network reported for this item, each in whole dong:
   * Shopee [Shopee's part, the shop's XTRA part], AccessTrade [the line's commission].
   * A part the report left out is absent, never 0: 0 is a cancel signal (D31).
   */
  readonly commissionParts: readonly number[];
  /** What the buyer paid for the item, in whole dong, when the report says. */
  readonly value: number | null;
}

/**
 * Something in the row that cannot be read safely. Any problem freezes the order for a
 * review case; the other rows of the same report are read normally.
 */
export type RowProblem = "invalid_amount" | "invalid_quantity" | "ambiguous_sub_ids" | "conflicting_sub_ids";

export interface ReportRow {
  readonly network: AffiliateNetwork;
  /** Empty when the report carries no order id; such a row freezes (D31). */
  readonly orderId: string;
  /** Null when the network reports no order-level status (AccessTrade). */
  readonly rawOrderStatus: string | null;
  readonly orderStatus: NetworkStatus | null;
  readonly items: readonly ReportItem[];
  /** sub_id1 to sub_id5 as the link carried them; sub_id1 is the customer id. */
  readonly subIds: readonly string[];
  /** Empty for a row read cleanly. */
  readonly problems: readonly RowProblem[];
}

type Json = Record<string, unknown>;

export function asObject(value: unknown): Json {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Json) : {};
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** A report id as text: numbers and strings are kept, anything else is empty. */
export function asId(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
  return "";
}

/** A raw status as the report wrote it, for display beside the mapped one. */
export function asRawStatus(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

/** True when the report carries an amount in this field (0 included). */
export function hasAmount(value: unknown): value is number | string {
  return (typeof value === "number" && Number.isFinite(value)) || (typeof value === "string" && value.trim() !== "");
}

/**
 * A report amount in whole dong through `fromNetworkUnits`, or null when the field is
 * absent. A malformed amount ("1,234", "N/A", "1e5") is recorded as a problem on the row
 * and read as absent, so one bad field never fails the whole report.
 */
export function readAmount(value: unknown, scale: number, problems: RowProblem[]): number | null {
  if (!hasAmount(value)) return null;
  try {
    return fromNetworkUnits(value, scale);
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    problems.push("invalid_amount");
    return null;
  }
}

/**
 * When the buyer purchased, as a report gives it: Unix seconds (Shopee's `purchase_time`) or
 * a time text, naive text read as Vietnam time (the networks' dashboards are in Vietnam
 * time). Null when absent or unreadable; it only places the row in a report window.
 */
export function readPurchaseTime(value: unknown): Instant | null {
  const seconds = typeof value === "number" ? value : typeof value === "string" && /^\s*\d{9,11}\s*$/.test(value) ? Number(value) : null;
  if (seconds !== null) return Number.isSafeInteger(seconds) && seconds > 0 ? instantFromMs(seconds * 1000) : null;
  if (typeof value !== "string") return null;
  return parseLegacyTime(value, "VN")?.instant ?? null;
}

/** Each problem once, in the order first seen. */
export const uniqueProblems = (problems: readonly RowProblem[]): RowProblem[] => [...new Set(problems)];
