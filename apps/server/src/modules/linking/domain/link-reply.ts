/**
 * The facts a link reply and the share page show for one link request (FR-1, FR-6, D3, D5, D56;
 * Stories 5.6, 5.8): the product snapshot taken when the link was made, and the estimated
 * cashback computed in `packages/money` from it. The estimate is flagged as one: cashback is
 * always computed again from the approved commission (D3). Every percentage in it comes with its
 * amount in dong for this price (money rule 11): Shopee's rate, the shop's XTRA rate and the
 * customer's 80% share.
 *
 * No estimate is made without a price and a rate (the lookup found none, or the product was not on
 * page 1): the reply shows a dash, never 0 dong or a placeholder. A guest link (HOUSE) earns
 * nothing (D5), so it gets no estimate at all and the guest warning instead.
 *
 * A ShopeeFood link (D60, Story 5.11) names a shop, whose commission depends on what is ordered:
 * it carries no amount at all, and the reply says cashback is counted per shop once the order is
 * approved (`SHOPEEFOOD_REPLY_KEY`).
 */
import { shopeeEstimate } from "@cashback/money";

/** The message of a ShopeeFood link in place of an estimate (packages/labels/vi/messages.json). */
export const SHOPEEFOOD_REPLY_KEY = "link_shopeefood_per_shop";

export interface ProductSnapshotFacts {
  readonly network: "shopee" | "accesstrade";
  /** `shopeefood` for a ShopeeFood link (D60); absent or another value for a product. */
  readonly platform?: string | null;
  readonly productName: string | null;
  readonly productImageUrl: string | null;
  readonly productPrice: number | null;
  readonly shopeeRateBps: number | null;
  readonly sellerRateBps: number | null;
}

/** A percentage of something and what it comes to in dong. */
export interface RateExample {
  readonly part: "shopee" | "seller" | "customer_share";
  readonly rateBps: number;
  readonly amount: number;
}

export interface LinkEstimate {
  /** Always true: this is never the amount paid (D3). */
  readonly estimate: true;
  readonly cashback: number;
  readonly commission: number;
  readonly capped: boolean;
  readonly withheld: boolean;
  /** Shopee's rate of the price, the XTRA rate of the price (when any), and the customer's share of the net. */
  readonly rates: readonly RateExample[];
}

export interface LinkReplyData {
  readonly product: { readonly name: string | null; readonly imageUrl: string | null; readonly price: number | null };
  readonly guest: boolean;
  /** Null when no estimate can be made: shown as a dash. */
  readonly estimate: LinkEstimate | null;
  /** A ShopeeFood link: no amount, this message in its place (`SHOPEEFOOD_REPLY_KEY`); null otherwise. */
  readonly perShopKey: typeof SHOPEEFOOD_REPLY_KEY | null;
}

export interface ReplyContext {
  readonly guest: boolean;
  /** Whether a purchase now would be withheld: the network's latest payout batch (D59). */
  readonly withheld: boolean;
}

function estimateOf(s: ProductSnapshotFacts, withheld: boolean): LinkEstimate | null {
  if (s.network !== "shopee" || s.productPrice === null || s.shopeeRateBps === null) return null;
  const e = shopeeEstimate({ price: s.productPrice, shopeeRateBps: s.shopeeRateBps, sellerRateBps: s.sellerRateBps ?? 0, withheld });
  const rates: RateExample[] = [{ part: "shopee", rateBps: s.shopeeRateBps, amount: e.shopeePart }];
  if ((s.sellerRateBps ?? 0) > 0) rates.push({ part: "seller", rateBps: s.sellerRateBps ?? 0, amount: e.sellerPart });
  rates.push({ part: "customer_share", rateBps: e.cashbackShareBps, amount: e.cashback });
  return { estimate: true, cashback: e.cashback, commission: e.commission, capped: e.capped, withheld: e.withheld, rates };
}

export function linkReplyData(snapshot: ProductSnapshotFacts, context: ReplyContext): LinkReplyData {
  const perShop = snapshot.platform === "shopeefood";
  return {
    product: { name: snapshot.productName, imageUrl: snapshot.productImageUrl, price: perShop ? null : snapshot.productPrice },
    guest: context.guest,
    estimate: context.guest || perShop ? null : estimateOf(snapshot, context.withheld),
    perShopKey: perShop && !context.guest ? SHOPEEFOOD_REPLY_KEY : null,
  };
}
