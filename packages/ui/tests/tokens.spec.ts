import { describe, expect, it } from "vitest";
import { colors, spacing } from "../src/design-tokens";

describe("design tokens", () => {
  it("exposes the brand colour and a spacing scale", () => {
    expect(colors.brand).toBe("#ee4d2d");
    expect(colors.surface).toBe("#ffffff");
    expect(spacing.md).toBe(12);
  });
});
