/**
 * Story 4.17: the Overview's periods and their comparisons in Vietnam days (FR-38, D28,
 * dashboard-spec "Period and time bases").
 */
import { describe, expect, it } from "vitest";

import { fixedClock, overviewPeriod, vnDaysBetween, vnWeekStart, parseVnDate } from "../src/index";

const at = (iso: string) => fixedClock(iso);

describe("overviewPeriod", () => {
  it("AC2: at 06:30 on 1 November in Vietnam (23:30 UTC on 31 October) today and this month are November", () => {
    const clock = at("2026-10-31T23:30:00.000Z");
    expect(overviewPeriod("today", clock)).toEqual({ preset: "today", from: "2026-11-01", to: "2026-11-01", previous: { from: "2026-10-31", to: "2026-10-31" } });
    expect(overviewPeriod("thisMonth", clock)).toEqual({ preset: "thisMonth", from: "2026-11-01", to: "2026-11-01", previous: { from: "2026-10-01", to: "2026-10-01" } });
  });

  it("this month runs to today and compares with the same days of last month, clamped to its last day", () => {
    expect(overviewPeriod("thisMonth", at("2026-10-30T05:00:00.000Z"))).toMatchObject({ from: "2026-10-01", to: "2026-10-30", previous: { from: "2026-09-01", to: "2026-09-30" } });
    expect(overviewPeriod("thisMonth", at("2026-03-31T05:00:00.000Z"))).toMatchObject({ from: "2026-03-01", to: "2026-03-31", previous: { from: "2026-02-01", to: "2026-02-28" } });
  });

  it("7 days include today and compare with the 7 before; last month compares with the month before", () => {
    const clock = at("2026-10-30T05:00:00.000Z");
    expect(overviewPeriod("last7", clock)).toMatchObject({ from: "2026-10-24", to: "2026-10-30", previous: { from: "2026-10-17", to: "2026-10-23" } });
    expect(overviewPeriod("lastMonth", clock)).toMatchObject({ from: "2026-09-01", to: "2026-09-30", previous: { from: "2026-08-01", to: "2026-08-31" } });
    expect(overviewPeriod("lastMonth", at("2026-01-15T05:00:00.000Z"))).toMatchObject({ from: "2025-12-01", to: "2025-12-31", previous: { from: "2025-11-01", to: "2025-11-30" } });
  });

  it("a custom period compares with the same number of days just before, and refuses a reversed or over-366-day range", () => {
    const clock = at("2026-10-30T05:00:00.000Z");
    expect(overviewPeriod("custom", clock, { from: "2026-10-01", to: "2026-10-15" })).toMatchObject({ previous: { from: "2026-09-16", to: "2026-09-30" } });
    expect(() => overviewPeriod("custom", clock, { from: "2026-10-15", to: "2026-10-01" })).toThrow(RangeError);
    expect(() => overviewPeriod("custom", clock, { from: "2025-01-01", to: "2026-10-01" })).toThrow(RangeError);
    expect(() => overviewPeriod("custom", clock)).toThrow(RangeError);
  });

  it("weeks start on Monday and day counts include both ends", () => {
    expect(vnWeekStart(parseVnDate("2026-10-30"))).toBe("2026-10-26");
    expect(vnWeekStart(parseVnDate("2026-10-26"))).toBe("2026-10-26");
    expect(vnWeekStart(parseVnDate("2026-11-01"))).toBe("2026-10-26");
    expect(vnDaysBetween(parseVnDate("2026-10-01"), parseVnDate("2026-10-31"))).toBe(31);
  });
});
