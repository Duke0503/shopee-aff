import { describe, expect, it } from "vitest";
import { decideForget } from "./forget-customer";

const nothingOwed = { orderCount: 0, amountVnd: 0 };

describe("decideForget (matches Python forget_customer)", () => {
  it("reports a missing customer", () => {
    expect(decideForget(false, nothingOwed, false)).toEqual({ found: false, deleted: false });
  });

  it("refuses while money is owed, and names the debt", () => {
    expect(decideForget(true, { orderCount: 2, amountVnd: 23_000 }, false)).toEqual({
      found: true,
      deleted: false,
      owedOrders: 2,
      owedAmount: 23_000,
    });
  });

  it("deletes when nothing is owed", () => {
    expect(decideForget(true, nothingOwed, false)).toEqual({ found: true, deleted: true });
  });

  it("deletes a customer who is owed money only with force", () => {
    expect(decideForget(true, { orderCount: 1, amountVnd: 6_000 }, true)).toEqual({
      found: true,
      deleted: true,
    });
  });
});
