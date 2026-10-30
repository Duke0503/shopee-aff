/**
 * The payable balance (AD-6, D11, D27, D42): `gross` is the stored cashback of APPROVED unpaid
 * orders plus CONFIRMED bonuses; `payable = max(0, gross - open clawbacks)`, never negative. The
 * open clawbacks are owed back and shown as deducted at the next payout. Waiting money is an
 * estimate: an awaiting order's estimated commission through the FR-13 split with withholding,
 * the lower figure, so a customer is never promised more than the approval can give.
 */
import { sumDong } from "./clawback";
import type { AffiliateNetwork } from "./network-rules";
import { assertNonNegativeDong } from "./rounding";
import { splitCommission } from "./split";

export interface PayableInput {
  /** Approved unpaid cashback plus confirmed bonuses, whole dong. */
  readonly gross: number;
  /** The open clawbacks as a positive amount (the negative sum of their entries). */
  readonly openClawbacks: number;
}

export function payableBalance(input: PayableInput): number {
  const gross = assertNonNegativeDong(input.gross, "gross");
  return Math.max(0, gross - assertNonNegativeDong(input.openClawbacks, "openClawbacks"));
}

/** The estimate is shown with the 10% withholding, as the live system and the shadow run show it. */
const ESTIMATE_WITHHELD = true;

/** The cashback an awaiting order's estimated commission would give; 0 for a guest or no estimate (D5). */
export function estimatedCashback(estimate: number | null, network: AffiliateNetwork | null, guest = false): number {
  if (estimate === null || network === null || guest || !Number.isSafeInteger(estimate) || estimate < 0) return 0;
  return splitCommission({ approvedCommission: estimate, network, withheld: ESTIMATE_WITHHELD }).cashback;
}

/** The open clawbacks as one positive amount: each clawback's open sum, counted only while negative. */
export function openClawbackTotal(openAmounts: readonly number[]): number {
  return sumDong(
    openAmounts.filter((a) => a < 0).map((a) => -a),
    "open clawbacks",
  );
}
