import { describe, expect, it, vi } from "vitest";
import { ApiError, createApiClient, type ApiPaymentsPage } from "../src/api-client";

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

  it("sends the order filters that were chosen, and no others", async () => {
    const fetchImpl = fakeFetch({ ok: true, orders: [], pagination: {} });
    await createApiClient(fetchImpl, "").adminOrders({
      search: "ao thun",
      status: "approved",
      platform: "shopee",
      fromDate: "2026-10-01",
      toDate: "2026-10-05",
      page: 2,
    });
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toBe(
      "/api/admin/orders?search=ao+thun&status=approved&platform=shopee" +
        "&from_date=2026-10-01&to_date=2026-10-05&page=2",
    );
  });

  it("marks orders paid with the customer the server must check", async () => {
    const fetchImpl = fakeFetch({ ok: true, paid: 1, skipped: [] });
    await createApiClient(fetchImpl, "").markOrdersPaid({ customerId: "C1", orderIds: ["O1"] });
    const init = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ customer_id: "C1", order_ids: ["O1"] });
  });

  it("posts a link to convert", async () => {
    const fetchImpl = fakeFetch({ ready: false, request_id: "R1", house: false });
    await createApiClient(fetchImpl, "").convert("https://shopee.vn/x", "C1");
    const init = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({ url: "https://shopee.vn/x", customerId: "C1" });
  });

  it("searches admin customers, sending only the chosen filters", async () => {
    const fetchImpl = fakeFetch({ ok: true, users: [], pagination: {} });
    await createApiClient(fetchImpl, "").adminUsers({ search: "dp00012", bank: "no_bank", page: 3 });
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toBe(
      "/api/admin/users?search=dp00012&bank=no_bank&page=3",
    );
  });

  it("asks for one customer's page", async () => {
    const fetchImpl = fakeFetch({ ok: true, orders: [] });
    await createApiClient(fetchImpl, "").adminUserDetail("DP00012");
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toBe(
      "/api/admin/users/DP00012",
    );
  });

  it("records a transfer with the fields the server names", async () => {
    const fetchImpl = fakeFetch({ ok: true, transferId: 7, amountVnd: 20000 });
    await createApiClient(fetchImpl, "").recordTransfer({
      customerId: "C1",
      orderIds: ["O1"],
      amountVnd: 20_000,
      note: "DP00012",
      transferCode: "TX1",
    });
    const init = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      customer_id: "C1",
      order_ids: ["O1"],
      amount: 20_000,
      note: "DP00012",
      transfer_code: "TX1",
    });
  });

  it("reads the web labels", async () => {
    const fetchImpl = fakeFetch({ title: "Bảng chuyển tiền" });
    expect(await createApiClient(fetchImpl, "").labels()).toEqual({ title: "Bảng chuyển tiền" });
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toBe("/api/labels");
  });

  it("lists admin campaigns", async () => {
    const fetchImpl = fakeFetch([]);
    await createApiClient(fetchImpl, "").adminCampaigns();
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toBe(
      "/api/admin/campaigns",
    );
  });

  it("lists admin transfers", async () => {
    const fetchImpl = fakeFetch([]);
    await createApiClient(fetchImpl, "").adminTransfers();
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toBe(
      "/api/admin/transfers",
    );
  });

  it("reads the customer balance", async () => {
    const fetchImpl = fakeFetch({ approvedWaitingVnd: 0, stillWithShopVnd: 0, alreadyPaidVnd: 0 });
    await createApiClient(fetchImpl, "").balance();
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toBe("/api/me/balance");
  });

  it("reads the money-out list from the staff route", async () => {
    const page: ApiPaymentsPage = {
      ok: true,
      payables: { ready: [], blocked: [] },
      totals: { readyCount: 0, readyVnd: 0, blockedCount: 0, blockedVnd: 0, allCount: 0, allVnd: 0 },
      transfers: [],
    };
    const fetchImpl = fakeFetch(page);
    const client = createApiClient(fetchImpl, "");
    expect(await client.payouts()).toEqual(page);
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toBe(
      "/api/admin/payments",
    );
  });

  it("asks for one customer's payout plan, and confirms it in the server's words", async () => {
    const plan = fakeFetch({ ok: true, totalVnd: 0, orders: [], qr: null });
    const client = createApiClient(plan, "");
    await client.paymentPlan("C1");
    expect((plan as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toBe(
      "/api/admin/payments/plan?customer_id=C1",
    );

    const confirm = fakeFetch({ ok: true, transferId: 1, amountVnd: 14506, billPath: "/b/T" });
    await createApiClient(confirm, "").confirmPayout({
      customerId: "C1",
      orderIds: ["O1", "O2"],
      transferCode: "FT1",
    });
    const init = (confirm as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({
      customer_id: "C1",
      order_ids: ["O1", "O2"],
      note: "",
      transfer_code: "FT1",
    });
  });
});
