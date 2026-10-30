import { describe, expect, it } from "vitest";

import { fromNetworkUnits, fromNetworkUnitsTimes } from "../src/index";

describe("fromNetworkUnitsTimes: a report amount times a whole quantity, rounded once", () => {
  it("multiplies the exact amount before rounding: 1000.5 x 3 = 3001.5 -> 3002", () => {
    expect(fromNetworkUnitsTimes("1000.5", 1, 3)).toBe(3002);
    expect(fromNetworkUnits("1000.5", 1) * 3).toBe(3003);
  });

  it("works with a network scale", () => {
    expect(fromNetworkUnitsTimes(7_363_100_000, 100_000, 2)).toBe(147_262);
  });

  it("quantity 1 is fromNetworkUnits", () => {
    expect(fromNetworkUnitsTimes("12345.49", 1, 1)).toBe(fromNetworkUnits("12345.49", 1));
  });

  it("refuses a quantity that is not a whole number of at least 1", () => {
    for (const quantity of [0, -1, 2.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => fromNetworkUnitsTimes(1000, 1, quantity), String(quantity)).toThrow(RangeError);
    }
  });

  it("refuses a malformed amount like fromNetworkUnits does", () => {
    for (const value of ["1,234", "N/A", "1e5", "--"]) expect(() => fromNetworkUnitsTimes(value, 1, 2)).toThrow(RangeError);
  });
});
