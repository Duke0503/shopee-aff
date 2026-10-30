import { describe, expect, it } from "vitest";
import { extractFirstUrl, parseCommand } from "../src/parse-message";

describe("extractFirstUrl", () => {
  it("pulls the link out of a message", () => {
    expect(extractFirstUrl("shop ơi https://shopee.vn/x-i.1.2 mua giúp")).toBe(
      "https://shopee.vn/x-i.1.2",
    );
  });

  it("trims trailing punctuation", () => {
    expect(extractFirstUrl("xem cái này https://s.shopee.vn/abc.")).toBe("https://s.shopee.vn/abc");
  });

  it("returns the first link when there are several", () => {
    expect(extractFirstUrl("a https://a.com b https://b.com")).toBe("https://a.com");
  });

  it("returns null when there is no link", () => {
    expect(extractFirstUrl("xin chao")).toBeNull();
    expect(extractFirstUrl("")).toBeNull();
  });
});

describe("parseCommand", () => {
  it("reads a command and its arguments", () => {
    expect(parseCommand("/donhang")).toEqual({ command: "donhang", args: [] });
    expect(parseCommand("/bank VCB 123")).toEqual({ command: "bank", args: ["VCB", "123"] });
  });

  it("is case-insensitive on the command name", () => {
    expect(parseCommand("/DonHang")?.command).toBe("donhang");
  });

  it("returns null for plain text or a bare slash", () => {
    expect(parseCommand("donhang")).toBeNull();
    expect(parseCommand("/")).toBeNull();
  });
});
