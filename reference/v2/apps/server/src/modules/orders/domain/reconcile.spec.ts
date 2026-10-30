import { describe, expect, it } from "vitest";
import type { AttributionLookups } from "./attribution";
import { APPROVED, AWAITING_APPROVAL, PAID, REJECTED, type OrderRef } from "./order";
import { decideReconcile, type ReportRow } from "./reconcile";

const lookups: AttributionLookups = {
  findCustomer: (id) => (id === "8461" ? "C1" : null),
  requestOwner: (id) => (id === "R1" ? "C2" : null),
};

const row = (over: Partial<ReportRow>): ReportRow => ({
  subId1: "8461",
  subId2: "R1",
  status: "approved",
  approvedCommission: 31_500,
  ...over,
});

const waiting: OrderRef = { status: AWAITING_APPROVAL, paidAt: null };
const approved: OrderRef = { status: APPROVED, paidAt: null };
const paid: OrderRef = { status: PAID, paidAt: "2026-10-01T10:00:00" };
const rejected: OrderRef = { status: REJECTED, paidAt: null };

describe("decideReconcile", () => {
  it("skips a final order whatever the report says", () => {
    expect(decideReconcile(row({}), paid, lookups).kind).toBe("skip");
    expect(decideReconcile(row({}), rejected, lookups).kind).toBe("skip");
  });

  it("sends an unknown status to manual review", () => {
    expect(decideReconcile(row({ status: "unknown" }), null, lookups).kind).toBe("review");
  });

  it("sends an unmatched order to manual review", () => {
    const outcome = decideReconcile(row({ subId1: "x", subId2: "y" }), null, lookups);
    expect(outcome.kind).toBe("review");
  });

  it("records a brand-new order", () => {
    expect(decideReconcile(row({}), null, lookups)).toEqual({ kind: "record", customerId: "C1" });
  });

  it("approves a waiting order that now carries a commission", () => {
    expect(decideReconcile(row({}), waiting, lookups)).toEqual({ kind: "approve", customerId: "C1" });
  });

  it("reviews an approval that carries no commission", () => {
    expect(decideReconcile(row({ approvedCommission: null }), waiting, lookups).kind).toBe("review");
  });

  it("rejects a waiting order the report cancels", () => {
    expect(decideReconcile(row({ status: "rejected" }), waiting, lookups)).toEqual({
      kind: "reject",
      customerId: "C1",
    });
  });

  it("keeps an approved order approved even if the report now cancels it", () => {
    expect(decideReconcile(row({ status: "rejected" }), approved, lookups).kind).toBe("skip");
  });

  it("falls back to sub_id2 when sub_id1 is unknown", () => {
    expect(decideReconcile(row({ subId1: "nobody" }), null, lookups)).toEqual({
      kind: "record",
      customerId: "C2",
    });
  });
});
