import { estimateCashback, splitCommission, type Split } from "@mmo/money";

/**
 * The money behind one order, as the staff screen explains it. Pure: it reads no
 * database and writes nothing, and every amount comes from the shared
 * `packages/money` split, so this screen can never disagree with the ledger.
 *
 * `basis` says what the figures are:
 *
 *   `approved` — the commission the platform actually approved, split with the
 *                CURRENT period's withholding flag, so the tax line is the tax
 *                that really applies and `operatorKeepsVnd` is the real figure.
 *                (The old console always assumed the 10%, which understated what
 *                we keep in a period that is not withheld.)
 *   `estimate` — nothing is approved yet. These are the assumptions behind the
 *                number the customer is shown while waiting: the 10% is always
 *                assumed, exactly as the "still with the shop" estimate does.
 *   `none`     — no money to show: a rejected order, or one with no commission.
 */
export type BreakdownBasis = "approved" | "estimate" | "none";

/** Kept local so Admin does not have to import the Orders module's types. */
export type BreakdownStatus = "awaiting_approval" | "approved" | "paid" | "rejected";

export interface OrderBreakdown {
  basis: BreakdownBasis;
  commissionVnd: number;
  serviceFeeVnd: number;
  withheldTaxVnd: number;
  netVnd: number;
  cashbackVnd: number;
  operatorKeepsVnd: number;
  operatorMarginPercent: number;
}

export interface BreakdownInput {
  status: BreakdownStatus;
  approvedCommissionVnd: number | null;
  estimatedCommissionVnd: number | null;
  /** The cashback saved when the order was approved, when there is one. */
  savedCashbackVnd: number | null;
  cashbackRate: number;
  periodIsWithheld: boolean;
}

const NOTHING: OrderBreakdown = {
  basis: "none",
  commissionVnd: 0,
  serviceFeeVnd: 0,
  withheldTaxVnd: 0,
  netVnd: 0,
  cashbackVnd: 0,
  operatorKeepsVnd: 0,
  operatorMarginPercent: 0,
};

const percentOf = (part: number, whole: number): number =>
  whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0;

function summarise(basis: BreakdownBasis, split: Split, cashbackVnd: number): OrderBreakdown {
  const netVnd = split.approvedCommission - split.serviceFee - split.withheldTax;
  const operatorKeepsVnd = netVnd - cashbackVnd;
  return {
    basis,
    commissionVnd: split.approvedCommission,
    serviceFeeVnd: split.serviceFee,
    withheldTaxVnd: split.withheldTax,
    netVnd,
    cashbackVnd,
    operatorKeepsVnd,
    operatorMarginPercent: percentOf(operatorKeepsVnd, netVnd),
  };
}

export function orderBreakdown(input: BreakdownInput): OrderBreakdown {
  if (input.status === "rejected") return { ...NOTHING };

  const approved = input.approvedCommissionVnd ?? 0;
  if (approved > 0) {
    const split = splitCommission(approved, input.cashbackRate, input.periodIsWithheld);
    return summarise("approved", split, input.savedCashbackVnd ?? split.customerReceives);
  }

  const estimated = input.estimatedCommissionVnd ?? 0;
  if (estimated > 0) {
    // The estimate the customer sees assumes the tax, so the explanation of it
    // must too — otherwise the parts would not add up to the number on screen.
    const split = splitCommission(estimated, input.cashbackRate, true);
    const cashbackVnd = input.savedCashbackVnd ?? estimateCashback(estimated, input.cashbackRate);
    return summarise("estimate", split, cashbackVnd);
  }

  return { ...NOTHING };
}
