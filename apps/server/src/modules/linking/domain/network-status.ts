/**
 * Raw network statuses, read only through an explicit map (AD-22, D38, code.md §4). Each
 * network lists every raw order and item status it knows with its meaning: AWAITING,
 * APPROVED or CANCELLED. Anything not listed is UNKNOWN, which freezes the order for a
 * person to look at; nothing falls through to a guess. Lookups are own-key only, so a
 * raw value such as "constructor" can never hit something inherited from Object.
 */

export const NETWORK_STATUSES = ["AWAITING", "APPROVED", "CANCELLED", "UNKNOWN"] as const;
export type NetworkStatus = (typeof NETWORK_STATUSES)[number];

/** What a map may say about a raw value it knows; UNKNOWN is never listed, only returned. */
export type KnownNetworkStatus = Exclude<NetworkStatus, "UNKNOWN">;

/** Raw value, normalised by `normaliseRawStatus`, to its meaning. */
export type StatusMap = Readonly<Record<string, KnownNetworkStatus>>;

/** Case and surrounding spaces carry no meaning in a report status ("  pENDing " is "pending"). */
export function normaliseRawStatus(raw: unknown): string {
  if (typeof raw === "string") return raw.trim().toLowerCase();
  if (typeof raw === "number" && Number.isFinite(raw)) return String(raw);
  return "";
}

/** Builds a frozen map with no prototype; keys are normalised and must be unique. */
export function defineStatusMap(entries: Readonly<Record<KnownNetworkStatus, readonly string[]>>): StatusMap {
  const map: Record<string, KnownNetworkStatus> = Object.create(null) as Record<string, KnownNetworkStatus>;
  for (const [status, raws] of Object.entries(entries) as [KnownNetworkStatus, readonly string[]][]) {
    for (const raw of raws) {
      const key = normaliseRawStatus(raw);
      if (key === "" || Object.hasOwn(map, key)) throw new Error(`status map: empty or repeated raw status "${raw}"`);
      map[key] = status;
    }
  }
  return Object.freeze(map);
}

/** The meaning of `raw` in `map`; UNKNOWN for anything the map does not list. */
export function mapStatus(map: StatusMap, raw: unknown): NetworkStatus {
  const key = normaliseRawStatus(raw);
  return Object.hasOwn(map, key) ? (map[key] as KnownNetworkStatus) : "UNKNOWN";
}
