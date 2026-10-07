import { describe, expect, it } from "vitest";
import { findMergePairs, mergeConflict, planMerge, type MergeRow } from "./merge-customers";

const row = (over: Partial<MergeRow> & { customerId: string; createdAt: string }): MergeRow => ({
  zaloUserId: null,
  customerCode: null,
  displayName: null,
  role: "user",
  bankName: null,
  bankAccount: null,
  passwordHash: null,
  passwordSetAt: null,
  loginCount: 0,
  lastLoginAt: null,
  ...over,
});

describe("findMergePairs", () => {
  it("pairs a name held by exactly two customers, older first", () => {
    const newer = row({ customerId: "NEW", displayName: "Lan", createdAt: "2026-02-01" });
    const older = row({ customerId: "OLD", displayName: "Lan", createdAt: "2026-01-01" });
    const [pair] = findMergePairs([newer, older]);
    expect(pair?.old.customerId).toBe("OLD");
    expect(pair?.new.customerId).toBe("NEW");
  });

  it("ignores a name on three rows, and staff", () => {
    const three = ["A", "B", "C"].map((id) =>
      row({ customerId: id, displayName: "Trung", createdAt: `2026-01-0${id}` }),
    );
    const staff = [
      row({ customerId: "S1", displayName: "Minh", createdAt: "2026-01-01", role: "employee" }),
      row({ customerId: "S2", displayName: "Minh", createdAt: "2026-01-02", role: "employee" }),
    ];
    expect(findMergePairs([...three, ...staff])).toEqual([]);
  });
});

describe("planMerge", () => {
  it("keeps the older (smaller) code and aliases the old id and retired code", () => {
    const retired = row({
      customerId: "OLD",
      zaloUserId: "111",
      customerCode: "DP00040",
      displayName: "Lan",
      createdAt: "2026-01-01",
    });
    const survivor = row({
      customerId: "NEW",
      zaloUserId: "222",
      customerCode: "DP00050",
      displayName: "Lan",
      createdAt: "2026-02-01",
    });
    const plan = planMerge(retired, survivor);
    expect(plan.survivorId).toBe("NEW");
    expect(plan.keepCode).toBe("DP00040");
    expect(plan.aliases.sort()).toEqual(["111", "DP00050", "OLD"]);
    expect(plan.copyBankDetails).toBe(false);
  });

  it("copies bank details only when the survivor has none", () => {
    const retired = row({
      customerId: "OLD",
      createdAt: "2026-01-01",
      bankName: "VCB",
      bankAccount: "123",
    });
    const survivor = row({ customerId: "NEW", createdAt: "2026-02-01" });
    expect(planMerge(retired, survivor).copyBankDetails).toBe(true);
  });

  it("refuses two different bank accounts", () => {
    const retired = row({
      customerId: "OLD",
      createdAt: "2026-01-01",
      bankName: "VCB",
      bankAccount: "123",
    });
    const survivor = row({
      customerId: "NEW",
      createdAt: "2026-02-01",
      bankName: "TCB",
      bankAccount: "456",
    });
    expect(mergeConflict(retired, survivor)).toBe("two different bank accounts");
    expect(() => planMerge(retired, survivor)).toThrow(/refused/);
  });

  it("never moves campaign_awards", () => {
    const plan = planMerge(
      row({ customerId: "OLD", createdAt: "2026-01-01" }),
      row({ customerId: "NEW", createdAt: "2026-02-01" }),
    );
    expect(plan.moves).not.toContain("campaign_awards");
  });
});
