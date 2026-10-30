/**
 * Ranges of Vietnam days as half-open instant ranges (FR-38, D22, D28).
 *
 * A calendar range "1 Oct to 31 Oct" covers [start of 1 Oct, start of 1 Nov),
 * so the whole end day is included. Campaign windows typed by staff are Vietnam
 * time and their end is exclusive.
 */
import { addVnDays, parseVnDate, toMs, vnDayStart, vnToday, VN_OFFSET_MINUTES, instantFromMs, type Clock, type Instant, type VnDate } from "./instant";

export interface InstantRange {
  from: Instant;
  /** Exclusive. */
  to: Instant;
}

export function vnDateRange(fromDate: string, toDate: string): InstantRange {
  const from = parseVnDate(fromDate);
  const to = parseVnDate(toDate);
  if (from > to) throw new RangeError(`range starts after it ends: ${fromDate} > ${toDate}`);
  return { from: vnDayStart(from), to: vnDayStart(addVnDays(to, 1)) };
}

/** The quick date choices of a list (EXPERIENCE.md date rules): Vietnam days, the end day included. */
export const VN_DATE_PRESETS = ["today", "last7", "thisMonth", "lastMonth"] as const;
export type VnDatePreset = (typeof VN_DATE_PRESETS)[number];

/** The Vietnam calendar days of a preset, first and last (both included), on the clock's day. */
export function vnDatePreset(preset: VnDatePreset, clock: Clock): { from: VnDate; to: VnDate } {
  const today = vnToday(clock);
  const firstOfMonth = parseVnDate(`${today.slice(0, 7)}-01`);
  switch (preset) {
    case "today":
      return { from: today, to: today };
    case "last7":
      return { from: addVnDays(today, -6), to: today };
    case "thisMonth":
      return { from: firstOfMonth, to: addVnDays(parseVnDate(`${addVnDays(firstOfMonth, 31).slice(0, 7)}-01`), -1) };
    case "lastMonth": {
      const lastDay = addVnDays(firstOfMonth, -1);
      return { from: parseVnDate(`${lastDay.slice(0, 7)}-01`), to: lastDay };
    }
  }
}

export function contains(range: InstantRange, at: Instant): boolean {
  const t = toMs(at);
  return t >= toMs(range.from) && t < toMs(range.to);
}

const STAFF_TIME = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})$/;

/** Parse a time typed by staff as `DD/MM/YYYY HH:mm` in Vietnam time. */
export function parseStaffVnTime(text: string): Instant {
  const m = STAFF_TIME.exec(text.trim());
  if (!m) throw new RangeError(`expected DD/MM/YYYY HH:mm in Vietnam time: ${text}`);
  const [, day = "", month = "", year = "", hour = "", minute = ""] = m;
  if (Number(hour) > 23 || Number(minute) > 59) throw new RangeError(`not a time of day: ${text}`);
  const date = parseVnDate(`${year}-${month}-${day}`);
  return instantFromMs(toMs(vnDayStart(date)) + (Number(hour) * 60 + Number(minute)) * 60_000);
}

/** Campaign window: start inclusive, end exclusive, both typed in Vietnam time. */
export function campaignWindow(start: string, end: string): InstantRange {
  const from = parseStaffVnTime(start);
  const to = parseStaffVnTime(end);
  if (toMs(from) >= toMs(to)) throw new RangeError("campaign window must end after it starts");
  return { from, to };
}

export { VN_OFFSET_MINUTES };
