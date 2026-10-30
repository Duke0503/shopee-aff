import { describe, expect, it } from "vitest";

import {
  campaignWindow,
  contains,
  fixedClock,
  formatVnDate,
  formatVnDateTime,
  parseInstant,
  parseStaffVnTime,
  vnDateRange,
  vnToday,
} from "../src/index";

describe("Vietnam business days (FR-38, D28)", () => {
  it("includes the whole end day of a date range", () => {
    const r = vnDateRange("2026-10-01", "2026-10-31");
    expect(r).toEqual({ from: "2026-09-30T17:00:00.000Z", to: "2026-10-31T17:00:00.000Z" });
    expect(contains(r, parseInstant("2026-10-31T16:59:00.000Z"))).toBe(true);
    expect(contains(r, parseInstant("2026-10-31T17:00:00.000Z"))).toBe(false);
  });

  it("regression: 'today' is the Vietnam day, not the UTC day", () => {
    expect(vnToday(fixedClock("2026-10-30T18:30:00.000Z"))).toBe("2026-10-31");
    expect(vnToday(fixedClock("2026-10-30T16:59:59.999Z"))).toBe("2026-10-30");
  });

  it("regression: a single-day filter for today returns today's orders", () => {
    const today = vnDateRange("2026-10-30", "2026-10-30");
    expect(contains(today, parseInstant("2026-10-30T13:00:00.000Z"))).toBe(true);
  });

  it("rejects an inverted range and impossible dates", () => {
    expect(() => vnDateRange("2026-10-31", "2026-10-01")).toThrow(RangeError);
    expect(() => vnDateRange("2026-02-30", "2026-03-01")).toThrow(RangeError);
  });
});

describe("campaign windows typed by staff", () => {
  it("regression: a staff-typed end is Vietnam time and exclusive", () => {
    expect(parseStaffVnTime("15/11/2026 00:00")).toBe("2026-11-14T17:00:00.000Z");
    const w = campaignWindow("01/11/2026 00:00", "15/11/2026 00:00");
    expect(contains(w, parseInstant("2026-10-31T17:00:00.000Z"))).toBe(true);
    expect(contains(w, parseInstant("2026-11-14T17:00:00.000Z"))).toBe(false);
  });

  it("rejects malformed staff times", () => {
    expect(() => parseStaffVnTime("2026-11-15 00:00")).toThrow(RangeError);
    expect(() => parseStaffVnTime("15/11/2026 24:00")).toThrow(RangeError);
  });
});

describe("display formats", () => {
  const clock = fixedClock("2026-10-30T12:42:00.000Z");
  it("omits the year in the current year and shows it otherwise", () => {
    expect(formatVnDate(parseInstant("2026-10-30T12:42:00.000Z"), clock)).toBe("30/10");
    expect(formatVnDate(parseInstant("2025-10-30T12:42:00.000Z"), clock)).toBe("30/10/2025");
  });
  it("formats the time in Vietnam time", () => {
    expect(formatVnDateTime(parseInstant("2026-10-30T12:42:00.000Z"), clock)).toBe("30/10 19:42");
  });
  it("rejects naive or offset timestamps instead of guessing", () => {
    expect(() => parseInstant("2026-09-16 16:27:51")).toThrow(RangeError);
    expect(() => parseInstant("2026-09-16T16:27:51+07:00")).toThrow(RangeError);
  });
});
