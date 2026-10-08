import { describe, expect, it } from "vitest";
import { handlePasteLink, type PasteLinkDeps } from "../src/paste-link";

const deps = (reply: unknown, throws = false): PasteLinkDeps => ({
  convert: async () => {
    if (throws) throw new Error("400");
    return reply as never;
  },
});

describe("handlePasteLink", () => {
  it("asks nothing when the message has no link", async () => {
    expect(await handlePasteLink("xin chao", "C1", deps({}))).toEqual({ kind: "no_link" });
  });

  it("replies with the link when the server had one ready", async () => {
    const outcome = await handlePasteLink(
      "mua cai nay https://shopee.vn/x",
      "C1",
      deps({ ready: true, affiliate_url: "https://s.shopee.vn/aff", request_id: "R1", house: false }),
    );
    expect(outcome).toEqual({ kind: "ready", affiliateUrl: "https://s.shopee.vn/aff", requestId: "R1" });
  });

  it("waits when the link is still being made", async () => {
    const outcome = await handlePasteLink(
      "https://shopee.vn/x",
      "C1",
      deps({ ready: false, affiliate_url: null, request_id: "R2", house: false }),
    );
    expect(outcome).toEqual({ kind: "pending", requestId: "R2" });
  });

  it("treats a rejected link as unsupported", async () => {
    expect(await handlePasteLink("https://example.com/x", "C1", deps(null, true))).toEqual({
      kind: "unsupported",
    });
  });
});
