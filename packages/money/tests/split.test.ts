import { describe, expect, it } from "vitest";

import { fromNetworkUnits, shopeeCommission, splitCommission } from "../src/index";

describe("splitCommission invariants", () => {
  it("keeps operatorShare = commission - fee - tax - cashback for many amounts", () => {
    for (const approvedCommission of [0, 1, 7, 99, 101, 9_263, 11_693, 123_457, 2_538_001]) {
      for (const withheld of [false, true]) {
        const s = splitCommission({ approvedCommission, network: "shopee", withheld });
        expect(s.operatorShare).toBe(approvedCommission - s.fee - s.tax - s.cashback);
        for (const v of Object.values(s)) expect(Number.isSafeInteger(v)).toBe(true);
      }
    }
  });

  it("gives the guest account no cashback", () => {
    const s = splitCommission({ approvedCommission: 100_000, network: "shopee", withheld: false, guest: true });
    expect(s.cashback).toBe(0);
    expect(s.operatorShare).toBe(99_020);
  });

  it("always withholds tax on AccessTrade, whatever the period flag says", () => {
    const s = splitCommission({ approvedCommission: 50_000, network: "accesstrade", withheld: false });
    expect(s.tax).toBe(5_000);
  });

  it("rejects non-integer, negative and unsafe commissions", () => {
    for (const bad of [1.5, -1, Number.MAX_SAFE_INTEGER + 2, Number.NaN]) {
      expect(() => splitCommission({ approvedCommission: bad, network: "shopee", withheld: false })).toThrow(RangeError);
    }
  });
});

describe("shopeeCommission", () => {
  it("rejects rates that are not whole basis points", () => {
    expect(() => shopeeCommission(100_000, 2.5, 0)).toThrow(RangeError);
    expect(() => shopeeCommission(100_000, 10_001, 0)).toThrow(RangeError);
  });
});

describe("fromNetworkUnits", () => {
  it("rejects malformed amounts and scales", () => {
    expect(() => fromNetworkUnits("12,000", 1)).toThrow(RangeError);
    expect(() => fromNetworkUnits(1e21, 1)).toThrow(RangeError);
    expect(() => fromNetworkUnits(100, 0)).toThrow(RangeError);
    expect(() => fromNetworkUnits(2 ** 53 + 2, 100_000)).toThrow(RangeError);
    expect(fromNetworkUnits("10000000000000001", 100_000)).toBe(100_000_000_000);
  });
});
