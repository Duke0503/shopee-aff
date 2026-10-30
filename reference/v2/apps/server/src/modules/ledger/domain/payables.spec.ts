import { describe, expect, it } from "vitest";
import { collectPayables, type PayableInput } from "./payables";

const NOW = "2026-10-07T12:00:00";

const item = (over: Partial<PayableInput> & { customerId: string }): PayableInput => ({
  approvedUnpaidCashbackVnd: 0,
  confirmedBonusVnd: 0,
  hasBankAccount: true,
  bankChangedAtIso: null,
  ...over,
});

describe("collectPayables", () => {
  it("has NO minimum: a 6,000d order is payable", () => {
    const { ready } = collectPayables([item({ customerId: "C1", approvedUnpaidCashbackVnd: 6000 })], NOW);
    expect(ready.map((p) => p.customerId)).toEqual(["C1"]);
  });

  it("blocks only a missing bank account", () => {
    const { ready, blocked } = collectPayables(
      [
        item({ customerId: "C1", approvedUnpaidCashbackVnd: 6000 }),
        item({ customerId: "C2", approvedUnpaidCashbackVnd: 9000, hasBankAccount: false }),
      ],
      NOW,
    );
    expect(ready.map((p) => p.customerId)).toEqual(["C1"]);
    expect(blocked[0]?.customerId).toBe("C2");
    expect(blocked[0]?.blockedReason).toMatch(/no bank account/);
  });

  it("adds confirmed bonuses and sorts most-owed first", () => {
    const { ready } = collectPayables(
      [
        item({ customerId: "C1", approvedUnpaidCashbackVnd: 6000, confirmedBonusVnd: 20_000 }),
        item({ customerId: "C2", approvedUnpaidCashbackVnd: 50_000 }),
      ],
      NOW,
    );
    expect(ready.map((p) => p.customerId)).toEqual(["C2", "C1"]);
    expect(ready.find((p) => p.customerId === "C1")?.amountVnd).toBe(26_000);
  });

  it("flags an account changed in the last 72 hours", () => {
    const { ready } = collectPayables(
      [
        item({ customerId: "C1", approvedUnpaidCashbackVnd: 6000, bankChangedAtIso: "2026-10-06T12:00:00" }),
        item({ customerId: "C2", approvedUnpaidCashbackVnd: 6000, bankChangedAtIso: "2026-10-01T12:00:00" }),
      ],
      NOW,
    );
    expect(ready.find((p) => p.customerId === "C1")?.bankChangedRecently).toBe(true);
    expect(ready.find((p) => p.customerId === "C2")?.bankChangedRecently).toBe(false);
  });

  it("ignores customers owed nothing", () => {
    expect(collectPayables([item({ customerId: "C0" })], NOW).ready).toEqual([]);
  });
});
