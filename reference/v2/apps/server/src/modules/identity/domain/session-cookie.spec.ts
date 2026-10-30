import { describe, expect, it } from "vitest";
import {
  SESSION_COOKIE,
  buildSessionCookie,
  clearSessionCookie,
  parseSessionToken,
  sessionMaxAgeSeconds,
} from "./session-cookie";

describe("session cookie", () => {
  it("sets the expected name and flags", () => {
    const cookie = buildSessionCookie("tok123", "Wed, 07 Oct 2037 00:00:00 GMT", 315_360_000, false);
    expect(cookie).toContain(`${SESSION_COOKIE}=tok123`);
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Max-Age=315360000");
    expect(cookie).not.toContain("Secure");
  });

  it("adds Secure only over HTTPS", () => {
    const cookie = buildSessionCookie("tok", "x", 1, true);
    expect(cookie).toContain("Secure");
  });

  it("clears with Max-Age=0", () => {
    expect(clearSessionCookie()).toContain("Max-Age=0");
  });

  it("parses the token out of a Cookie header", () => {
    expect(parseSessionToken("other=1; cashback_session=tok123; x=2")).toBe("tok123");
    expect(parseSessionToken("other=1")).toBe("");
    expect(parseSessionToken(null)).toBe("");
  });

  it("computes Max-Age from days", () => {
    expect(sessionMaxAgeSeconds(3650)).toBe(315_360_000);
  });
});
