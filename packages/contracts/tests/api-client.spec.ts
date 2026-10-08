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

  it("returns payables", async () => {
    const payables: ApiPayables = { ready: [], blocked: [] };
    const client = createApiClient(fakeFetch(payables));
    expect(await client.payouts()).toEqual(payables);
  });
});
