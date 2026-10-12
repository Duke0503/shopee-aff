import { describe, expect, it } from "vitest";
import { planPayout, type PayoutAward, type PayoutOrder } from "./payout-plan";

const order = (over: Partial<PayoutOrder> & { orderId: string }): PayoutOrder => ({
  status: "approved",
  paidAt: null,
  cashbackVnd: 0,
  ...over,
});

const award = (over: Partial<PayoutAward> & { awardId: string }): PayoutAward => ({
  status: "confirmed",
  bonusVnd: 0,
  ...over,
});

describe("planPayout", () => {
  it("refuses an order that is not approved, or already paid", () => {
    expect(planPayout([order({ orderId: "A", status: "awaiting_approval" })], []).ok).toBe(false);
    expect(planPayout([order({ orderId: "A", paidAt: "2026-10-01T10:00:00" })], []).ok).toBe(false);
  });

  it("has NO minimum: a single 6,000d order is payable", () => {
    const plan = planPayout([order({ orderId: "A", cashbackVnd: 6000 })], []);
    expect(plan.ok).toBe(true);
    expect(plan.totalVnd).toBe(6000);
  });

  it("adds only CONFIRMED bonuses, never a held one", () => {
    const plan = planPayout(
      [order({ orderId: "A", cashbackVnd: 9506 })],
      [
        award({ awardId: "W1", status: "confirmed", bonusVnd: 20_000 }),
        award({ awardId: "W2", status: "held", bonusVnd: 20_000 }),
        award({ awardId: "W3", status: "void", bonusVnd: 20_000 }),
        award({ awardId: "W4", status: "paid", bonusVnd: 20_000 }),
      ],
    );
    expect(plan.awardIds).toEqual(["W1"]);
    expect(plan.totalVnd).toBe(29_506);
  });

  it("shows what the orders earned and what the campaign added, adding up", () => {
    const plan = planPayout(
      [order({ orderId: "A", cashbackVnd: 9506 }), order({ orderId: "B", cashbackVnd: 5000 })],
      [award({ awardId: "W1", status: "confirmed", bonusVnd: 20_000 })],
    );
    expect(plan.ordersVnd).toBe(14_506);
    expect(plan.bonusVnd).toBe(20_000);
    expect(plan.ordersVnd + plan.bonusVnd).toBe(plan.totalVnd);
  });

  it("reports every order it covers", () => {
    const plan = planPayout(
      [order({ orderId: "A", cashbackVnd: 1 }), order({ orderId: "B", cashbackVnd: 2 })],
      [],
    );
    expect(plan.orderIds).toEqual(["A", "B"]);
  });
});
