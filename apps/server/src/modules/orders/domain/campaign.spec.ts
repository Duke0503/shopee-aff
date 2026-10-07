import { describe, expect, it } from "vitest";
import { evaluateCampaign, type Campaign, type CandidateOrder } from "./campaign";

const campaign: Campaign = {
  windowStart: "2026-10-01T00:00:00",
  windowEnd: "2026-10-03T23:59:59",
  slots: 2,
  bonusVnd: 20_000,
  perCustomer: 0,
  minOrderValueVnd: 0,
  platforms: [],
  excludedCustomerIds: [],
};

const order = (over: Partial<CandidateOrder> & { orderId: string; recordedAt: string }): CandidateOrder => ({
  customerId: "C1",
  orderValueVnd: 100_000,
  platform: "shopee",
  status: "approved",
  cancelledAt: null,
  role: "user",
  ...over,
});

describe("campaign slots", () => {
  it("ranks by recorded_at and fills the slots in order", () => {
    const awards = evaluateCampaign(campaign, [
      order({ orderId: "B", recordedAt: "2026-10-01T09:05:00", customerId: "C2" }),
      order({ orderId: "A", recordedAt: "2026-10-01T09:00:00", customerId: "C1" }),
    ]);
    expect(awards.map((a) => a.orderId)).toEqual(["A", "B"]);
    expect(awards.map((a) => a.slot)).toEqual([1, 2]);
  });

  it("ignores orders outside the window, staff, HOUSE and excluded customers", () => {
    const awards = evaluateCampaign(
      { ...campaign, slots: 5, excludedCustomerIds: ["X"] },
      [
        order({ orderId: "OUT", recordedAt: "2026-09-30T09:00:00" }),
        order({ orderId: "STAFF", recordedAt: "2026-10-01T09:00:00", role: "employee" }),
        order({ orderId: "HOUSE", recordedAt: "2026-10-01T09:00:00", role: "house" }),
        order({ orderId: "EX", recordedAt: "2026-10-01T09:00:00", customerId: "X" }),
        order({ orderId: "OK", recordedAt: "2026-10-01T09:00:00" }),
      ],
    );
    expect(awards.map((a) => a.orderId)).toEqual(["OK"]);
  });

  it("holds a slot until the order is approved", () => {
    const [award] = evaluateCampaign(campaign, [
      order({ orderId: "A", recordedAt: "2026-10-01T09:00:00", status: "awaiting_approval" }),
    ]);
    expect(award?.status).toBe("held");
  });

  it("passes a slot to the next order when cancelled DURING the event", () => {
    const awards = evaluateCampaign(campaign, [
      order({
        orderId: "A",
        recordedAt: "2026-10-01T09:00:00",
        status: "rejected",
        cancelledAt: "2026-10-02T09:00:00",
      }),
      order({ orderId: "B", recordedAt: "2026-10-01T09:01:00" }),
    ]);
    expect(awards.map((a) => a.orderId)).toEqual(["B"]);
    expect(awards[0]?.slot).toBe(1);
  });

  it("loses the slot when cancelled AFTER the event", () => {
    const awards = evaluateCampaign(campaign, [
      order({
        orderId: "A",
        recordedAt: "2026-10-01T09:00:00",
        status: "rejected",
        cancelledAt: "2026-10-05T09:00:00",
      }),
      order({ orderId: "B", recordedAt: "2026-10-01T09:01:00" }),
    ]);
    expect(awards.map((a) => a.orderId)).toEqual(["A", "B"]);
    expect(awards[0]?.status).toBe("void");
    expect(awards[1]?.slot).toBe(2);
  });

  it("respects a per-customer limit", () => {
    const awards = evaluateCampaign(
      { ...campaign, slots: 3, perCustomer: 1 },
      [
        order({ orderId: "A", recordedAt: "2026-10-01T09:00:00", customerId: "C1" }),
        order({ orderId: "B", recordedAt: "2026-10-01T09:01:00", customerId: "C1" }),
        order({ orderId: "C", recordedAt: "2026-10-01T09:02:00", customerId: "C2" }),
      ],
    );
    expect(awards.map((a) => a.orderId)).toEqual(["A", "C"]);
  });
});
