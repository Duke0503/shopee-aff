import { describe, expect, it } from "vitest";
import { balanceFor, type BalanceInput } from "../src/balance";

const base: BalanceInput = {
  approvedUnpaidCashbackVnd: [],
  awaitingEstimatedCommissionVnd: [],
  paidCashbackVnd: [],
  confirmedBonusVnd: 0,
  awaitingBonusVnd: 0,
  paidBonusVnd: 0,
  cashbackRate: 0.8,
  isHouse: false,
};

describe("balanceFor", () => {
  it("HOUSE is owed nothing", () => {
    expect(
      balanceFor({ ...base, isHouse: true, approvedUnpaidCashbackVnd: [9506], confirmedBonusVnd: 1 }),
    ).toEqual({ approvedWaitingVnd: 0, stillWithShopVnd: 0, alreadyPaidVnd: 0 });
  });

  it("sums approved, unpaid cashback and confirmed bonuses", () => {
    const balance = balanceFor({
      ...base,
      approvedUnpaidCashbackVnd: [9506, 8546],
      confirmedBonusVnd: 20_000,
    });
    expect(balance.approvedWaitingVnd).toBe(38_052);
  });

  it("shows awaiting orders as an estimate (tax always assumed)", () => {
    // 50,000d commission shows 35,608d while waiting (paid 39,608d if not withheld).
    expect(balanceFor({ ...base, awaitingEstimatedCommissionVnd: [50_000] }).stillWithShopVnd).toBe(
      35_608,
    );
  });

  it("adds already-paid cashback and bonuses", () => {
    const balance = balanceFor({ ...base, paidCashbackVnd: [9506], paidBonusVnd: 20_000 });
    expect(balance.alreadyPaidVnd).toBe(29_506);
  });
});
