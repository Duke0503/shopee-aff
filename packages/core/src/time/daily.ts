/**
 * Daily times of day in Vietnam (AD-11, AD-13): the nightly sweep runs at 02:00 and the
 * backup at 03:00 Vietnam time, whatever the server's own zone. The next run is always
 * strictly after `after`, so a run that ends exactly on the hour waits for the next day.
 */
import { addVnDays, instantFromMs, toMs, vnDateOf, vnDayStart, type Instant } from "./instant";

export interface VnTimeOfDay {
  readonly hour: number;
  readonly minute: number;
}

function assertTimeOfDay(at: VnTimeOfDay): void {
  const ok = Number.isInteger(at.hour) && Number.isInteger(at.minute) && at.hour >= 0 && at.hour <= 23 && at.minute >= 0 && at.minute <= 59;
  if (!ok) throw new RangeError(`not a time of day: ${at.hour}:${at.minute}`);
}

/** The first instant strictly after `after` whose Vietnam wall clock reads `at`. */
export function nextVnTimeOfDay(after: Instant, at: VnTimeOfDay): Instant {
  assertTimeOfDay(at);
  const offsetMs = (at.hour * 60 + at.minute) * 60_000;
  const today = vnDateOf(after);
  const candidate = toMs(vnDayStart(today)) + offsetMs;
  if (candidate > toMs(after)) return instantFromMs(candidate);
  return instantFromMs(toMs(vnDayStart(addVnDays(today, 1))) + offsetMs);
}
