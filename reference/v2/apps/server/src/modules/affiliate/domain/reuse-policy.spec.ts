import { describe, expect, it } from "vitest";
import { DEFAULT_ATTRIBUTION_DAYS, isWithinResendWindow, resendCutoffLocal } from "./reuse-policy";

describe("resend window (not an expiry)", () => {
  it("reuses a link made after the cutoff, and makes a new one before it", () => {
    const cutoff = "2026-10-01T00:00:00";
    expect(isWithinResendWindow("2026-10-05T09:00:00", cutoff)).toBe(true);
    expect(isWithinResendWindow("2026-09-20T09:00:00", cutoff)).toBe(false);
  });

  it("defaults to seven days", () => {
    expect(DEFAULT_ATTRIBUTION_DAYS).toBe(7);
  });

  it("produces a cutoff seven days before now, in local ISO", () => {
    const now = Date.parse("2026-10-08T12:00:00");
    const cutoff = resendCutoffLocal(now, DEFAULT_ATTRIBUTION_DAYS);
    expect(cutoff.startsWith("2026-10-01T12:00:00")).toBe(true);
  });
});
