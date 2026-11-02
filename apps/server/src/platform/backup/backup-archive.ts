/**
 * The backup archive (AD-26, Story 8.2): one plain tar file (POSIX ustar) holding `ledger.sqlite`
 * and the proof images under `files/`, so age encrypts it as one stream and the owner opens it
 * with the `tar` built into Windows. Written and read here without a dependency: regular files
 * only, names of safe characters only (a proof image is named by the server), and a SHA-256 per
 * entry, so the restore check compares content and not only names. Extraction refuses any name
 * that would leave its folder.
 */
import { createHash } from "node:crypto";
import { mkdir, open, type FileHandle } from "node:fs/promises";
import { dirname, join } from "node:path";

export interface ArchiveEntry {
  readonly name: string;
  readonly size: number;
  readonly sha256: string;
}

export interface ArchiveSource {
  /** The name inside the archive, `/`-separated. */
  readonly name: string;
  readonly path: string;
}

export class ArchiveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArchiveError";
  }
}

const BLOCK = 512;
const CHUNK = 1 << 20;
const MAX_SIZE = 8 ** 11 - 1;
const SAFE_NAME = /^[A-Za-z0-9_-][A-Za-z0-9._-]*(\/[A-Za-z0-9_-][A-Za-z0-9._-]*)*$/;

export const isSafeEntryName = (name: string): boolean => SAFE_NAME.test(name) && !name.split("/").includes("..");

/** ustar keeps a long name as a prefix (at most 155) and a name (at most 100), split at a slash. */
function splitName(name: string): { name: string; prefix: string } {
  if (!isSafeEntryName(name)) throw new ArchiveError(`unsafe entry name: ${name}`);
  if (name.length <= 100) return { name, prefix: "" };
  for (let i = name.indexOf("/"); i !== -1 && i <= 155; i = name.indexOf("/", i + 1)) {
    if (name.length - i - 1 <= 100) return { name: name.slice(i + 1), prefix: name.slice(0, i) };
  }
  throw new ArchiveError(`entry name too long: ${name}`);
}

const octal = (value: number, width: number): string => `${value.toString(8).padStart(width - 1, "0")}\0`;

function checksum(block: Buffer): number {
  let sum = 0;
  for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 0x20 : (block[i] ?? 0);
  return sum;
}

function header(entryName: string, size: number, mtimeSeconds: number): Buffer {
  if (size > MAX_SIZE) throw new ArchiveError(`file too large for the archive: ${entryName}`);
  const { name, prefix } = splitName(entryName);
  const block = Buffer.alloc(BLOCK);
  block.write(name, 0, 100, "ascii");
  block.write(octal(0o644, 8), 100, "ascii");
  block.write(octal(0, 8), 108, "ascii");
  block.write(octal(0, 8), 116, "ascii");
  block.write(octal(size, 12), 124, "ascii");
  block.write(octal(mtimeSeconds, 12), 136, "ascii");
  block.write("0", 156, "ascii");
  block.write("ustar\0", 257, "ascii");
  block.write("00", 263, "ascii");
  block.write(prefix, 345, 155, "ascii");
  block.write(`${checksum(block).toString(8).padStart(6, "0")}\0 `, 148, "ascii");
  return block;
}

/** Copies `size` bytes from `input` at `from` to `output` (or nowhere), hashing them. */
async function copyHashed(input: FileHandle, from: number, size: number, output: FileHandle | null, what: string): Promise<string> {
  const hash = createHash("sha256");
  const buffer = Buffer.alloc(Math.min(CHUNK, Math.max(size, 1)));
  for (let done = 0; done < size; ) {
    const { bytesRead } = await input.read(buffer, 0, Math.min(buffer.length, size - done), from + done);
    if (bytesRead === 0) throw new ArchiveError(`${what} ended early`);
    hash.update(buffer.subarray(0, bytesRead));
    if (output) await output.write(buffer, 0, bytesRead);
    done += bytesRead;
  }
  return hash.digest("hex");
}

const padding = (size: number): number => (BLOCK - (size % BLOCK)) % BLOCK;

/** Writes a new archive at `target` (never over an existing file) and returns what it holds. */
export async function writeArchive(target: string, sources: readonly ArchiveSource[], mtimeSeconds: number): Promise<ArchiveEntry[]> {
  const entries: ArchiveEntry[] = [];
  const out = await open(target, "wx");
  try {
    for (const source of sources) {
      const input = await open(source.path, "r");
      try {
        const { size } = await input.stat();
        await out.write(header(source.name, size, mtimeSeconds));
        const sha256 = await copyHashed(input, 0, size, out, source.name);
        if (padding(size) > 0) await out.write(Buffer.alloc(padding(size)));
        entries.push({ name: source.name, size, sha256 });
      } finally {
        await input.close();
      }
    }
    await out.write(Buffer.alloc(BLOCK * 2));
    await out.sync();
  } finally {
    await out.close();
  }
  return entries;
}

function readHeader(block: Buffer): { name: string; size: number; type: string } {
  const text = (from: number, length: number): string => block.toString("ascii", from, from + length).replace(/\0.*$/s, "");
  if (Number.parseInt(text(148, 8).trim(), 8) !== checksum(block)) throw new ArchiveError("archive header checksum mismatch");
  const prefix = text(345, 155);
  const name = prefix === "" ? text(0, 100) : `${prefix}/${text(0, 100)}`;
  if (!isSafeEntryName(name)) throw new ArchiveError(`unsafe entry name in archive: ${name}`);
  return { name, size: Number.parseInt(text(124, 12).trim() || "0", 8), type: text(156, 1) };
}

/** Extracts every entry of `archive` under `intoDir` and returns them; `intoDir` should be new and empty. */
export async function extractArchive(archive: string, intoDir: string): Promise<ArchiveEntry[]> {
  const entries: ArchiveEntry[] = [];
  const input = await open(archive, "r");
  try {
    const block = Buffer.alloc(BLOCK);
    for (let at = 0; ; ) {
      const { bytesRead } = await input.read(block, 0, BLOCK, at);
      if (bytesRead < BLOCK) throw new ArchiveError("archive ends inside a header");
      at += BLOCK;
      if (block.every((byte) => byte === 0)) return entries;
      const { name, size, type } = readHeader(block);
      if (type !== "0" && type !== "") throw new ArchiveError(`not a regular file in archive: ${name}`);
      const target = join(intoDir, ...name.split("/"));
      await mkdir(dirname(target), { recursive: true });
      const out = await open(target, "wx");
      try {
        entries.push({ name, size, sha256: await copyHashed(input, at, size, out, name) });
      } finally {
        await out.close();
      }
      at += size + padding(size);
    }
  } finally {
    await input.close();
  }
}
