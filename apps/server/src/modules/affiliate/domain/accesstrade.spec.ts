import { describe, expect, it } from "vitest";

import { parseCommissionRate, parseVndAmount } from "./accesstrade";

describe("parseVndAmount", () => {
  it("reads the spellings AccessTrade sends", () => {
    expect(parseVndAmount("1.234.567đ")).toBe(1_234_567);
    expect(parseVndAmount("1,234,567")).toBe(1_234_567);
    expect(parseVndAmount("250000")).toBe(250_000);
    expect(parseVndAmount("150.000")).toBe(150_000);
    expect(parseVndAmount({ amount: 250_000 })).toBe(250_000);
    expect(parseVndAmount({ minimum_amount: "150.000" })).toBe(150_000);
    expect(parseVndAmount(250_000.4)).toBe(250_000);
  });

  it("treats missing or junk values as zero, never NaN", () => {
    expect(parseVndAmount(null)).toBe(0);
    expect(parseVndAmount(undefined)).toBe(0);
    expect(parseVndAmount("")).toBe(0);
    expect(parseVndAmount("khong co")).toBe(0);
  });
});

describe("parseCommissionRate", () => {
  it("keeps a fraction and divides a percent by ten thousand", () => {
    expect(parseCommissionRate("0.07777")).toBeCloseTo(0.07777);
    expect(parseCommissionRate("7.777")).toBeCloseTo(0.0007777);
    expect(parseCommissionRate(0)).toBe(0);
    expect(parseCommissionRate(null)).toBe(0);
  });
});
