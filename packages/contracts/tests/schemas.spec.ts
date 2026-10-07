import { describe, expect, it } from "vitest";
import { BridgeJob, Customer, LinkRequest, Order, ShareCode } from "../src/index";

describe("contracts", () => {
  it("accepts a DP-coded customer and rejects a malformed code", () => {
    expect(Customer.parse({ customerId: "123", role: "user", customerCode: "DP00012" }).role).toBe(
      "user",
    );
    expect(() => Customer.parse({ customerId: "1", role: "user", customerCode: "DP12" })).toThrow();
  });

  it("requires whole-dong integers for money", () => {
    const base = {
      orderId: "o1",
      customerId: "c1",
      platform: "shopee",
      status: "approved",
      valueVnd: 100,
    };
    expect(() => Order.parse({ ...base, valueVnd: 100.5 })).toThrow();
    expect(Order.parse(base).valueVnd).toBe(100);
  });

  it("enforces the sub_id-safe share code and request id formats", () => {
    expect(ShareCode.parse("aZ3k9QpL")).toBe("aZ3k9QpL");
    expect(() => ShareCode.parse("has-dash")).toThrow();
    expect(() =>
      LinkRequest.parse({
        requestId: "R-2610061234",
        customerId: "c1",
        sourceUrl: "https://shopee.vn/x-i.1.2",
        platform: "shopee",
        status: "pending",
      }),
    ).toThrow();
  });

  it("parses a bridge job", () => {
    const job = BridgeJob.parse({ id: "j1", action: "click", params: { selector: "#go" } });
    expect(job.action).toBe("click");
  });
});
