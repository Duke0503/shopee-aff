import { describe, expect, it } from "vitest";
import {
  APPROVED,
  AWAITING_APPROVAL,
  PAID,
  REJECTED,
  assertMarkPaidAllowed,
  canApprove,
  canTransition,
  isFinal,
  statusAfterReport,
  type OrderRef,
} from "./order";

const waiting: OrderRef = { status: AWAITING_APPROVAL, paidAt: null };
const approved: OrderRef = { status: APPROVED, paidAt: null };
const paid: OrderRef = { status: PAID, paidAt: "2026-10-01T10:00:00" };

describe("allowed transitions", () => {
  it("allows exactly the forward edges", () => {
    expect(canTransition(AWAITING_APPROVAL, APPROVED)).toBe(true);
    expect(canTransition(AWAITING_APPROVAL, REJECTED)).toBe(true);
    expect(canTransition(APPROVED, PAID)).toBe(true);
    expect(canTransition(AWAITING_APPROVAL, PAID)).toBe(false);
    expect(canTransition(PAID, APPROVED)).toBe(false);
  });
});

describe("never pay twice", () => {
  it("mark paid refuses a waiting order, accepts an approved one", () => {
    expect(() => assertMarkPaidAllowed(waiting)).toThrow(/not approved/);
    expect(() => assertMarkPaidAllowed(approved)).not.toThrow();
  });

  it("is a no-op once paid_at is set", () => {
    expect(() => assertMarkPaidAllowed(paid)).not.toThrow();
    expect(isFinal(paid)).toBe(true);
  });
});

describe("reconciliation never guesses", () => {
  it("leaves a paid order untouched whatever the report says", () => {
    expect(statusAfterReport(paid, REJECTED)).toBe(PAID);
    expect(statusAfterReport(paid, APPROVED)).toBe(PAID);
  });

  it("keeps an approved order approved even if the report says cancelled", () => {
    expect(statusAfterReport(approved, REJECTED)).toBe(APPROVED);
  });

  it("moves a waiting order only along an allowed edge", () => {
    expect(statusAfterReport(waiting, APPROVED)).toBe(APPROVED);
    expect(statusAfterReport(waiting, REJECTED)).toBe(REJECTED);
    expect(statusAfterReport(waiting, PAID)).toBe(AWAITING_APPROVAL);
  });
});

describe("canApprove", () => {
  it("needs a commission figure; none means manual review", () => {
    expect(canApprove(0)).toBe(true);
    expect(canApprove(31_500)).toBe(true);
    expect(canApprove(null)).toBe(false);
    expect(canApprove(undefined)).toBe(false);
  });
});
