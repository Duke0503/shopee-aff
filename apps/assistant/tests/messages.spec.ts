import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { loadMessages, render, type Messages } from "../src/messages";

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
});
