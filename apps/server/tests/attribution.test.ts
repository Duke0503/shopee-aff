/**
 * Story 2.7: the attribution rule, run over the golden cases in packages/golden/fixtures/
 * attribution and reached through the orders module's index.ts.
 */
import { loadAttributionFixtures, type AttributionDirectoryData } from "@cashback/golden/attribution";
import { splitCommission } from "@cashback/money";
import { describe, expect, it } from "vitest";

import { attribute, type AttributionDirectory } from "../src/modules/orders/index";

const file = loadAttributionFixtures();

function directoryOf(data: AttributionDirectoryData): AttributionDirectory {
  const customers = new Set(data.customers);
  const resolve = (key: string) => {
    const id = customers.has(key) ? key : data.aliases[key];
    if (id === undefined) return null;
    return { customerId: id, guest: data.guests.includes(id) || data.erased.includes(id) };
  };
  return { resolveCustomer: resolve, requestOwner: (requestId) => data.requests[requestId] ?? null };
}

const directory = directoryOf(file.directory);
const caseFor = (story: string) => {
  const found = file.cases.find((c) => c.story === story);
  if (!found) throw new Error(`no golden case for ${story}`);
  return found;
};
const run = (story: string) => {
  const c = caseFor(story);
  return attribute({ subIds: c.input.subIds }, directory, c.input.production);
};

describe("attribution golden cases (Story 2.7)", () => {
  for (const c of file.cases) {
    it(c.name, () => {
      expect(attribute({ subIds: c.input.subIds }, directory, c.input.production)).toEqual(c.expected);
    });
  }
});

describe("Story 2.7 acceptance criteria", () => {
  it("AC1: a retired customer id that is an alias returns the survivor", () => {
    expect(run("2.7 AC1")).toMatchObject({ kind: "customer", customerId: "CUSTA" });
  });

  it("AC2: no sub_id1 and a sub_id2 naming A's link request returns A", () => {
    expect(run("2.7 AC2")).toMatchObject({ kind: "customer", customerId: "CUSTA", source: "sub_id2" });
  });

  it("AC3: sub_id1 resolving to A with B's request is an owner disagreement and no customer (golden)", () => {
    const result = run("2.7 AC3");
    expect(result).toMatchObject({ kind: "review", reason: "owner_disagreement" });
    expect(result).not.toHaveProperty("customerId");
  });

  it("AC4: a DEV sub_id1 in production is a review case, never a customer", () => {
    expect(run("2.7 AC4")).toEqual({ kind: "review", reason: "dev_link_in_production", candidates: [] });
    expect(attribute({ subIds: ["DEVCUSTD"] }, directory, true).kind).toBe("review");
    expect(attribute({ subIds: ["", "REQDEV"] }, directory, true)).toEqual({ kind: "review", reason: "dev_link_in_production", candidates: [] });
  });

  it("AC5: a HOUSE row returns HOUSE and its effect carries cashback 0", () => {
    const result = run("2.7 AC5");
    expect(result).toMatchObject({ kind: "customer", customerId: "HOUSE", guest: true });
    const guest = result.kind === "customer" && result.guest;
    expect(splitCommission({ approvedCommission: 12_000, network: "shopee", withheld: false, guest }).cashback).toBe(0);
  });

  it("D58: an unresolved sub_id1 is never credited to the sub_id2 owner; the owner is only suggested", () => {
    expect(attribute({ subIds: ["C0003", "REQB1"] }, directory, true)).toEqual({ kind: "review", reason: "unattributed_sub_id1", candidates: ["CUSTB"] });
  });

  it("guest status comes from the directory (role HOUSE), not from the id", () => {
    const renamed: AttributionDirectory = { resolveCustomer: (k) => (k === "GUESTS" ? { customerId: "GUESTS", guest: true } : null), requestOwner: () => null };
    expect(attribute({ subIds: ["GUESTS"] }, renamed, true)).toMatchObject({ customerId: "GUESTS", guest: true });
    const noGuests: AttributionDirectory = { resolveCustomer: (k) => ({ customerId: k, guest: false }), requestOwner: () => null };
    expect(attribute({ subIds: ["HOUSE"] }, noGuests, true)).toMatchObject({ guest: false });
  });

  it("trims blank sub_ids and never reads sub_id3 to sub_id5", () => {
    expect(attribute({ subIds: ["  ", " REQA1 ", "CUSTB", "CUSTB", "CUSTB"] }, directory, true)).toMatchObject({ customerId: "CUSTA", source: "sub_id2" });
  });
});
