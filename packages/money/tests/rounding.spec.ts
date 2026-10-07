import { describe, expect, it } from "vitest";
import { legacyRoundHalfEven, roundDong } from "../src/rounding";

describe("roundDong — half up (matches Python round_dong)", () => {
  it("rounds a half upward", () => {
    expect(roundDong(9262.5)).toBe(9263);
    expect(roundDong(0.5)).toBe(1);
    expect(roundDong(1234.5)).toBe(1235);
    expect(roundDong(122.5)).toBe(123);
  });

  it("keeps values below a half", () => {
    expect(roundDong(9262.4)).toBe(9262);
    expect(roundDong(35_608.4)).toBe(35_608);
    expect(roundDong(176_883.4)).toBe(176_883);
  });

  it("returns whole numbers unchanged", () => {
    expect(roundDong(0)).toBe(0);
    expect(roundDong(9506)).toBe(9506);
    expect(roundDong(10_000)).toBe(10_000);
  });
});

describe("legacyRoundHalfEven — half to even (matches Python built-in round)", () => {
  it("rounds a half to the nearest even number", () => {
    expect(legacyRoundHalfEven(122.5)).toBe(122);
    expect(legacyRoundHalfEven(1234.5)).toBe(1234);
    expect(legacyRoundHalfEven(123.5)).toBe(124);
    expect(legacyRoundHalfEven(2.5)).toBe(2);
    expect(legacyRoundHalfEven(3.5)).toBe(4);
  });

  it("rounds ordinary values to nearest", () => {
    expect(legacyRoundHalfEven(117.6)).toBe(118);
    expect(legacyRoundHalfEven(120.981)).toBe(121);
    expect(legacyRoundHalfEven(1200)).toBe(1200);
  });
});
