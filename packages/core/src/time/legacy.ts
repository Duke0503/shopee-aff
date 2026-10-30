/**
 * Reading the live system's timestamps (AD-11, AD-24, D45). The live ledger holds three
 * text forms: ISO with `+07:00` (its `now()`), ISO with `+00:00` (`datetime.now(utc)`) and
 * naive `YYYY-MM-DD HH:MM:SS` (SQLite `datetime('now')`, UTC; or a time typed by staff,
 * Vietnam time). A value with an offset is one exact instant. A naive value means nothing
 * without its column, so the caller says which zone the column's writers used; a column
 * that never had a naive writer passes `null`, and its naive values are refused, not guessed.
 */
import { instantFromMs, VN_OFFSET_MINUTES, type Instant } from "./instant";

/** The zone a column's naive values were written in, or null when none should exist. */
export type NaiveZone = "UTC" | "VN" | null;

export interface LegacyTime {
  readonly instant: Instant;
  /** True when the text carried its own offset (or `Z`). */
  readonly hadOffset: boolean;
}

const LEGACY = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,6}))?)?(Z|[+-]\d{2}:\d{2})?$/;

const MIN_YEAR = 2000;
const MAX_YEAR = 2099;

function offsetMinutes(offset: string): number {
  if (offset === "Z") return 0;
  const sign = offset.startsWith("-") ? -1 : 1;
  const [hours = 0, minutes = 0] = offset.slice(1).split(":").map(Number);
  return sign * (hours * 60 + minutes);
}

/** Milliseconds from the fraction digits, truncated (Python writes microseconds). */
function fractionMs(fraction: string | undefined): number {
  return fraction ? Number(fraction.padEnd(3, "0").slice(0, 3)) : 0;
}

function wallClockMs(parts: number[]): number | null {
  const [year = 0, month = 0, day = 0, hour = 0, minute = 0, second = 0] = parts;
  if (year < MIN_YEAR || year > MAX_YEAR || hour > 23 || minute > 59 || second > 59) return null;
  const ms = Date.UTC(year, month - 1, day, hour, minute, second);
  const back = new Date(ms);
  if (back.getUTCMonth() !== month - 1 || back.getUTCDate() !== day) return null;
  return ms;
}

/**
 * The instant a live value names, or null when the text is not a live timestamp form, is
 * not a real calendar time, or is naive in a column whose naive zone is null.
 */
export function parseLegacyTime(text: string, naiveZone: NaiveZone): LegacyTime | null {
  const m = LEGACY.exec(text.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s, fraction, offset] = m;
  const wall = wallClockMs([y, mo, d, h, mi, s ?? "0"].map(Number));
  if (wall === null) return null;
  let shiftMinutes: number;
  if (offset !== undefined) {
    shiftMinutes = offsetMinutes(offset);
    if (Math.abs(shiftMinutes) > 14 * 60) return null;
  } else if (naiveZone === "UTC") {
    shiftMinutes = 0;
  } else if (naiveZone === "VN") {
    shiftMinutes = VN_OFFSET_MINUTES;
  } else {
    return null;
  }
  return { instant: instantFromMs(wall + fractionMs(fraction) - shiftMinutes * 60_000), hadOffset: offset !== undefined };
}
