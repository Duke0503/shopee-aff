import { describe, expect, it } from "vitest";

import { estimatedCashback, openClawbackTotal, payableBalance, splitCommission } from "../src/index";

describe("payable balance (AD-6, D27, D42)", () => {
  it("is the gross less the open clawbacks, and never below 0", () => {
    expect(payableBalance({ gross: 135216, openClawbacks: 0 })).toBe(135216);
    expect(payableBalance({ gross: 135216, openClawbacks: 49216 })).toBe(86000);
    expect(payableBalance({ gross: 135216, openClawbacks: 200000 })).toBe(0);
    expect(() => payableBalance({ gross: -1, openClawbacks: 0 })).toThrow(RangeError);
    expect(() => payableBalance({ gross: 1, openClawbacks: 0.5 })).toThrow(RangeError);
  });

  it("counts each clawback's open amount only while it is negative", () => {
    expect(openClawbackTotal([-49216, 0, -1000])).toBe(50216);
    expect(openClawbackTotal([])).toBe(0);
  });

  it("estimates waiting cashback through the split with withholding, and 0 for a guest or no estimate", () => {
    expect(estimatedCashback(45000, "shopee")).toBe(splitCommission({ approvedCommission: 45000, network: "shopee", withheld: true }).cashback);
    expect(estimatedCashback(45000, "shopee", true)).toBe(0);
    expect(estimatedCashback(null, "shopee")).toBe(0);
    expect(estimatedCashback(45000, null)).toBe(0);
  });
});
