/**
 * The guide's figures (FR-13, FR-20, D2, D11, D12, NFR-7; Story 7.7): the rates, one worked
 * example and the Shopee cap at work, computed by packages/money with the commission rule and the
 * split the ledger itself uses, so the guide can never state a rate without its amount in dong or
 * drift from what customers are paid. The worked example stays under the cap (a 450,000 dong
 * product at 2.6%); the cap example is a 2,000,000 dong product whose Shopee part is capped at
 * 40,000 while the shop's XTRA part is not. Public and the same for everyone, so it may be cached.
 *
 *   GET /api/guide
 */
import { GUIDE_PATH, guideFiguresSchema, type GuideFigures } from "@cashback/contracts";
import { CASHBACK_SHARE_BPS, NETWORK_MONEY_RULES, SHOPEE_COMMISSION_CAP_DONG, shopeeCommission, splitCommission, WITHHOLDING_TAX_BPS } from "@cashback/money";

import type { PublicRoutes } from "../platform/http/servers";

/** The worked example: a product under the cap. */
export const GUIDE_EXAMPLE = { price: 450_000, shopeeRateBps: 260 } as const;
/** The cap example: a dearer product with a shop XTRA rate. */
export const GUIDE_CAP_EXAMPLE = { price: 2_000_000, shopeeRateBps: 300, xtraRateBps: 200 } as const;

export function guideFigures(): GuideFigures {
  const { commission } = shopeeCommission(GUIDE_EXAMPLE.price, GUIDE_EXAMPLE.shopeeRateBps, 0);
  const split = (withheld: boolean) => {
    const { fee, tax, net, cashback } = splitCommission({ approvedCommission: commission, network: "shopee", withheld });
    return { fee, tax, net, cashback };
  };
  const cap = shopeeCommission(GUIDE_CAP_EXAMPLE.price, GUIDE_CAP_EXAMPLE.shopeeRateBps, GUIDE_CAP_EXAMPLE.xtraRateBps);
  return {
    feeBps: Number(NETWORK_MONEY_RULES.shopee.feeBps),
    taxBps: Number(WITHHOLDING_TAX_BPS),
    shareBps: Number(CASHBACK_SHARE_BPS),
    shopeeCap: SHOPEE_COMMISSION_CAP_DONG,
    example: { ...GUIDE_EXAMPLE, commission, notWithheld: split(false), withheld: split(true) },
    capExample: { ...GUIDE_CAP_EXAMPLE, shopeePart: cap.shopeePart, xtraPart: cap.xtraPart, commission: cap.commission },
  };
}

export function guideRoutes(): PublicRoutes {
  const figures = guideFiguresSchema.parse(guideFigures());
  return (app) => {
    app.get(GUIDE_PATH, async (_request, reply) => {
      void reply.header("cache-control", "public, max-age=3600");
      return figures;
    });
  };
}
