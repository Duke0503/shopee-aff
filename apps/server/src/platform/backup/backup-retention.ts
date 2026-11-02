/**
 * Backup retention (AD-26, Story 8.2): the 30 newest daily archives, and for the 12 Vietnam months
 * before them the first archive of each month, so the ledger can go back a year at month starts.
 * The same rule runs over the local folder and the Google Drive folder. Archive names carry their
 * instant (`2026-11-02T20-00-00.000Z-daily.tar`, `.age` added off-site); a name that is not an
 * archive's is never kept or dropped, so retention can never delete a file it did not write.
 */
import { parseInstant, vnDateOf, type Instant } from "@cashback/core";

export const DAILY_COPIES = 30;
export const MONTHLY_COPIES = 12;

export const ARCHIVE_SUFFIX = "-daily.tar";
export const ENCRYPTED_SUFFIX = ".age";

const ARCHIVE_NAME = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2}\.\d{3})Z-daily\.tar(?:\.age)?$/;

/** The archive name for a run at `at`: colons become dashes so the name is valid on Windows. */
export const archiveName = (at: Instant): string => `${at.replaceAll(":", "-")}${ARCHIVE_SUFFIX}`;

/** The instant an archive name carries, or null when the name is not an archive's. */
export function archiveInstant(name: string): Instant | null {
  const match = ARCHIVE_NAME.exec(name);
  if (!match) return null;
  try {
    return parseInstant(`${match[1]}T${match[2]}:${match[3]}:${match[4]}Z`);
  } catch {
    return null;
  }
}

export interface Retention {
  readonly keep: readonly string[];
  readonly drop: readonly string[];
}

export function retainedArchives(names: readonly string[]): Retention {
  const archives = names
    .map((name) => ({ name, at: archiveInstant(name) }))
    .filter((a): a is { name: string; at: Instant } => a.at !== null)
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : a.name < b.name ? 1 : -1));
  const daily = archives.slice(0, DAILY_COPIES);
  const firstOfMonth = new Map<string, string>();
  for (const a of archives.slice(DAILY_COPIES)) firstOfMonth.set(vnDateOf(a.at).slice(0, 7), a.name);
  const monthly = [...firstOfMonth.entries()]
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .slice(0, MONTHLY_COPIES)
    .map(([, name]) => name);
  const keep = new Set([...daily.map((a) => a.name), ...monthly]);
  return { keep: archives.filter((a) => keep.has(a.name)).map((a) => a.name), drop: archives.filter((a) => !keep.has(a.name)).map((a) => a.name) };
}
