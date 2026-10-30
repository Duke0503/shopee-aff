/**
 * Netting at payout confirm (AD-6, D42): the payout pays the gross payable, minus the open
 * clawbacks it nets. Clawbacks are netted in the order given, each up to what is left of the
 * gross, so the open clawbacks below the gross close and the rest carries forward. The transfer
 * is what is left, never negative; it is 0 for a netting-only payout. Each netting entry is
 * positive, and the transfer equals `payableBalance` for the same figures.
 */
import { sumDong } from "./clawback";
import { assertNonNegativeDong } from "./rounding";

export interface OpenClawback {
  readonly clawbackId: string;
  /** Still owed back, as a positive amount. */
  readonly open: number;
}

export interface NettingEntry {
  readonly clawbackId: string;
  /** The positive netting entry written against the clawback. */
  readonly amount: number;
  /** What the clawback still owes after this entry, positive; 0 when it closes. */
  readonly carried: number;
}

export interface NettingPlan {
  readonly entries: readonly NettingEntry[];
  /** The sum of the netting entries. */
  readonly netted: number;
  /** What leaves the bank: gross minus netted. */
  readonly transfer: number;
  /** What the clawbacks still owe after this payout, positive: carried to the next one. */
  readonly carriedForward: number;
}

export function nettingPlan(gross: number, clawbacks: readonly OpenClawback[]): NettingPlan {
  let left = assertNonNegativeDong(gross, "gross");
  let carriedForward = 0;
  const entries: NettingEntry[] = [];
  for (const c of clawbacks) {
    const open = assertNonNegativeDong(c.open, "open clawback");
    const amount = Math.min(open, left);
    carriedForward = sumDong([carriedForward, open - amount], "carried forward");
    if (amount === 0) continue;
    left -= amount;
    entries.push({ clawbackId: c.clawbackId, amount, carried: open - amount });
  }
  const netted = sumDong(
    entries.map((e) => e.amount),
    "netted",
  );
  return { entries, netted, transfer: left, carriedForward };
}
