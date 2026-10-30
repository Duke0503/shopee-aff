import { describe, expect, it } from "vitest";

import { batchCoverage, classifyWithholding, settlementNet, settlementTolerance, splitCommission } from "../src/index";

describe("network payout batches (D59, real Shopee batches)", () => {
  it("reads the withholding of a batch from what it paid, within the per-order rounding", () => {
    expect(classifyWithholding("shopee", 168347, 166698)?.withheld).toBe(false);
    expect(classifyWithholding("shopee", 434665, 386938)?.withheld).toBe(true);
    expect(classifyWithholding("shopee", 60743, 54073)?.withheld).toBe(true);
    expect(classifyWithholding("shopee", 100000, 95000)).toBeNull();
  });

  it("the tolerance is 1% of the gross and at least 2 dong", () => {
    expect(settlementTolerance(0)).toBe(2);
    expect(settlementTolerance(150)).toBe(2);
    expect(settlementTolerance(168347)).toBe(1684);
  });

  it("an order's figure in a batch follows the batch's withholding", () => {
    expect(settlementNet("shopee", 100000, true)).toBe(89020);
    expect(settlementNet("shopee", 100000, false)).toBe(splitCommission({ approvedCommission: 100000, network: "shopee", withheld: false }).net);
  });

  it("the gross the operator's orders do not explain is unattributed; orders above the batch do not fit", () => {
    expect(batchCoverage(1509019, [1420946])).toEqual({ matchedGross: 1420946, unattributed: 88073, fits: true });
    expect(batchCoverage(100000, [100500])).toEqual({ matchedGross: 100500, unattributed: -500, fits: true });
    expect(batchCoverage(100000, [102000])).toEqual({ matchedGross: 102000, unattributed: -2000, fits: false });
    expect(() => batchCoverage(1.5, [1])).toThrow();
  });
});
