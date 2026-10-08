import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { loadMessages, formatVnd, render, type Messages } from "../src/messages";

const sample: Messages = {
  greeting: "Hello {name}",
  no_placeholders: "Done.",
};

describe("render", () => {
  it("fills placeholders", () => {
    expect(render(sample, "greeting", { name: "Lan" })).toBe("Hello Lan");
  });

  it("leaves an unknown placeholder alone", () => {
    expect(render(sample, "greeting")).toBe("Hello {name}");
  });

  it("throws on an unknown key rather than sending nothing", () => {
    expect(() => render(sample, "missing")).toThrow(/unknown message key/);
  });
});

describe("the real message file", () => {
  const messages = loadMessages(
    fileURLToPath(new URL("../../../resources/messages.vi.json", import.meta.url)),
  );

  it("renders a real customer message", () => {
    const text = render(messages, "unknown_command", { command: "/abc", commands: "help" });
    expect(text).toContain("/abc");
    expect(text).toContain("help");
  });

  it("has the currency and separator keys", () => {
    expect(messages.currency).toBe("đ");
    expect(messages.thousands_separator).toBe(".");
  });

  it("formats whole dong the way the customer reads it", () => {
    expect(formatVnd(messages, 40000)).toBe("40.000đ");
    expect(formatVnd(messages, 1234.6)).toBe("1.234đ");
    expect(formatVnd(messages, 0)).toBe("0đ");
  });
});
