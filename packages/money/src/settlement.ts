/**
 * Network payouts in money terms (D59, FR-13, FR-19). A network pays one batch for many orders:
 * `eligible` is the gross commission of the batch and `received` what reached the operator. The
 * production record (11 Shopee batches, 24/9 to 29/10/2026) shows received = eligible minus the
 * 0.98% fee and, in a withheld batch, minus 10% tax, both on the gross: the FR-13 split. So the
 * withholding of a batch is derived, not assumed: whichever of the two splits of `eligible` lands
 * within the rounding tolerance of `received`.
 *
 * The tolerance: Shopee rounds fee and tax per order, at most half a dong each, so at most 1 dong
 * per order; with an order commission of at least 100 dong that is at most 1% of the gross, and at
 * least 2 dong. The two splits are 10% of the gross apart, so a batch never fits both; one that
 * fits neither is not guessed at (null) and goes to a review case.
 *
 * An order's own figure in a batch is its gross (approved commission) and what the network pays
 * for it under the batch's withholding; a batch's gross minus the gross of the operator's matched
 * orders is the part paid for orders attributed to no customer (guest or unknown sub_id).
 */
import { assertDong, assertNonNegativeDong } from "./rounding";
import type { AffiliateNetwork } from "./network-rules";
import { splitCommission } from "./split";
import { differenceDong, sumDong } from "./clawback";

/** The rounding a batch may be off by: 1 dong per order of at least 100 dong (1%), at least 2 dong. */
export function settlementTolerance(eligible: number): number {
  const gross = BigInt(assertNonNegativeDong(eligible, "eligible"));
  const onePercent = Number((gross + 99n) / 100n);
  return onePercent > 2 ? onePercent : 2;
}

export interface BatchWithholding {
  readonly withheld: boolean;
  /** What the network kept as its fee: eligible minus tax minus received (its own rounding included). */
  readonly fee: number;
  /** 10% of the gross when withheld, half-up; 0 otherwise. */
  readonly tax: number;
  /** What the FR-13 split of `eligible` gives; `received` is within the tolerance of it. */
  readonly expected: number;
  /** received minus expected. */
  readonly deviation: number;
}

/** Whether a batch withheld the tax, read from what it paid; null when neither split fits. */
export function classifyWithholding(network: AffiliateNetwork, eligible: number, received: number): BatchWithholding | null {
  const gross = assertNonNegativeDong(eligible, "eligible");
  const paid = assertNonNegativeDong(received, "received");
  const tolerance = settlementTolerance(gross);
  for (const withheld of [false, true]) {
    const split = splitCommission({ approvedCommission: gross, network, withheld });
    // A network that always withholds has no split without tax (AccessTrade): skip the one that does not exist.
    if (split.tax > 0 !== withheld) continue;
    const deviation = differenceDong(paid, split.net);
    if (Math.abs(deviation) > tolerance) continue;
    const fee = differenceDong(differenceDong(gross, split.tax), paid);
    return { withheld: split.tax > 0, fee: assertNonNegativeDong(fee, "fee"), tax: split.tax, expected: split.net, deviation };
  }
  return null;
}

/** What the network pays for one order of gross `approvedCommission` in a batch of this withholding. */
export function settlementNet(network: AffiliateNetwork, approvedCommission: number, withheld: boolean): number {
  return splitCommission({ approvedCommission, network, withheld }).net;
}

export interface BatchCoverage {
  /** The gross of the operator's orders matched to the batch. */
  readonly matchedGross: number;
  /** eligible minus matchedGross: paid for orders attributed to no customer; negative when the orders exceed the batch. */
  readonly unattributed: number;
  /** True when the orders fit inside the batch (within the tolerance). */
  readonly fits: boolean;
}

/** How a batch's gross is covered by the operator's orders. */
export function batchCoverage(eligible: number, grosses: readonly number[]): BatchCoverage {
  const gross = assertDong(eligible, "eligible");
  const matchedGross = sumDong(grosses, "gross");
  const unattributed = differenceDong(gross, matchedGross);
  return { matchedGross, unattributed, fits: unattributed >= -settlementTolerance(gross) };
}
