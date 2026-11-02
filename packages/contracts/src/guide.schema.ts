/**
 * The guide's money rules with the server's own figures (FR-13, FR-20, D2, D11, D12, NFR-7; Story
 * 7.7). Every rate and every example amount on the guide comes from this answer, computed by
 * packages/money on the server; the page only places them in the label sentences, so a rate
 * shown to a customer always has its amount in dong (money rule 11) and never drifts from the
 * split the ledger uses.
 *
 *   GET /api/guide   the rates, one worked example (not withheld and withheld) and the Shopee cap at work
 */
import { z } from "zod/mini";

export const GUIDE_PATH = "/api/guide";

const dong = z.int().check(z.minimum(0));
const bps = z.int().check(z.minimum(0), z.maximum(10_000));

const splitSchema = z.object({ fee: dong, tax: dong, net: dong, cashback: dong });

export const guideFiguresSchema = z.object({
  /** The Shopee service fee, the withheld tax and the customer's share of the net, in basis points. */
  feeBps: bps,
  taxBps: bps,
  shareBps: bps,
  /** Shopee's own part of one order's commission is capped at this many dong (D2). */
  shopeeCap: dong,
  /** The worked split: a product, its Shopee rate and the commission they give (under the cap). */
  example: z.object({ price: dong, shopeeRateBps: bps, commission: dong, notWithheld: splitSchema, withheld: splitSchema }),
  /** The cap at work: a dearer product whose Shopee part is capped, plus the shop's XTRA part, which is not. */
  capExample: z.object({ price: dong, shopeeRateBps: bps, xtraRateBps: bps, shopeePart: dong, xtraPart: dong, commission: dong }),
});
export type GuideFigures = z.infer<typeof guideFiguresSchema>;
