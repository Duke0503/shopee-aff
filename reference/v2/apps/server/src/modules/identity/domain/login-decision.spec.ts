import { describe, expect, it } from "vitest";
import { isLocked, nextFailedAttempt } from "./login-decision";

const NOW = "2026-10-07T21:00:00";

describe("isLocked", () => {
  it("is locked only while locked_until is in the future", () => {
    expect(isLocked("2026-10-07T21:15:00", NOW)).toBe(true);
    expect(isLocked("2026-10-07T20:00:00", NOW)).toBe(false);
    expect(isLocked(null, NOW)).toBe(false);
  });
});

describe("nextFailedAttempt (matches Python authenticate)", () => {
  it("counts up without locking for the first four misses", () => {
    expect(nextFailedAttempt({ failedLogins: 0, lockedUntil: null, status: "active" }, NOW)).toEqual(
      { failedLogins: 1, lockedUntil: null, outcome: "bad_credentials" },
    );
    expect(nextFailedAttempt({ failedLogins: 3, lockedUntil: null, status: "active" }, NOW)).toEqual(
      { failedLogins: 4, lockedUntil: null, outcome: "bad_credentials" },
    );
  });

  it("locks on the fifth miss and resets the counter", () => {
    expect(nextFailedAttempt({ failedLogins: 4, lockedUntil: null, status: "active" }, NOW)).toEqual({
      failedLogins: 0,
      lockedUntil: "2026-10-07T21:15:00",
      outcome: "locked",
    });
  });

  it("clears a stale locked_until on a non-locking miss", () => {
    const result = nextFailedAttempt(
      { failedLogins: 1, lockedUntil: "2026-10-07T20:00:00", status: "active" },
      NOW,
    );
    expect(result.lockedUntil).toBeNull();
  });
});
