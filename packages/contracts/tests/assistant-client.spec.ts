import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../src/api-client";
import { createAssistantClient } from "../src/assistant-client";

function fakeFetch(payload: unknown, ok = true, status = 200): typeof fetch {
  return vi.fn(async () => ({
    ok,
    status,
    json: async () => payload,
    text: async () => String(payload),
  })) as unknown as typeof fetch;
}

const callOf = (fetchImpl: typeof fetch, index = 0): [string, RequestInit] => {
  const calls = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls as [
    string,
    RequestInit,
  ][];
  return calls[index] as [string, RequestInit];
};

describe("createAssistantClient", () => {
  it("sends the assistant token and a key that is safe in a URL", async () => {
    const fetchImpl = fakeFetch({ customerId: "C1" });
    const customer = await createAssistantClient(fetchImpl, "http://internal", "tok").resolveCustomer(
      "DP 00012",
    );
    expect(customer.customerId).toBe("C1");
    const [url, init] = callOf(fetchImpl);
    expect(url).toBe("http://internal/internal/customers/DP%2000012");
    expect((init.headers as Record<string, string>)["x-assistant-token"]).toBe("tok");
  });

  it("reads a customer's orders", async () => {
    const fetchImpl = fakeFetch([{ orderId: "O1" }]);
    const orders = await createAssistantClient(fetchImpl, "", "tok").orders("DP00012");
    expect(orders).toEqual([{ orderId: "O1" }]);
    expect(callOf(fetchImpl)[0]).toBe("/internal/customers/DP00012/orders");
  });

  it("posts bank details for a customer", async () => {
    const fetchImpl = fakeFetch({ ok: true });
    const details = { bankName: "VCB", bankAccount: "123", accountHolder: "LAN" };
    await createAssistantClient(fetchImpl, "", "tok").saveBank("DP00012", details);
    const [url, init] = callOf(fetchImpl);
    expect(url).toBe("/internal/customers/DP00012/bank");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual(details);
  });

  it("throws an ApiError when the token is rejected", async () => {
    const client = createAssistantClient(fakeFetch("nope", false, 401), "", "bad");
    await expect(client.balance("C1")).rejects.toBeInstanceOf(ApiError);
  });
});
