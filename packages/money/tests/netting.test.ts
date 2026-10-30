import { describe, expect, it } from "vitest";

import { nettingPlan, payableBalance } from "../src/index";

describe("nettingPlan (AD-6, D42)", () => {
  it("nets open clawbacks below the gross in full and transfers the rest", () => {
    expect(nettingPlan(135216, [{ clawbackId: "A-1", open: 49216 }])).toEqual({ entries: [{ clawbackId: "A-1", amount: 49216, carried: 0 }], netted: 49216, transfer: 86000, carriedForward: 0 });
  });

  it("nets up to the gross and carries the rest forward when the clawbacks reach it (netting only)", () => {
    expect(nettingPlan(50000, [{ clawbackId: "A-1", open: 80000 }])).toEqual({ entries: [{ clawbackId: "A-1", amount: 50000, carried: 30000 }], netted: 50000, transfer: 0, carriedForward: 30000 });
  });

  it("stops at the gross across several clawbacks, in the order given, and skips what nothing is left for", () => {
    const plan = nettingPlan(60000, [
      { clawbackId: "A-1", open: 20000 },
      { clawbackId: "B-1", open: 50000 },
      { clawbackId: "C-1", open: 10000 },
    ]);
    expect(plan.entries).toEqual([
      { clawbackId: "A-1", amount: 20000, carried: 0 },
      { clawbackId: "B-1", amount: 40000, carried: 10000 },
    ]);
    expect(plan.transfer).toBe(0);
    expect(plan.carriedForward).toBe(20000);
  });

  it("always transfers exactly the payable balance", () => {
    for (const [gross, opens] of [
      [0, [5000]],
      [9263, []],
      [100000, [30000, 30000]],
      [100000, [70000, 70000]],
    ] as const) {
      const total = opens.reduce((a, b) => a + b, 0);
      expect(nettingPlan(gross, opens.map((open, i) => ({ clawbackId: `X-${i}`, open }))).transfer).toBe(payableBalance({ gross, openClawbacks: total }));
    }
  });

  it("refuses fractions and negative amounts", () => {
    expect(() => nettingPlan(10.5, [])).toThrow(RangeError);
    expect(() => nettingPlan(100, [{ clawbackId: "A-1", open: -1 }])).toThrow(RangeError);
  });
});
