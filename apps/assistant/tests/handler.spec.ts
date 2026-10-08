import { describe, expect, it } from "vitest";
import { handleIncoming, type HandlerDeps, type IncomingMessage } from "../src/handler";

const message = (text: string): IncomingMessage => ({ text, customerId: "C1", nowMs: 1000 });

const deps = (over: Partial<HandlerDeps> = {}): HandlerDeps => ({
  convert: async () => ({ ready: true, affiliate_url: "https://s.shopee.vn/aff", request_id: "R1", house: false }),
  myOrders: async () => [{ orderId: "O1" } as never],
  saveBank: async () => undefined,
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
    const reply = await handleIncoming(message("/donhang"), deps());
    expect(reply.kind).toBe("orders");
  });

  it("saves bank details on /bank", async () => {
    expect((await handleIncoming(message("/bank VCB 123"), deps())).kind).toBe("bank_saved");
  });

  it("asks for details on a bare /bank", async () => {
    expect((await handleIncoming(message("/bank"), deps())).kind).toBe("bank_needs_details");
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
