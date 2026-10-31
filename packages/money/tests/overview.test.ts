/**
 * Story 4.17 and 4.19: the Overview's profit and ratios and the merged balance refuse what is not
 * whole dong; the cases to the dong are the golden fixtures in packages/golden/fixtures/money.
 */
import { describe, expect, it } from "vitest";

import { averageDong, changeOf, combinedBalance, operatorProfit, ratioBps } from "../src/index";

describe("Overview money", () => {
  it("profit may be negative; its inputs may not", () => {
    expect(operatorProfit({ commission: 0, fee: 0, tax: 0, cashback: 0, eventBonus: 20000, clawbackNetted: 0 })).toBe(-20000);
    expect(() => operatorProfit({ commission: 1.5, fee: 0, tax: 0, cashback: 0, eventBonus: 0, clawbackNetted: 0 })).toThrow(RangeError);
    expect(() => operatorProfit({ commission: 100, fee: -1, tax: 0, cashback: 0, eventBonus: 0, clawbackNetted: 0 })).toThrow(RangeError);
  });

  it("a ratio or an average over nothing is null, never 0; a change needs both sides", () => {
    expect(ratioBps(5, 0)).toBeNull();
    expect(averageDong(0, 0)).toBeNull();
    expect(changeOf(10, null)).toBeNull();
    expect(changeOf(-5, 10)).toBe(-15);
  });

  it("a merged balance recomputes payable from the summed parts", () => {
    expect(combinedBalance([{ gross: 1000, deductedNext: 0, waiting: 0, paid: 0 }, { gross: 0, deductedNext: 3000, waiting: 0, paid: 0 }]).payable).toBe(0);
  });
});
