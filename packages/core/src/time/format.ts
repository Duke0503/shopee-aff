/**
 * Display formats (EXPERIENCE.md date rules): `30/10` in the current Vietnam
 * year, `30/10/2025` otherwise; with time `30/10 19:42`.
 */
import { toMs, vnDateOf, VN_OFFSET_MINUTES, type Clock, type Instant } from "./instant";

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
