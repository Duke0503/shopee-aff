/**
 * Instants (AD-11, FR-38, D28). The only code that creates, parses or formats them.
 *
 * An instant is stored and sent as UTC text `YYYY-MM-DDTHH:mm:ss.sssZ`. Business
 * days are Asia/Ho_Chi_Minh, which is UTC+7 all year (Vietnam has no daylight
 * saving), so a Vietnam calendar day starts at 17:00 UTC of the previous day.
 */

export type Instant = string & { readonly __brand: "Instant" };

/** A Vietnam calendar date, `YYYY-MM-DD`. */
export type VnDate = string & { readonly __brand: "VnDate" };

export const VN_OFFSET_MINUTES = 7 * 60;
const VN_OFFSET_MS = VN_OFFSET_MINUTES * 60_000;
/** The stored instant format. Contracts reuse it; nothing else may define its own. */
export const INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const INSTANT = INSTANT_PATTERN;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export interface Clock {
  now(): Instant;
}

export const systemClock: Clock = {
  now: () => instantFromMs(Date.now()),
};

export function fixedClock(at: string): Clock {
  const instant = parseInstant(at);
  return { now: () => instant };
}

export function instantFromMs(ms: number): Instant {
  if (!Number.isFinite(ms)) throw new RangeError(`not a time: ${ms}`);
  return new Date(ms).toISOString() as Instant;
}

export function toMs(instant: Instant): number {
  return Date.parse(instant);
}

/** Parse stored instant text; anything else is rejected rather than guessed. */
export function parseInstant(text: string): Instant {
  const ms = Date.parse(text);
  if (!INSTANT.test(text) || Number.isNaN(ms) || new Date(ms).toISOString() !== text) {
    throw new RangeError(`not a UTC instant (YYYY-MM-DDTHH:mm:ss.sssZ): ${text}`);
  }
  return text as Instant;
}

/** Years outside this range are typing mistakes, not business dates. */
const MIN_YEAR = 2000;
const MAX_YEAR = 2099;

export function parseVnDate(text: string): VnDate {
  const m = DATE.exec(text);
  if (!m) throw new RangeError(`not a date (YYYY-MM-DD): ${text}`);
  const [, y, mo, d] = m;
  const year = Number(y);
  if (year < MIN_YEAR || year > MAX_YEAR) throw new RangeError(`year out of range ${MIN_YEAR}-${MAX_YEAR}: ${text}`);
  const back = new Date(Date.UTC(year, Number(mo) - 1, Number(d)));
  if (back.getUTCMonth() !== Number(mo) - 1 || back.getUTCDate() !== Number(d)) {
    throw new RangeError(`not a calendar date: ${text}`);
  }
  return text as VnDate;
}

/** The instant a Vietnam calendar day starts. */
export function vnDayStart(date: VnDate): Instant {
  const [y, mo, d] = date.split("-").map(Number) as [number, number, number];
  return instantFromMs(Date.UTC(y, mo - 1, d) - VN_OFFSET_MS);
}

export function addVnDays(date: VnDate, days: number): VnDate {
  const start = toMs(vnDayStart(date)) + VN_OFFSET_MS + days * 86_400_000;
  return new Date(start).toISOString().slice(0, 10) as VnDate;
}

/** The Vietnam calendar date an instant falls on. */
export function vnDateOf(instant: Instant): VnDate {
  return new Date(toMs(instant) + VN_OFFSET_MS).toISOString().slice(0, 10) as VnDate;
}

export function vnToday(clock: Clock): VnDate {
  return vnDateOf(clock.now());
}
