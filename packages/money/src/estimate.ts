/**
 * The estimated cashback of a Shopee product before anyone buys (FR-1, FR-6, D2, D3; Story 5.6):
 * the commission from the price and the rates the product lookup found, with Shopee's part capped
 * at 40,000 dong and the shop's XTRA part uncapped, then the FR-13 split with the withholding the
 * caller read (the latest payout batch's classification, D59). It is an estimate only: cashback is
 * always computed again from the approved commission (D3), never from this.
 *
 * Each percentage a customer sees comes with its amount in dong for this price (money rule 11), so
 * the parts are returned as well as the total.
 */
import { shopeeCommission } from "./commission";
import { CASHBACK_SHARE_BPS } from "./network-rules";
import { splitCommission } from "./split";

export interface ShopeeEstimateInput {
  readonly price: number;
  readonly shopeeRateBps: number;
  readonly sellerRateBps: number;
  /** Whether a purchase now would be withheld (the latest batch's classification). */
  readonly withheld: boolean;
}

export interface ShopeeEstimate {
  readonly shopeePart: number;
  readonly sellerPart: number;
  readonly commission: number;
  readonly capped: boolean;
  readonly fee: number;
  readonly tax: number;
  readonly cashback: number;
  readonly withheld: boolean;
  /** The customer's share of the net, in basis points (80%). */
  readonly cashbackShareBps: number;
}

export function shopeeEstimate(input: ShopeeEstimateInput): ShopeeEstimate {
  const parts = shopeeCommission(input.price, input.shopeeRateBps, input.sellerRateBps);
  const split = splitCommission({ approvedCommission: parts.commission, network: "shopee", withheld: input.withheld });
  return {
    shopeePart: parts.shopeePart,
    sellerPart: parts.xtraPart,
    commission: parts.commission,
    capped: parts.capped,
    fee: split.fee,
    tax: split.tax,
    cashback: split.cashback,
    withheld: input.withheld,
    cashbackShareBps: Number(CASHBACK_SHARE_BPS),
  };
}
