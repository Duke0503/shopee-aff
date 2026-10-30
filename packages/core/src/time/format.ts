/**
 * Display formats (EXPERIENCE.md date rules): `30/10` in the current Vietnam
 * year, `30/10/2025` otherwise; with time `30/10 19:42`.
 */
import { INSTANT_PATTERN, toMs, vnDateOf, VN_OFFSET_MINUTES, type Clock, type Instant } from "./instant";

function vnParts(instant: Instant) {
  const shifted = new Date(toMs(instant) + VN_OFFSET_MINUTES * 60_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    year: shifted.getUTCFullYear(),
    dayMonth: `${pad(shifted.getUTCDate())}/${pad(shifted.getUTCMonth() + 1)}`,
    time: `${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`,
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
