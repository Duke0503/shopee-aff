/**
 * Reading the Shopee payout record page's batches (FR-19, AD-6, AD-22, D59; Story 4.22; the live
 * `payout_sync.py` read as reference). Each row the page rendered names one payout batch: its id,
 * its payment status, what reached the operator (`totalPaymentAmount`), the batch's gross
 * (`eligibleTotalAmount`), both in Shopee's units (x100,000, converted only by `fromNetworkUnits`),
 * and its creation and arrival times in Unix seconds.
 *
 * The live reader turned every status it did not know into "failed" and every unreadable amount
 * into 0. Here a page is read whole or not at all: a row without the known shape, an unknown
 * status, an amount that is not a plain decimal, a missing creation time, or one batch shown twice
 * with different facts makes the whole page unreadable, so nothing is recorded from it.
 */
import { instantFromMs, type Instant } from "@cashback/core";
import { fromNetworkUnits } from "@cashback/money";

import { SHOPEE_AMOUNT_SCALE } from "./shopee-report";

/** Shopee's `payoutPaymentStatus` values (live `payout_sync.py`): 10 paid, 1 processing, 9 failed. */
export const SHOPEE_PAYOUT_STATUS_MAP: Readonly<Record<string, "PAID" | "PROCESSING" | "FAILED">> = { "10": "PAID", "1": "PROCESSING", "9": "FAILED" };

const PAYOUT_ID = /^[A-Za-z0-9_-]{1,64}$/;
const SECONDS = /^\d{1,12}$/;

export interface ShopeePayoutBatch {
  readonly networkPayoutId: string;
  readonly status: "PAID" | "PROCESSING" | "FAILED";
  /** What reached the operator, whole dong. */
  readonly amount: number;
  /** The batch's gross commission, whole dong. */
  readonly eligibleAmount: number;
  readonly createdAt: Instant;
  /** Null until the money arrived (0 on the page). */
  readonly paidAt: Instant | null;
}

export type PayoutRecordRead = { readonly ok: true; readonly batches: ShopeePayoutBatch[] } | { readonly ok: false; readonly problem: string };

const text = (value: unknown): string | null => (typeof value === "string" ? value.trim() : typeof value === "number" && Number.isFinite(value) ? String(value) : null);

function amountOf(value: unknown): number | null {
  const raw = text(value);
  if (raw === null || raw === "") return null;
  try {
    const dong = fromNetworkUnits(raw, SHOPEE_AMOUNT_SCALE);
    return dong >= 0 ? dong : null;
  } catch {
    return null;
  }
}

/** Unix seconds to an instant; 0 is "not yet" (null), anything unreadable is undefined. */
function timeOf(value: unknown): Instant | null | undefined {
  const raw = text(value);
  if (raw === null || !SECONDS.test(raw)) return undefined;
  const seconds = Number(raw);
  return seconds === 0 ? null : instantFromMs(seconds * 1000);
}

function batchOf(row: Readonly<Record<string, unknown>>): ShopeePayoutBatch | string {
  const id = text(row["payoutId"]);
  if (id === null || !PAYOUT_ID.test(id)) return "a row has no readable payout id";
  const status = SHOPEE_PAYOUT_STATUS_MAP[text(row["payoutPaymentStatus"]) ?? ""];
  if (status === undefined) return `payout ${id} has an unknown status`;
  const amount = amountOf(row["totalPaymentAmount"]);
  const eligibleAmount = amountOf(row["eligibleTotalAmount"]);
  if (amount === null || eligibleAmount === null) return `payout ${id} has an unreadable amount`;
  const createdAt = timeOf(row["payoutCreatedTime"]);
  const paidAt = timeOf(row["payArrivalTime"]);
  if (createdAt === undefined || createdAt === null || paidAt === undefined) return `payout ${id} has an unreadable time`;
  return { networkPayoutId: id, status, amount, eligibleAmount, createdAt, paidAt };
}

export function readShopeePayoutRecords(rows: readonly Readonly<Record<string, unknown>>[]): PayoutRecordRead {
  const batches = new Map<string, ShopeePayoutBatch>();
  for (const row of rows) {
    const batch = batchOf(row);
    if (typeof batch === "string") return { ok: false, problem: batch };
    const before = batches.get(batch.networkPayoutId);
    if (before !== undefined && JSON.stringify(before) !== JSON.stringify(batch)) return { ok: false, problem: `payout ${batch.networkPayoutId} is shown twice with different facts` };
    batches.set(batch.networkPayoutId, batch);
  }
  return { ok: true, batches: [...batches.values()] };
}
