import { describe, expect, it } from "vitest";

import { offerFor, type OfferCandidate, type OfferQuery } from "./campaign-offer";

const NOW = "2026-10-12T12:00:00";

function campaign(overrides: Partial<OfferCandidate> = {}): OfferCandidate {
  return {
    campaignId: "CMP1",
    name: "Tet Sale",
    startsAt: "2026-10-01T00:00:00",
    endsAt: "2026-10-20T00:00:00",
    slots: 5,
    bonusVnd: 20_000,
    minOrderValueVnd: 0,
    perCustomer: 0,
    platforms: ["shopee", "tiktok"],
    excludedCustomerIds: [],
    liveSlots: 1,
    heldByCustomer: 0,
    ...overrides,
  };
}

function query(overrides: Partial<OfferQuery> = {}): OfferQuery {
  return { customerId: "C1", role: "user", platform: "shopee", nowIso: NOW, ...overrides };
}

describe("offerFor", () => {
  it("offers the running event and its remaining slots", () => {
    expect(offerFor([campaign()], query())).toEqual({
      name: "Tet Sale",
      bonus: 20_000,
      slots: 5,
      left: 4,
      minOrderValue: 0,
      perCustomer: 0,
    });
  });

  it("skips an event that has not started or has already ended", () => {
    expect(offerFor([campaign({ startsAt: "2026-11-01T00:00:00" })], query())).toBeNull();
    expect(offerFor([campaign({ endsAt: "2026-10-01T00:00:00" })], query())).toBeNull();
  });

  it("skips a platform the event does not cover", () => {
    expect(offerFor([campaign()], query({ platform: "lazada" }))).toBeNull();
  });

  it("skips an excluded customer", () => {
    expect(offerFor([campaign({ excludedCustomerIds: ["C1"] })], query())).toBeNull();
  });

  it("skips a customer already at their per-customer cap", () => {
    expect(offerFor([campaign({ perCustomer: 1, heldByCustomer: 1 })], query())).toBeNull();
    expect(offerFor([campaign({ perCustomer: 2, heldByCustomer: 1 })], query())).toMatchObject({ left: 4 });
  });

  it("skips an event whose slots are all taken", () => {
    expect(offerFor([campaign({ slots: 3, liveSlots: 3 })], query())).toBeNull();
  });

  it("stays quiet for staff and the house account", () => {
    expect(offerFor([campaign()], query({ role: "employee" }))).toBeNull();
    expect(offerFor([campaign()], query({ role: "house" }))).toBeNull();
  });

  it("returns the first campaign that still has something to give", () => {
    const taken = campaign({ campaignId: "CMP0", name: "Full", slots: 1, liveSlots: 1 });
    const open = campaign({ campaignId: "CMP1" });
    expect(offerFor([taken, open], query())).toMatchObject({ name: "Tet Sale" });
  });
});
