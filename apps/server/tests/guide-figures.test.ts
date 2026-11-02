/**
 * Story 7.7 AC1 (server side): every rate on the guide comes with an example amount computed by
 * packages/money on the server, with the commission rule (D2) and the split (D12) the ledger
 * uses. The worked example stays under the Shopee cap (a 450,000 dong product at 2.6%); the cap
 * is shown on a 2,000,000 dong product whose Shopee part stops at 40,000 while the shop's XTRA
 * part does not. The page side (no amount typed in the page or the labels) is in
 * apps/web/tests/guide.test.tsx.
 */
import { GUIDE_PATH, guideFiguresSchema } from "@cashback/contracts";
import { fixedClock } from "@cashback/core";
import { shopeeCommission, splitCommission } from "@cashback/money";
import { afterEach, describe, expect, it } from "vitest";

import { buildServers, close, type Servers } from "../src/platform/http/servers";
import { GUIDE_CAP_EXAMPLE, GUIDE_EXAMPLE, guideFigures, guideRoutes } from "../src/web/guide.routes";

const opened: Servers[] = [];
afterEach(async () => {
  for (const s of opened.splice(0)) await close(s);
});

describe("Story 7.7: Basic guide page with the money rules stated correctly", () => {
  it("AC1: the worked example is packages/money's: 450,000 dong at 2.6% is 11,700 commission, 9,268 cashback not withheld and 8,332 withheld", () => {
    const f = guideFigures();
    expect(f).toMatchObject({ feeBps: 98, taxBps: 1000, shareBps: 8000, shopeeCap: 40000 });
    expect(f.example).toEqual({
      price: 450000,
      shopeeRateBps: 260,
      commission: 11700,
      notWithheld: { fee: 115, tax: 0, net: 11585, cashback: 9268 },
      withheld: { fee: 115, tax: 1170, net: 10415, cashback: 8332 },
    });
    const commission = shopeeCommission(GUIDE_EXAMPLE.price, GUIDE_EXAMPLE.shopeeRateBps, 0);
    expect(commission).toMatchObject({ commission: 11700, capped: false });
    for (const withheld of [false, true]) {
      const split = splitCommission({ approvedCommission: commission.commission, network: "shopee", withheld });
      expect(withheld ? f.example.withheld : f.example.notWithheld).toEqual({ fee: split.fee, tax: split.tax, net: split.net, cashback: split.cashback });
    }
  });

  it("AC1: the cap example is a 2,000,000 dong product: the Shopee part at 3% is capped at 40,000, the shop's 2% XTRA part (40,000) is not", () => {
    const cap = shopeeCommission(GUIDE_CAP_EXAMPLE.price, GUIDE_CAP_EXAMPLE.shopeeRateBps, GUIDE_CAP_EXAMPLE.xtraRateBps);
    expect(cap).toEqual({ shopeePart: 40000, xtraPart: 40000, commission: 80000, capped: true });
    expect(guideFigures().capExample).toEqual({ price: 2000000, shopeeRateBps: 300, xtraRateBps: 200, shopeePart: 40000, xtraPart: 40000, commission: 80000 });
  });

  it("the split itself is the golden one: 100,000 dong of approved commission gives 79,216 not withheld and 71,216 withheld", () => {
    expect(splitCommission({ approvedCommission: 100000, network: "shopee", withheld: false }).cashback).toBe(79216);
    expect(splitCommission({ approvedCommission: 100000, network: "shopee", withheld: true }).cashback).toBe(71216);
  });

  it("AC1: the figures are served publicly on /api/guide in the contract's shape", async () => {
    const servers = buildServers({ clock: fixedClock("2026-11-02T03:00:00.000Z"), internalToken: "i".repeat(40), public: [guideRoutes()] });
    opened.push(servers);
    const res = await servers.publicApp.inject({ method: "GET", url: GUIDE_PATH });
    expect(res.statusCode).toBe(200);
    expect(guideFiguresSchema.parse(res.json())).toEqual(guideFigures());
  });
});
