/**
 * Story 2.1: reading the live system's three timestamp forms. The per-column rules live in
 * apps/server/src/cutover/time-table.ts; this is the parser they share.
 */
import { describe, expect, it } from "vitest";

import { parseLegacyTime } from "../src/index";

describe("parseLegacyTime (Story 2.1, D45)", () => {
  it("AC1: naive datetime('now') text in a UTC column is that UTC instant", () => {
    expect(parseLegacyTime("2026-10-01 05:00:00", "UTC")).toEqual({ instant: "2026-10-01T05:00:00.000Z", hadOffset: false });
  });

  it("AC2: naive text in a Vietnam column is 7 hours earlier in UTC", () => {
    expect(parseLegacyTime("2026-11-01 08:00:00", "VN")?.instant).toBe("2026-11-01T01:00:00.000Z");
    // The admin form's datetime-local value has no seconds.
    expect(parseLegacyTime("2026-11-01T08:00", "VN")?.instant).toBe("2026-11-01T01:00:00.000Z");
  });

  it("AC3: +07:00 and +00:00 offsets name the same instant whatever the column's naive zone", () => {
    for (const zone of ["UTC", "VN", null] as const) {
      expect(parseLegacyTime("2026-10-01T12:00:00+07:00", zone)?.instant).toBe("2026-10-01T05:00:00.000Z");
      expect(parseLegacyTime("2026-10-01T05:00:00+00:00", zone)?.instant).toBe("2026-10-01T05:00:00.000Z");
      expect(parseLegacyTime("2026-10-01T05:00:00Z", zone)?.hadOffset).toBe(true);
    }
  });

  it("keeps milliseconds and truncates Python microseconds", () => {
    expect(parseLegacyTime("2026-10-01T05:00:00.123456+00:00", null)?.instant).toBe("2026-10-01T05:00:00.123Z");
    expect(parseLegacyTime("2026-10-01 05:00:00.5", "UTC")?.instant).toBe("2026-10-01T05:00:00.500Z");
  });

  it("crosses the day boundary for a Vietnam morning", () => {
    expect(parseLegacyTime("2026-10-01T03:00:00+07:00", null)?.instant).toBe("2026-09-30T20:00:00.000Z");
  });

  it("AC5: refuses what fits no rule instead of guessing", () => {
    expect(parseLegacyTime("2026-10-01 05:00:00", null)).toBeNull();
    for (const bad of ["", "yesterday", "2026-10-01", "01/10/2026 05:00", "2026-02-30 10:00:00", "2026-10-01 24:00:00", "1999-12-31 10:00:00", "2026-10-01T05:00:00+15:00", "1789107091"]) {
      expect(parseLegacyTime(bad, "UTC"), bad).toBeNull();
    }
  });
});
