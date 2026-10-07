import { describe, expect, it } from "vitest";
import { splitCommission } from "../src/split";
import { policyWarnings } from "../src/tax";

describe("splitCommission — normal period (matches Python split_commission)", () => {
  it("C = 12,000d, 80%", () => {
    expect(splitCommission(12_000, 0.8, false)).toEqual({
      approvedCommission: 12_000,
      serviceFee: 118,
      withheldTax: 0,
      nominalCashback: 9506,
      customerReceives: 9506,
      operatorKeeps: 2376,
    });
  });

  it("C = 12,500d, 80%", () => {
    expect(splitCommission(12_500, 0.8, false).customerReceives).toBe(9902);
    expect(splitCommission(12_500, 0.8, false).serviceFee).toBe(122);
  });
});

describe("splitCommission — withheld period (banker's rounding on fee/tax)", () => {
  it("C = 12,000d", () => {
    const split = splitCommission(12_000, 0.8, true);
    expect(split).toEqual({
      approvedCommission: 12_000,
      serviceFee: 118,
      withheldTax: 1200,
      nominalCashback: 8546,
      customerReceives: 8546,
      operatorKeeps: 2136,
    });
  });

  it("C = 12,345d — tax rounds 1,234.5 down to even (1,234)", () => {
    const split = splitCommission(12_345, 0.8, true);
    expect(split.serviceFee).toBe(121);
    expect(split.withheldTax).toBe(1234);
    expect(split.customerReceives).toBe(8792);
    expect(split.operatorKeeps).toBe(2198);
  });

  it("C = 12,500d — fee rounds 122.5 down to even (122)", () => {
    const split = splitCommission(12_500, 0.8, true);
    expect(split.serviceFee).toBe(122);
    expect(split.withheldTax).toBe(1250);
    expect(split.customerReceives).toBe(8902);
    expect(split.operatorKeeps).toBe(2226);
  });
});

describe("splitCommission — edges", () => {
  it("zero and negative commissions split to all zeros", () => {
    expect(splitCommission(0, 0.8, true).customerReceives).toBe(0);
    expect(splitCommission(-500, 0.8, true).operatorKeeps).toBe(0);
  });

  it("ignores the tax policy, exactly like today's code", () => {
    const asUser = splitCommission(12_000, 0.8, true, "user_absorbs");
    const asOwner = splitCommission(12_000, 0.8, true, "owner_absorbs");
    expect(asUser).toEqual(asOwner);
  });
});

describe("policyWarnings", () => {
  it("warns three times when the monthly commission always clears the threshold", () => {
    expect(policyWarnings("user_absorbs", 0.8, 9_000_000)).toHaveLength(3);
  });

  it("warns twice when the commission swings around the threshold", () => {
    expect(policyWarnings("user_absorbs", 0.8, 500_000)).toHaveLength(2);
  });

  it("never warns under owner_absorbs", () => {
    expect(policyWarnings("owner_absorbs", 0.8, 9_000_000)).toHaveLength(0);
  });
});
