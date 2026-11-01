/**
 * Reading a product lookup's answer (Story 5.6, D8, D56). The bridge answers the texts the two
 * pages showed: the storefront's name, image and price, and the offer search's commission rates
 * for the item when it was on page 1. Nothing is computed or extracted in the browser, so the
 * price and the rates are read here, exactly or not at all: a wrong estimate is worse than none.
 * A price text that is not one plain amount (a range, a "from" price, two amounts) gives null.
 * The rates come from the whole texts of the card's elements labelled as the commission and as
 * XTRA: each must hold exactly one percentage and all must agree, or there is no rate. A card that
 * shows XTRA whose percentage cannot be read gives no rate at all, never an XTRA of 0%. No rate
 * means no estimate (a dash), never 0%.
 *
 * Rate meaning, as the live `dashboard_lookup.py` verified on 20 products: the offer shows the
 * total commission rate, the shop's XTRA rate included, and the XTRA rate on its own; Shopee's own
 * rate is their difference. An XTRA rate above the total is unreadable, so both are dropped.
 */

/** A lookup's value once the command checked it against the bridge contract (`bridgeLookupValueSchema`). */
export type LookupPageTexts =
  | { readonly found: false }
  | {
      readonly found: true;
      readonly shopId: string;
      readonly itemId: string;
      readonly name: string | null;
      readonly imageUrl: string | null;
      readonly priceText: string | null;
      /** The whole texts of the card's elements labelled as the commission and as XTRA. */
      readonly rates: { readonly commissionTexts: readonly string[]; readonly xtraTexts: readonly string[] } | null;
    };

/** The product facts a lookup found, rates in basis points of the price. */
export interface ProductFacts {
  /** The Shopee item id: the `product_offers` key, as the cutover import keys it. */
  readonly productOfferId: string;
  readonly shopId: string;
  readonly name: string | null;
  readonly imageUrl: string | null;
  readonly price: number | null;
  /** Null when the product was not on page 1 of the offer search, or its rates were unreadable. */
  readonly shopeeRateBps: number | null;
  readonly sellerRateBps: number | null;
}

/** A dong amount as a page writes it: `450.000`, `450,000`, `450000`, with an optional dong sign. */
const AMOUNT = /^(?:\u20ab\s*)?(\d{1,3}(?:([.,])\d{3})(?:\2\d{3})*|\d{1,12})\s*(?:\u20ab|\u0111|vnd)?$/i;
/** A percentage with at most two decimals, with a dot or a comma: `7,5%`, `2.6 %`, `10%`. */
const PERCENT = /^(\d{1,3})(?:[.,](\d{1,2}))?\s*%$/;

/** A price text as whole dong, or null when it is not one plain amount (a range, a "from" price, empty). */
export function readPriceText(text: string | null): number | null {
  const m = text === null ? null : AMOUNT.exec(text.trim());
  if (!m?.[1]) return null;
  const value = Number(m[1].replace(/[.,]/g, ""));
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

/** A percentage text as basis points, read from its digits (no float maths), or null. */
export function readRateText(text: string | null): number | null {
  const m = text === null ? null : PERCENT.exec(text.trim());
  if (!m?.[1]) return null;
  const bps = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
  return bps <= 10_000 ? bps : null;
}

/** Every percentage in a text, each at most two decimals, not part of a longer number. */
const PERCENT_TOKEN = /(?<![\d.,])(\d{1,3})(?:[.,](\d{1,2}))?\s*%/g;

/**
 * The one percentage a set of labelled texts agrees on, as basis points; "absent" when there is
 * no labelled text; null when a text holds no percentage or several, or the texts disagree.
 */
export function labelledRate(texts: readonly string[]): number | null | "absent" {
  if (texts.length === 0) return "absent";
  const found = new Set<number>();
  for (const text of texts) {
    const tokens = [...text.matchAll(PERCENT_TOKEN)];
    if (tokens.length !== 1 || !tokens[0]?.[0]) return null;
    const bps = readRateText(tokens[0][0]);
    if (bps === null) return null;
    found.add(bps);
  }
  return found.size === 1 ? ([...found][0] ?? null) : null;
}

const NO_RATES = { shopeeRateBps: null, sellerRateBps: null } as const;

/** Shopee's own rate and the XTRA rate from the labelled texts; both null when anything is unreadable or ambiguous. */
export function splitRates(commissionTexts: readonly string[], xtraTexts: readonly string[]): { shopeeRateBps: number | null; sellerRateBps: number | null } {
  const total = labelledRate(commissionTexts);
  const xtra = labelledRate(xtraTexts);
  if (total === null || total === "absent" || xtra === null) return NO_RATES;
  const seller = xtra === "absent" ? 0 : xtra;
  return seller > total ? NO_RATES : { shopeeRateBps: total - seller, sellerRateBps: seller };
}

/** Only an https image is kept: a share page never loads an image over plain http. */
const httpsOnly = (url: string | null): string | null => (url !== null && url.startsWith("https://") ? url : null);

/** The facts on the two pages, or null when the link named no product the storefront showed. */
export function readLookupFacts(v: LookupPageTexts): ProductFacts | null {
  if (!v.found) return null;
  const rates = v.rates === null ? { shopeeRateBps: null, sellerRateBps: null } : splitRates(v.rates.commissionTexts, v.rates.xtraTexts);
  return { productOfferId: v.itemId, shopId: v.shopId, name: v.name, imageUrl: httpsOnly(v.imageUrl), price: readPriceText(v.priceText), ...rates };
}
