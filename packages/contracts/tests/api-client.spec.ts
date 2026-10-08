import { describe, expect, it, vi } from "vitest";
import { ApiError, createApiClient, type ApiPayables } from "../src/api-client";

function fakeFetch(payload: unknown, ok = true, status = 200): typeof fetch {
  return vi.fn(async () => ({
    ok,
    status,
    json: async () => payload,
    text: async () => String(payload),
  })) as unknown as typeof fetch;
}

describe("createApiClient", () => {
  it("requests the right path and returns the payload", async () => {
    const fetchImpl = fakeFetch({ customerId: "C1", role: "user" });
    const client = createApiClient(fetchImpl, "http://server");
    const me = await client.me();
    expect(me.customerId).toBe("C1");
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toBe(
      "http://server/api/me",
    );
  });

  it("posts credentials as JSON for login", async () => {
    const fetchImpl = fakeFetch({ customerId: "C1" });
    const client = createApiClient(fetchImpl, "");
    await client.login("DP00012", "ABCDEFGH");
    const init = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ name: "DP00012", password: "ABCDEFGH" });
  });

  it("throws an ApiError on a non-OK response", async () => {
    const client = createApiClient(fakeFetch("not signed in", false, 401));
    await expect(client.me()).rejects.toBeInstanceOf(ApiError);
  });

  it("returns the customer's own orders", async () => {
    const client = createApiClient(fakeFetch([{ orderId: "O1" }]));
    expect(await client.myOrders()).toEqual([{ orderId: "O1" }]);
  });

  it("filters admin orders by status", async () => {
    const fetchImpl = fakeFetch([]);
    await createApiClient(fetchImpl, "").adminOrders("approved");
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toBe(
      "/api/admin/orders?status=approved",
    );
  });

  it("posts a link to convert", async () => {
    const fetchImpl = fakeFetch({ ready: false, request_id: "R1", house: false });
    await createApiClient(fetchImpl, "").convert("https://shopee.vn/x", "C1");
    const init = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({ url: "https://shopee.vn/x", customerId: "C1" });
  });

  it("returns payables", async () => {
    const payables: ApiPayables = { ready: [], blocked: [] };
    const client = createApiClient(fakeFetch(payables));
    expect(await client.payouts()).toEqual(payables);
  });
});
