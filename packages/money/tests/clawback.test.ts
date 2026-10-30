import { describe, expect, it } from "vitest";

import { clawbackAmount, differenceDong, partialClawbackAmount, sumDong } from "../src/index";

describe("sumDong", () => {
  it("adds whole dong and refuses fractions, negatives and unsafe sums", () => {
    expect(sumDong([])).toBe(0);
    expect(sumDong([6232, 20000, 1])).toBe(26233);
    expect(() => sumDong([1.5])).toThrow(RangeError);
    expect(() => sumDong([-1])).toThrow(RangeError);
    expect(() => sumDong([Number.MAX_SAFE_INTEGER, 1])).toThrow(RangeError);
  });
});

describe("differenceDong", () => {
  it("subtracts whole dong of either sign and refuses fractions", () => {
    expect(differenceDong(7001, 7000)).toBe(1);
    expect(differenceDong(0, 30000)).toBe(-30000);
    expect(() => differenceDong(1.5, 0)).toThrow(RangeError);
  });
});

describe("clawback amounts (D30, D35, D42, D55)", () => {
  it("a cancel after payout takes back the stored cashback plus the paid bonus, less what was already taken", () => {
    expect(clawbackAmount({ storedCashback: 9263, paidBonus: 20000, alreadyClawedBack: 0 })).toBe(29263);
    expect(clawbackAmount({ storedCashback: 9263, paidBonus: 0, alreadyClawedBack: 9263 })).toBe(0);
    expect(clawbackAmount({ storedCashback: 9263, paidBonus: 0, alreadyClawedBack: 10000 })).toBe(0);
  });

  it("a commission drop after payout takes back only the difference, never below 0", () => {
    expect(partialClawbackAmount({ storedCashback: 7000, newCashback: 4000, alreadyClawedBack: 0 })).toBe(3000);
    expect(partialClawbackAmount({ storedCashback: 7000, newCashback: 4000, alreadyClawedBack: 1000 })).toBe(2000);
    expect(partialClawbackAmount({ storedCashback: 7000, newCashback: 8000, alreadyClawedBack: 0 })).toBe(0);
  });
});
