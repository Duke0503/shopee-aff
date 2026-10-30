import { describe, expect, it } from "vitest";

import { assertDong, roundHalfUp } from "../src/index";

describe("roundHalfUp (D1)", () => {
  it("rounds a half upward, unlike banker's rounding", () => {
    expect(roundHalfUp(185_250n, 20n)).toBe(9_263); // 9,262.5
    expect(roundHalfUp(5n, 2n)).toBe(3); // 2.5
    expect(roundHalfUp(7n, 2n)).toBe(4); // 3.5
  });

  it("keeps values below a half", () => {
    expect(roundHalfUp(4_999n, 10_000n)).toBe(0);
    expect(roundHalfUp(92_624_999n, 10_000n)).toBe(9_262);
  });

  it("is symmetric for negative amounts", () => {
    expect(roundHalfUp(-5n, 2n)).toBe(-3);
  });

  it("rejects a zero denominator and results beyond the safe range", () => {
    expect(() => roundHalfUp(1n, 0n)).toThrow(RangeError);
    expect(() => roundHalfUp(2n ** 60n, 1n)).toThrow(RangeError);
  });

  it("accepts only safe whole dong", () => {
    expect(assertDong(12)).toBe(12);
    expect(() => assertDong(12.5)).toThrow(RangeError);
  });
});
