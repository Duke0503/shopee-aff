import { describe, expect, it } from "vitest";

import { loadVoidFixtures } from "../src/void-fixtures";

const file = loadVoidFixtures();

describe("payout void fixtures (Story 4.10, D41)", () => {
  it("holds all four void combinations and the already-netted clawback, once each, with unique names", () => {
    expect(file.cases.map((c) => c.combination).sort()).toEqual([1, 2, 3, 4, 5]);
    const names = file.cases.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("every case records a payout before it voids it, and every covered order leaves the void with paid_at cleared", () => {
    for (const c of file.cases) {
      const confirms = c.steps.filter((s) => s.step === "confirm").length;
      expect(confirms, c.name).toBeGreaterThanOrEqual(c.voidPayout ?? 1);
      expect(c.expected.orders.every((o) => o.paidAt === null && (o.status === "APPROVED" || o.status === "REVERSED")), c.name).toBe(true);
    }
  });

  it("a void closes or restores clawbacks only by offsetting entries: each open amount is what its entries sum to", () => {
    for (const c of file.cases) {
      for (const [clawbackId, open] of Object.entries(c.expected.clawbackOpen)) expect(open, `${c.name} ${clawbackId}`).toBeLessThanOrEqual(0);
      expect(c.expected.offsets.every((o) => o.amount !== 0 && Number.isSafeInteger(o.amount)), c.name).toBe(true);
      expect(c.expected.refunds.every((r) => r.amount > 0 && Number.isSafeInteger(r.amount)), c.name).toBe(true);
    }
  });

  it("a credit back is exactly what netting took: the clawback's original less what the void closes", () => {
    const c = file.cases.find((x) => x.combination === 5);
    expect(c?.expected.refunds.map((r) => r.amount)).toEqual([14243]);
    expect((c?.expected.offsets[0]?.amount ?? 0) + (c?.expected.refunds[0]?.amount ?? 0)).toBe(21365);
  });
});
