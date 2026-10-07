import { describe, expect, it } from "vitest";
import {
  SHOPEE_COMMISSION_CAP_VND,
  buildEstimate,
  capShopeePart,
  estimateCashback,
} from "../src/shopee-cap";

describe("Shopee commission cap (40,000d per order)", () => {
  it("the documented 5,290,000d item at 7% + 3% total is 198,700d", () => {
    const estimate = buildEstimate(5_290_000, 7, 3);
    expect(estimate.shopeePart).toBe(40_000);
    expect(estimate.sellerPart).toBe(158_700);
    expect(estimate.commission).toBe(198_700);
    expect(estimate.isCapped).toBe(true);
    expect(estimate.totalRate).toBe(10);
  });

  it("does not cap a commission below the limit or the shop's XTRA part", () => {
    const estimate = buildEstimate(100_000, 5, 0);
    expect(estimate.shopeePart).toBe(5_000);
    expect(estimate.isCapped).toBe(false);
  });

  it("caps only Shopee's own share", () => {
    expect(capShopeePart(370_300)).toBe(SHOPEE_COMMISSION_CAP_VND);
    expect(capShopeePart(39_999)).toBe(39_999);
    expect(capShopeePart(40_000)).toBe(40_000);
  });
});

describe("estimateCashback (shown before purchase, tax always assumed)", () => {
  it("198,700d at 80% shows 141,506d", () => {
    expect(estimateCashback(198_700, 0.8)).toBe(141_506);
  });

  it("50,000d at 80% shows 35,608d (less than the 39,608d finally paid)", () => {
    expect(estimateCashback(50_000, 0.8)).toBe(35_608);
  });
});
