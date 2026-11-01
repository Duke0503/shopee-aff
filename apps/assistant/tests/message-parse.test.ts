import { describe, expect, it } from "vitest";

import { extractFirstUrl, parseCommand } from "../src/message-parse";
import { messageText } from "../src/messages";

describe("Story 6.1: reading a message (ported from v2)", () => {
  it("pulls the first link out of a message and trims trailing punctuation", () => {
    expect(extractFirstUrl("shop oi https://shopee.vn/x-i.1.2 mua giup")).toBe("https://shopee.vn/x-i.1.2");
    expect(extractFirstUrl("xem https://s.shopee.vn/abc.")).toBe("https://s.shopee.vn/abc");
    expect(extractFirstUrl("a https://a.com b https://b.com")).toBe("https://a.com");
    expect(extractFirstUrl("xin chao")).toBeNull();
    expect(extractFirstUrl("")).toBeNull();
  });

  it("reads a command and its arguments, case-insensitive on the name", () => {
    expect(parseCommand("/orders")).toEqual({ command: "orders", args: [] });
    expect(parseCommand(" /Bank VCB 123 ")).toEqual({ command: "bank", args: ["VCB", "123"] });
    expect(parseCommand("orders")).toBeNull();
    expect(parseCommand("/")).toBeNull();
  });
});

describe("Story 6.1: message text by key", () => {
  it("AC4: the friend greeting comes from packages/labels/vi/messages.json and placeholders are filled", () => {
    expect(messageText("friend_request_greeting").length).toBeGreaterThan(10);
    expect(messageText("order_rejected", { reason: "x" })).toMatch(/x$/);
  });
});
