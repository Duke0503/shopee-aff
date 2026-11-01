/**
 * One product lookup (Story 5.6; the live `dashboard_lookup.py` read as reference, without its
 * API calls, D8, INV-10): the request's product link, read in this browser on two pages a person
 * would open. The link names the shop and the item (a short link is resolved first, in this
 * browser); the storefront product page gives the name, picture and price (looked at again until
 * the price has rendered too, or the wait ends); then page 1 of the
 * affiliate offer search for the leading words of the name gives the item's rate texts, when the
 * item is on it: the whole texts of its commission and XTRA elements, never a number picked out
 * here. Page 1 only: the job has no page parameter and nothing here pages on.
 *
 * The answer is the page texts as `value`; the server reads the amounts and the rates from them
 * and decides the estimate, so nothing is computed here. A verification or login page is answered
 * as such (the server holds or pauses the queue); a product page that never shows a name is
 * `page_not_ready`. Every wait is in the service worker; each page script looks once and returns.
 */
import type { BridgeFailure, BridgeLookupJob, BridgeLookupValue } from "@cashback/contracts";
import { readShopeeProduct } from "@cashback/core";

import type { PageDriver, Wait } from "./bridge-tab";
import { readOfferResults, readStorefront, type OfferLook, type StorefrontLook } from "./page-scripts";
import { type ResolveLink } from "./short-link";
import { COMMISSION_LABEL, isShopeeLink, KEYWORD_WORDS, OFFER_CARD, OFFER_EMPTY, offerSearchUrl, pageBlock, productPageUrl, STOREFRONT_IMAGE, STOREFRONT_NAME, STOREFRONT_PRICE, XTRA_LABEL } from "./shopee-page";

export type LookupAnswer = { outcome: "value"; value: BridgeLookupValue } | { outcome: "failed"; reason: BridgeFailure };

export const PAGE_WAIT_MS = 15_000;
export const PAGE_POLL_MS = 500;

const STOREFRONT = { name: STOREFRONT_NAME, image: STOREFRONT_IMAGE, price: STOREFRONT_PRICE };
const NOT_FOUND: LookupAnswer = { outcome: "value", value: { found: false } };

export class Blocked extends Error {
  constructor(readonly reason: BridgeFailure) {
    super(reason);
  }
}

const check = (look: { href: string; passwordBox: boolean }): void => {
  const block = pageBlock(look.href, look.passwordBox);
  if (block !== null) throw new Blocked(block);
};

/** The shop and item ids of the job's link, resolving a short link in this browser first. */
async function productIds(url: string, resolve: ResolveLink): Promise<{ shopId: string; itemId: string } | null> {
  const idsOf = (text: string): { shopId: string; itemId: string } | null => {
    const product = readShopeeProduct(text);
    const ids = product.ok && product.productKey !== null ? /^shopee:(\d+)\.(\d+)$/.exec(product.productKey) : null;
    return ids?.[1] && ids[2] ? { shopId: ids[1], itemId: ids[2] } : null;
  };
  const direct = idsOf(url);
  if (direct !== null) return direct;
  const target = await resolve(url);
  return target === null ? null : idsOf(target);
}

/** Looks at the page until `ready` says so or the wait ends; every look checks for a block first (the report job uses it too). */
export async function lookUntil<L extends { href: string; passwordBox: boolean }>(look: () => Promise<L>, ready: (l: L) => boolean, wait: Wait): Promise<L> {
  for (let waited = 0; ; waited += PAGE_POLL_MS) {
    const seen = await look();
    check(seen);
    if (ready(seen) || waited >= PAGE_WAIT_MS) return seen;
    await wait(PAGE_POLL_MS);
  }
}

export const keywordOf = (name: string): string => name.replace(/\s+/g, " ").trim().split(" ").slice(0, KEYWORD_WORDS).join(" ");

export async function runLookupJob(job: BridgeLookupJob, page: PageDriver, wait: Wait, resolve: ResolveLink): Promise<LookupAnswer> {
  if (!isShopeeLink(job.url)) return { outcome: "failed", reason: "bad_job" };
  try {
    const ids = await productIds(job.url, resolve);
    if (ids === null) return NOT_FOUND;
    await page.prepare();
    await page.open(productPageUrl(ids.shopId, ids.itemId));
    // The name renders before the price: look again from here until both show, or the wait ends.
    const store: StorefrontLook = await lookUntil(() => page.run(readStorefront, STOREFRONT), (l) => l.name !== null && l.priceText !== null, wait);
    if (store.name === null) return { outcome: "failed", reason: "page_not_ready" };
    await page.open(offerSearchUrl(keywordOf(store.name)));
    const offer: OfferLook = await lookUntil(() => page.run(readOfferResults, { itemId: ids.itemId, card: OFFER_CARD, empty: OFFER_EMPTY, commissionLabel: COMMISSION_LABEL, xtraLabel: XTRA_LABEL }), (l) => l.state !== "waiting", wait);
    const found = offer.state === "found" ? offer : null;
    const rates = found === null ? null : { commissionTexts: found.commissionTexts, xtraTexts: found.xtraTexts };
    return { outcome: "value", value: { found: true, ...ids, name: store.name.slice(0, 400), imageUrl: store.image !== null && store.image.length <= 2048 ? store.image : null, priceText: store.priceText ?? found?.priceText ?? null, rates } };
  } catch (error) {
    return { outcome: "failed", reason: error instanceof Blocked ? error.reason : "script_error" };
  }
}
