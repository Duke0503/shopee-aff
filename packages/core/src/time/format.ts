/**
 * Display formats (EXPERIENCE.md date rules): `30/10` in the current Vietnam
 * year, `30/10/2025` otherwise; with time `30/10 19:42`. A table whose rows span months and is
 * filtered by date (the desk's Orders, owner 2026-10-18) shows the year always: `30/10/2026 19:42`.
 */
import { INSTANT_PATTERN, toMs, vnDateOf, VN_OFFSET_MINUTES, type Clock, type Instant } from "./instant";

function vnParts(instant: Instant) {
  const shifted = new Date(toMs(instant) + VN_OFFSET_MINUTES * 60_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    year: shifted.getUTCFullYear(),
    dayMonth: `${pad(shifted.getUTCDate())}/${pad(shifted.getUTCMonth() + 1)}`,
    time: `${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`,
    seconds: pad(shifted.getUTCSeconds()),
  };
}

export function formatVnDate(instant: Instant, clock: Clock): string {
  const p = vnParts(instant);
  const currentYear = Number(vnDateOf(clock.now()).slice(0, 4));
  return p.year === currentYear ? p.dayMonth : `${p.dayMonth}/${p.year}`;
}

export function formatVnDateTime(instant: Instant, clock: Clock): string {
  return `${formatVnDate(instant, clock)} ${vnParts(instant).time}`;
}

/** `30/10/2026 19:42` in Vietnam time, the year always shown. */
export function formatVnDateTimeWithYear(instant: Instant): string {
  const p = vnParts(instant);
  return `${p.dayMonth}/${p.year} ${p.time}`;
}

/**
 * `19:42:05 - 30/10/2026` in Vietnam time: the stamp the live system's owner alerts on Telegram
 * carried (telegram_alerts.py, `%H:%M:%S - %d/%m/%Y`).
 */
export function formatVnAlertStamp(instant: Instant): string {
  const p = vnParts(instant);
  return `${p.time}:${p.seconds} - ${p.dayMonth}/${p.year}`;
}

/** `19:42` in Vietnam time, for "updated at" and stale lines beside a list. */
export function formatVnTime(instant: Instant): string {
  return vnParts(instant).time;
}

const isInstant = (value: unknown): value is Instant => typeof value === "string" && INSTANT_PATTERN.test(value);

/**
 * For a value that came from outside (a response field, a URL): its Vietnam time of day when it
 * is a stored instant, or null when it is missing or not an instant, so the caller shows a dash.
 */
export function formatVnTimeOf(value: unknown): string | null {
  return isInstant(value) ? formatVnTime(value) : null;
}

/** The same for the display date (`30/10`, or `30/10/2025` in another year). */
export function formatVnDateOf(value: unknown, clock: Clock): string | null {
  return isInstant(value) ? formatVnDate(value, clock) : null;
}

/** The same with the year always (`30/10/2026 19:42`), or null when the value is not a stored instant. */
export function formatVnDateTimeWithYearOf(value: unknown): string | null {
  return isInstant(value) ? formatVnDateTimeWithYear(value) : null;
}
