import { describe, expect, it } from "vitest";
import { customerCodeFor, formatCustomerCode, parseCustomerCode } from "./customer-code";

describe("formatCustomerCode", () => {
  it("pads to five digits", () => {
    expect(formatCustomerCode(0)).toBe("DP00000");
    expect(formatCustomerCode(12)).toBe("DP00012");
    expect(formatCustomerCode(99_999)).toBe("DP99999");
  });

  it("refuses values outside the range", () => {
    expect(() => formatCustomerCode(100_000)).toThrow(RangeError);
    expect(() => formatCustomerCode(-1)).toThrow(RangeError);
    expect(() => formatCustomerCode(1.5)).toThrow(RangeError);
  });
});

describe("parseCustomerCode", () => {
  it("accepts how a person actually types it", () => {
    expect(parseCustomerCode("DP00012")).toBe("DP00012");
    expect(parseCustomerCode("dp00012")).toBe("DP00012");
    expect(parseCustomerCode("DP 00012")).toBe("DP00012");
    expect(parseCustomerCode("  dp 00012 ")).toBe("DP00012");
  });

  it("rejects anything that is not a DP code", () => {
    expect(parseCustomerCode("DP12")).toBeNull();
    expect(parseCustomerCode("DP0012")).toBeNull();
    expect(parseCustomerCode("C0036")).toBeNull();
    expect(parseCustomerCode("DP000123")).toBeNull();
    expect(parseCustomerCode("DP0000A")).toBeNull();
  });
});

describe("customerCodeFor", () => {
  it("staff and HOUSE get no code", () => {
    expect(customerCodeFor("admin")).toBeNull();
    expect(customerCodeFor("employee")).toBeNull();
    expect(customerCodeFor("house")).toBeNull();
    expect(customerCodeFor("user")).toBe("assign");
  });
});
