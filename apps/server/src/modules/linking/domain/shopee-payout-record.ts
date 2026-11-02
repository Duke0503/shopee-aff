/**
 * Reading the Shopee payout record page's batches (FR-19, AD-6, AD-22, D59; Story 4.22; the live
 * `payout_sync.py` read as reference). Each row the page rendered names one payout batch: its id,
 * its payment status, what reached the operator (`totalPaymentAmount`), the batch's gross
 * (`eligibleTotalAmount`), both in Shopee's units (x100,000, converted only by `fromNetworkUnits`),
 * and its creation and arrival times in Unix seconds.
 *
 * The live reader turned every status it did not know into "failed" and every unreadable amount
 * into 0. Here a row without the known shape, an amount that is not a plain decimal, a missing
 * creation time, or one batch shown twice with different facts makes the whole page unreadable,
 * so nothing is recorded from it. A status this map does not know skips only that batch: it is
 * named in `skipped` (id and the raw status code only) for a warning, and the other batches are
 * still read, so one new Shopee status never stops the payout record.
 */
import { instantFromMs, type Instant } from "@cashback/core";
import { fromNetworkUnits } from "@cashback/money";

import { SHOPEE_AMOUNT_SCALE } from "./shopee-report";

/**
 * Shopee's `payoutPaymentStatus` values as the live `payout_sync.py` stored them: 10 paid,
 * 1 processing, anything else failed. The live payout_batches rows hold 10, 1 and 2 (the batch of
 * 2026-10-29, stored `failed`, no arrival time); 9 is the failed code its comment names. Only
 * these are mapped: an unknown code is skipped, never guessed. 2 is read as processing (owner
 * decision 2026-11-02): it has no arrival time yet and may still turn into 10, which a final
 * FAILED would refuse.
 */
export const SHOPEE_PAYOUT_STATUS_MAP: Readonly<Record<string, "PAID" | "PROCESSING" | "FAILED">> = { "10": "PAID", "1": "PROCESSING", "2": "PROCESSING", "9": "FAILED" };

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

/** A batch left out for its status: its id and the raw status code (digits only, else `unreadable`). */
export interface SkippedPayoutBatch {
  readonly networkPayoutId: string;
  readonly status: string;
}

export type PayoutRecordRead = { readonly ok: true; readonly batches: ShopeePayoutBatch[]; readonly skipped: SkippedPayoutBatch[] } | { readonly ok: false; readonly problem: string };

const STATUS_CODE = /^\d{1,6}$/;

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

function batchOf(row: Readonly<Record<string, unknown>>): ShopeePayoutBatch | SkippedPayoutBatch | string {
  const id = text(row["payoutId"]);
  if (id === null || !PAYOUT_ID.test(id)) return "a row has no readable payout id";
  const code = text(row["payoutPaymentStatus"]) ?? "";
  const status = Object.hasOwn(SHOPEE_PAYOUT_STATUS_MAP, code) ? SHOPEE_PAYOUT_STATUS_MAP[code] : undefined;
  if (status === undefined) return { networkPayoutId: id, status: STATUS_CODE.test(code) ? code : "unreadable" };
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
  const skipped: SkippedPayoutBatch[] = [];
  for (const row of rows) {
    const batch = batchOf(row);
    if (typeof batch === "string") return { ok: false, problem: batch };
    if (!("amount" in batch)) {
      skipped.push(batch);
      continue;
    }
    const before = batches.get(batch.networkPayoutId);
    if (before !== undefined && JSON.stringify(before) !== JSON.stringify(batch)) return { ok: false, problem: `payout ${batch.networkPayoutId} is shown twice with different facts` };
    batches.set(batch.networkPayoutId, batch);
  }
  return { ok: true, batches: [...batches.values()], skipped };
}
