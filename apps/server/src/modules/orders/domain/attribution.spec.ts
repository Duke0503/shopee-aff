import { describe, expect, it } from "vitest";
import { attributeOrder, type AttributionLookups } from "./attribution";

const lookups = (customers: Record<string, string>, requests: Record<string, string>): AttributionLookups => ({
  findCustomer: (id) => customers[id] ?? null,
  requestOwner: (id) => requests[id] ?? null,
});

describe("attributeOrder (never guess)", () => {
  it("uses sub_id1 first, following aliases", () => {
    const result = attributeOrder(
      { subId1: "OLD_UID", subId2: "R26100612345" },
      lookups({ OLD_UID: "8461" }, {}),
    );
    expect(result).toEqual({ customerId: "8461", via: "sub_id1", reason: null });
  });

  it("falls back to sub_id2 when sub_id1 is unknown", () => {
    const result = attributeOrder(
      { subId1: "nobody", subId2: "R26100612345" },
      lookups({}, { R26100612345: "C9" }),
    );
    expect(result).toEqual({ customerId: "C9", via: "sub_id2", reason: null });
  });

  it("sends an unmatched order to manual review", () => {
    const result = attributeOrder({ subId1: "a", subId2: "b" }, lookups({}, {}));
    expect(result.customerId).toBeNull();
    expect(result.reason).toMatch(/neither sub_id1 nor sub_id2/);
  });

  it("flags an order with no labels at all", () => {
    expect(attributeOrder({ subId1: null, subId2: "" }, lookups({}, {})).reason).toMatch(
      /no sub_id labels/,
    );
  });

  it("ignores surrounding whitespace on the labels", () => {
    const result = attributeOrder(
      { subId1: " OLD_UID ", subId2: null },
      lookups({ OLD_UID: "8461" }, {}),
    );
    expect(result.customerId).toBe("8461");
  });
});
