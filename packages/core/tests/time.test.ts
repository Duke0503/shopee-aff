import { describe, expect, it } from "vitest";

import {
  campaignWindow,
  contains,
  fixedClock,
  formatVnDate,
  formatVnDateTime,
  formatVnDateOf,
  formatVnTime,
  formatVnTimeOf,
  nextVnTimeOfDay,
  parseInstant,
  parseStaffVnTime,
  vnDatePreset,
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
    expect(() => vnDateRange("0050-01-01", "0050-01-02")).toThrow(RangeError);
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
  it("formats a time of day alone in Vietnam time, across the UTC date line", () => {
    expect(formatVnTime(parseInstant("2026-10-30T12:42:00.000Z"))).toBe("19:42");
    expect(formatVnTime(parseInstant("2026-10-30T17:05:00.000Z"))).toBe("00:05");
  });
  it("formats an outside value only when it is a stored instant, else null", () => {
    expect(formatVnTimeOf("2026-10-30T12:42:00.000Z")).toBe("19:42");
    expect(formatVnDateOf("2025-10-30T12:42:00.000Z", clock)).toBe("30/10/2025");
    for (const bad of [undefined, null, "", "2026-10-30 12:42", 42]) {
      expect(formatVnTimeOf(bad)).toBeNull();
      expect(formatVnDateOf(bad, clock)).toBeNull();
    }
  });
  it("rejects naive or offset timestamps instead of guessing", () => {
    expect(() => parseInstant("2025-02-30T00:00:00.000Z")).toThrow(RangeError);
    expect(() => parseInstant("2026-10-30T24:00:00.000Z")).toThrow(RangeError);
    expect(() => parseInstant("2026-09-16 16:27:51")).toThrow(RangeError);
    expect(() => parseInstant("2026-09-16T16:27:51+07:00")).toThrow(RangeError);
  });
});

describe("daily Vietnam times for jobs (AD-13, Story 3.1 AC3)", () => {
  it("02:00 Vietnam time is 19:00 UTC of the previous day", () => {
    expect(nextVnTimeOfDay(parseInstant("2026-10-30T07:00:00.000Z"), { hour: 2, minute: 0 })).toBe("2026-10-30T19:00:00.000Z");
    expect(nextVnTimeOfDay(parseInstant("2026-10-30T07:00:00.000Z"), { hour: 3, minute: 0 })).toBe("2026-10-30T20:00:00.000Z");
  });

  it("is strictly after the given instant and rolls to the next Vietnam day", () => {
    expect(nextVnTimeOfDay(parseInstant("2026-10-30T19:00:00.000Z"), { hour: 2, minute: 0 })).toBe("2026-10-31T19:00:00.000Z");
    expect(nextVnTimeOfDay(parseInstant("2026-10-30T18:59:59.999Z"), { hour: 2, minute: 0 })).toBe("2026-10-30T19:00:00.000Z");
    // 01:00 Vietnam time on 31 Oct is still before that day's 02:00.
    expect(nextVnTimeOfDay(parseInstant("2026-10-30T18:00:00.000Z"), { hour: 2, minute: 0 })).toBe("2026-10-30T19:00:00.000Z");
    expect(nextVnTimeOfDay(parseInstant("2026-12-31T20:30:00.000Z"), { hour: 3, minute: 15 })).toBe("2027-01-01T20:15:00.000Z");
  });

  it("refuses a time of day that does not exist", () => {
    expect(() => nextVnTimeOfDay(parseInstant("2026-10-30T07:00:00.000Z"), { hour: 24, minute: 0 })).toThrow(RangeError);
    expect(() => nextVnTimeOfDay(parseInstant("2026-10-30T07:00:00.000Z"), { hour: 2, minute: 1.5 })).toThrow(RangeError);
  });
});

describe("list date presets in Vietnam days (Stories 4.12 AC4 and 4.13 AC1)", () => {
  it("'today' at 06:30 Vietnam time is the Vietnam day, not the UTC one", () => {
    expect(vnDatePreset("today", fixedClock("2026-10-29T23:30:00.000Z"))).toEqual({ from: "2026-10-30", to: "2026-10-30" });
  });

  it("'this month' runs from the 1st to the last day, which a range includes whole", () => {
    expect(vnDatePreset("thisMonth", fixedClock("2026-10-30T12:00:00.000Z"))).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(vnDatePreset("thisMonth", fixedClock("2028-02-10T12:00:00.000Z"))).toEqual({ from: "2028-02-01", to: "2028-02-29" });
    expect(vnDateRange("2026-10-01", "2026-10-31")).toEqual({ from: "2026-09-30T17:00:00.000Z", to: "2026-10-31T17:00:00.000Z" });
  });

  it("'last 7 days' ends today and 'last month' is the whole previous month, across a year", () => {
    expect(vnDatePreset("last7", fixedClock("2026-10-30T12:00:00.000Z"))).toEqual({ from: "2026-10-24", to: "2026-10-30" });
    expect(vnDatePreset("lastMonth", fixedClock("2027-01-05T12:00:00.000Z"))).toEqual({ from: "2026-12-01", to: "2026-12-31" });
  });
});
