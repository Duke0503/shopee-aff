import { describe, expect, it } from "vitest";
import { SHARE_CODE_LENGTH, generateShareCode, isValidShareCode } from "./share-code";

describe("share codes", () => {
  it("generates eight letters and digits", () => {
    for (let i = 0; i < 50; i += 1) {
      const code = generateShareCode();
      expect(code).toHaveLength(SHARE_CODE_LENGTH);
      expect(isValidShareCode(code)).toBe(true);
    }
  });

  it("rejects codes of the wrong shape", () => {
    expect(isValidShareCode("short")).toBe(false);
    expect(isValidShareCode("has-dash")).toBe(false);
    expect(isValidShareCode("123456789")).toBe(false);
  });

  it("finds a fresh code when the caller rejects the previous one", () => {
    const taken = generateShareCode();
    const fresh = generateShareCode();
    expect(fresh).not.toBe(taken);
  });
});
