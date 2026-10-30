import { describe, expect, it } from "vitest";
import { handleIncoming, type HandlerDeps, type IncomingMessage } from "../src/handler";

const message = (text: string): IncomingMessage => ({ text, customerId: "C1", nowMs: 1000 });

const deps = (over: Partial<HandlerDeps> = {}): HandlerDeps => ({
  convert: async () => ({
    ready: true,
    affiliate_url: "https://s.shopee.vn/aff",
    request_id: "R1",
    house: false,
  }),
  myOrders: async () => [{ orderId: "O1" } as never],
  resolveCustomer: async () => ({ customerId: "C1", customerCode: "DP00012" }),
  issuePassword: async () => ({ customerCode: "DP00012", password: "ABCDEFGH" }),
  bankDetails: async () => ({
    hasBank: false,
    bankName: null,
    bankAccount: null,
    accountHolder: null,
  }),
  saveBank: async () => undefined,
  eraseBank: async () => undefined,
  balance: async () => ({ approvedWaitingVnd: 0, stillWithShopVnd: 0, alreadyPaidVnd: 0 }),
  deals: async () => [],
  ...over,
});

describe("handleIncoming", () => {
  it("replies with a link when one is ready", async () => {
    expect(await handleIncoming(message("mua https://shopee.vn/x"), deps())).toEqual({
      kind: "link",
      affiliateUrl: "https://s.shopee.vn/aff",
    });
  });

  it("waits when the link is still being made", async () => {
    const d = deps({
      convert: async () => ({ ready: false, affiliate_url: null, request_id: "R2", house: false }),
    });
    expect(await handleIncoming(message("https://shopee.vn/x"), d)).toEqual({
      kind: "link_pending",
      requestId: "R2",
    });
  });

  it("reports an unsupported link", async () => {
    const d = deps({
      convert: async () => {
        throw new Error("400");
      },
    });
    expect((await handleIncoming(message("https://example.com/x"), d)).kind).toBe("unsupported_link");
  });

  it("answers /donhang with orders", async () => {
    expect((await handleIncoming(message("/donhang"), deps())).kind).toBe("orders");
  });

  it("answers /id with the customer's account", async () => {
    expect(await handleIncoming(message("/id"), deps())).toEqual({
      kind: "account",
      customerId: "C1",
      customerCode: "DP00012",
    });
  });

  it("issues a password on /matkhau", async () => {
    const reply = await handleIncoming(message("/matkhau"), deps());
    expect(reply).toMatchObject({ kind: "password", password: "ABCDEFGH" });
  });

  it("saves bank details on /bank with details", async () => {
    expect((await handleIncoming(message("/bank VCB 123"), deps())).kind).toBe("bank_saved");
  });

  it("shows the saved account on a bare /bank", async () => {
    const d = deps({
      bankDetails: async () => ({
        hasBank: true,
        bankName: "VCB",
        bankAccount: "123",
        accountHolder: "LAN",
      }),
    });
    expect((await handleIncoming(message("/bank"), d)).kind).toBe("bank_current");
  });

  it("reports an unknown command", async () => {
    expect(await handleIncoming(message("/xyz"), deps())).toEqual({
      kind: "unknown_command",
      command: "xyz",
    });
  });

  it("stays silent on plain chat", async () => {
    expect((await handleIncoming(message("xin chao"), deps())).kind).toBe("silent");
  });
});
