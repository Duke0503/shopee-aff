/**
 * The secrets rotation check (D51, AD-19, Story 8.5): no secret in the production env file may be
 * a value ever committed on `main`, the live branch whose history held two exposed secrets, and
 * none may equal a value of another env file named on the command line (the live system's `.env`
 * on the VPS). Every blob reachable from the ref is read through `git cat-file --batch`, so the
 * values never appear on a command line, and the answer names keys only, never a value.
 *
 * Values shorter than 12 characters are not searched: they are not secrets this platform accepts
 * (every token is at least 32) and would match unrelated text.
 */
import { execFileSync } from "node:child_process";

/** The production env file's keys whose values are secrets (env.config.ts). */
export const SECRET_KEYS = [
  "INTERNAL_TOKEN",
  "ASSISTANT_TOKEN",
  "BRIDGE_TOKEN",
  "TELEGRAM_BOT_TOKEN",
  "FINGERPRINT_KEY",
  "ACCESSTRADE_API_KEY",
  "ADDLIVETAG_API_KEY",
  "ACCESS_AUDIENCE",
  "HEARTBEAT_URL",
] as const;

export const MIN_SEARCHED_LENGTH = 12;

/** The secrets of an env file worth searching for, by key. */
export function searchedSecrets(values: Readonly<Record<string, string | undefined>>): Map<string, string> {
  const out = new Map<string, string>();
  for (const key of SECRET_KEYS) {
    const value = values[key]?.trim();
    if (value !== undefined && value.length >= MIN_SEARCHED_LENGTH) out.set(key, value);
  }
  return out;
}

/** The keys whose value appears in any of the texts; each key once, in SECRET_KEYS order. */
export function keysFoundIn(secrets: ReadonlyMap<string, string>, texts: Iterable<string | Buffer>): string[] {
  const found = new Set<string>();
  const needles = [...secrets].map(([key, value]) => ({ key, needle: Buffer.from(value, "utf8") }));
  for (const text of texts) {
    const haystack = typeof text === "string" ? Buffer.from(text, "utf8") : text;
    for (const { key, needle } of needles) if (!found.has(key) && haystack.includes(needle)) found.add(key);
    if (found.size === needles.length) break;
  }
  return SECRET_KEYS.filter((key) => found.has(key));
}

/** The keys whose value equals the same or any value in another env file (the live `.env`). */
export function keysSharedWith(secrets: ReadonlyMap<string, string>, other: Readonly<Record<string, string | undefined>>): string[] {
  const values = new Set(Object.values(other).map((v) => v?.trim()).filter((v): v is string => v !== undefined && v !== ""));
  return [...secrets].filter(([, value]) => values.has(value)).map(([key]) => key);
}

export type GitRun = (args: readonly string[], input?: string) => Buffer;

export const gitIn =
  (repository: string): GitRun =>
  (args, input) =>
    execFileSync("git", ["-C", repository, ...args], { input, maxBuffer: 1 << 30, stdio: ["pipe", "pipe", "ignore"] });

/** Blobs larger than this (images, archives) cannot hold an env value worth finding. */
export const MAX_BLOB_BYTES = 2 * 1024 * 1024;
const BATCH = 400;

/** Every blob ever reachable from `ref` (its whole history), read in batches. */
export function* blobsOf(git: GitRun, ref: string): Generator<Buffer> {
  const objects = git(["rev-list", "--objects", ref]).toString("utf8").split("\n").map((line) => line.split(" ")[0] ?? "").filter((id) => /^[0-9a-f]{40,64}$/.test(id));
  const unique = [...new Set(objects)];
  for (let i = 0; i < unique.length; i += BATCH) {
    const ids = unique.slice(i, i + BATCH);
    const kinds = git(["cat-file", "--batch-check=%(objectname) %(objecttype) %(objectsize)"], `${ids.join("\n")}\n`).toString("utf8").split("\n");
    const blobs = kinds.map((line) => line.split(" ")).filter(([, type, size]) => type === "blob" && Number(size) <= MAX_BLOB_BYTES).map(([id]) => id as string);
    if (blobs.length === 0) continue;
    yield* splitBatch(git(["cat-file", "--batch"], `${blobs.join("\n")}\n`));
  }
}

/** `cat-file --batch` output: `<id> <type> <size>\n<content>\n` per object. */
export function* splitBatch(out: Buffer): Generator<Buffer> {
  let at = 0;
  while (at < out.length) {
    const end = out.indexOf(0x0a, at);
    if (end === -1) return;
    const size = Number(out.toString("utf8", at, end).split(" ")[2]);
    if (!Number.isInteger(size)) return;
    yield out.subarray(end + 1, end + 1 + size);
    at = end + 1 + size + 1;
  }
}

/** The first of the refs that exists (`main`, then `origin/main`), or null. */
export function existingRef(git: GitRun, refs: readonly string[]): string | null {
  for (const ref of refs) {
    try {
      git(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
      return ref;
    } catch {
      // Not here; try the next.
    }
  }
  return null;
}
