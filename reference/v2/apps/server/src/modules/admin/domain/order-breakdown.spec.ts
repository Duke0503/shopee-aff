import { describe, expect, it } from "vitest";

import { orderBreakdown } from "./order-breakdown";

const approvedInput = (over: Partial<Parameters<typeof orderBreakdown>[0]> = {}) => ({
  status: "approved" as const,
  approvedCommissionVnd: 50_000,
  estimatedCommissionVnd: null,
  savedCashbackVnd: null,
  cashbackRate: 0.8,
  periodIsWithheld: false,
  ...over,
});

describe("orderBreakdown — an approved commission", () => {
  it("keeps the full amount when the period is not withheld", () => {
    const breakdown = orderBreakdown(approvedInput());

    expect(breakdown).toMatchObject({
      basis: "approved",
      commissionVnd: 50_000,
      serviceFeeVnd: 490,
      withheldTaxVnd: 0,
      netVnd: 49_510,
      cashbackVnd: 39_608,
      operatorKeepsVnd: 9_902,
      operatorMarginPercent: 20,
    });
  });

  it("takes the 10% out when the period is withheld", () => {
    const breakdown = orderBreakdown(approvedInput({ periodIsWithheld: true }));

    expect(breakdown).toMatchObject({
      serviceFeeVnd: 490,
      withheldTaxVnd: 5000,
      netVnd: 44_510,
      cashbackVnd: 35_608,
      operatorKeepsVnd: 8_902,
    });
  });

  it("rounds the withheld tax the way Python's round() does", () => {
    // 12,345 x 10% = 1,234.5 -> half to even -> 1,234 (not 1,235).
    const breakdown = orderBreakdown(
      approvedInput({ approvedCommissionVnd: 12_345, periodIsWithheld: true }),
    );

    expect(breakdown.withheldTaxVnd).toBe(1234);
    expect(breakdown.netVnd).toBe(10_990);
  });

  it("shows the saved cashback as the amount owed, never a recomputed one", () => {
    const breakdown = orderBreakdown(approvedInput({ savedCashbackVnd: 30_000 }));

    expect(breakdown.cashbackVnd).toBe(30_000);
    expect(breakdown.operatorKeepsVnd).toBe(19_510);
    expect(breakdown.operatorMarginPercent).toBe(39.4);
  });
});

describe("orderBreakdown — an order that is not approved yet", () => {
  it("explains the estimate the customer is shown, tax included", () => {
    const breakdown = orderBreakdown(
      approvedInput({
        status: "awaiting_approval",
        approvedCommissionVnd: null,
        estimatedCommissionVnd: 50_000,
      }),
    );

    expect(breakdown).toMatchObject({
      basis: "estimate",
      commissionVnd: 50_000,
      withheldTaxVnd: 5000,
      netVnd: 44_510,
      cashbackVnd: 35_608,
    });
  });

  it("has nothing to show without a commission", () => {
    const breakdown = orderBreakdown(
      approvedInput({
        status: "awaiting_approval",
        approvedCommissionVnd: null,
        estimatedCommissionVnd: null,
      }),
    );

    expect(breakdown).toEqual({
      basis: "none",
      commissionVnd: 0,
      serviceFeeVnd: 0,
      withheldTaxVnd: 0,
      netVnd: 0,
      cashbackVnd: 0,
      operatorKeepsVnd: 0,
      operatorMarginPercent: 0,
    });
  });

  it("earned nothing when the order was rejected", () => {
    const breakdown = orderBreakdown(
      approvedInput({ status: "rejected", approvedCommissionVnd: 50_000 }),
    );

    expect(breakdown.basis).toBe("none");
    expect(breakdown.commissionVnd).toBe(0);
    expect(breakdown.operatorKeepsVnd).toBe(0);
  });
});
