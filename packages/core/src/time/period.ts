/**
 * The Overview's period and its comparison (FR-25, FR-38, D28, docs/operations/dashboard-spec.md):
 * Vietnam calendar days, the end day included. Every period figure compares with the previous
 * period of the same length:
 *
 *   today       today                         vs yesterday
 *   last7       the last 7 days, today in     vs the 7 days before
 *   thisMonth   the 1st to today              vs the 1st of last month to the same day (or its last day)
 *   lastMonth   the whole previous month      vs the whole month before it
 *   custom      the days chosen (<= 366)      vs the same number of days just before
 *
 * "This month" ends today, not on the 31st: the days still to come hold nothing, and comparing
 * them with a whole month would make every month look worse until it ends. Weeks run Monday to
 * Sunday, Vietnam days.
 */
import { addVnDays, parseVnDate, vnToday, type Clock, type VnDate } from "./instant";

export const OVERVIEW_PERIODS = ["today", "last7", "thisMonth", "lastMonth", "custom"] as const;
export type OverviewPeriodPreset = (typeof OVERVIEW_PERIODS)[number];

/** The longest custom period: one year and a day. */
export const MAX_PERIOD_DAYS = 366;

export interface VnDays {
  readonly from: VnDate;
  /** Included. */
  readonly to: VnDate;
}

export interface OverviewPeriod extends VnDays {
  readonly preset: OverviewPeriodPreset;
  readonly previous: VnDays;
}

const DAY_MS = 86_400_000;

/** Days from `from` to `to`, both included. */
export function vnDaysBetween(from: VnDate, to: VnDate): number {
  return Math.trunc((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS) + 1;
}

const monthStart = (date: VnDate): VnDate => parseVnDate(`${date.slice(0, 7)}-01`);
const monthEnd = (date: VnDate): VnDate => addVnDays(monthStart(addVnDays(monthStart(date), 31)), -1);
const before = (days: VnDays): VnDays => {
  const length = vnDaysBetween(days.from, days.to);
  return { from: addVnDays(days.from, -length), to: addVnDays(days.from, -1) };
};

function thisMonth(today: VnDate): OverviewPeriod {
  const from = monthStart(today);
  const lastMonthStart = monthStart(addVnDays(from, -1));
  const sameDay = addVnDays(lastMonthStart, Number(today.slice(8, 10)) - 1);
  const lastMonthEnd = addVnDays(from, -1);
  return { preset: "thisMonth", from, to: today, previous: { from: lastMonthStart, to: sameDay > lastMonthEnd ? lastMonthEnd : sameDay } };
}

/** The period of a preset on the clock's Vietnam day; `custom` needs both days, in order, at most 366 days. */
export function overviewPeriod(preset: OverviewPeriodPreset, clock: Clock, custom?: { from: string; to: string }): OverviewPeriod {
  const today = vnToday(clock);
  switch (preset) {
    case "today":
      return { preset, from: today, to: today, previous: before({ from: today, to: today }) };
    case "last7": {
      const days = { from: addVnDays(today, -6), to: today };
      return { preset, ...days, previous: before(days) };
    }
    case "thisMonth":
      return thisMonth(today);
    case "lastMonth": {
      const from = monthStart(addVnDays(monthStart(today), -1));
      const previousFrom = monthStart(addVnDays(from, -1));
      return { preset, from, to: monthEnd(from), previous: { from: previousFrom, to: monthEnd(previousFrom) } };
    }
    case "custom": {
      if (custom === undefined) throw new RangeError("a custom period needs its first and last day");
      const days = { from: parseVnDate(custom.from), to: parseVnDate(custom.to) };
      const length = vnDaysBetween(days.from, days.to);
      if (length < 1 || length > MAX_PERIOD_DAYS) throw new RangeError(`a custom period is 1 to ${MAX_PERIOD_DAYS} days`);
      return { preset, ...days, previous: before(days) };
    }
  }
}

/** The Monday of the Vietnam week a day falls in. */
export function vnWeekStart(date: VnDate): VnDate {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  return addVnDays(date, -((weekday + 6) % 7));
}
