/**
 * Accepting a proof image (AD-21, D49, INV-13, Story 4.9). A proof is a bank screenshot, so an
 * upload is judged by its bytes, never by its name or the type the browser claims: only a JPEG
 * or a PNG that parses end to end is kept, and it is written out again from its image data alone.
 *
 *   - JPEG: the segments are walked marker by marker and only those that code the picture are
 *     copied (quantisation and Huffman tables, frame and scan headers with their entropy-coded
 *     data, restart interval, the Adobe colour transform). Every APPn segment (EXIF with its GPS
 *     position, XMP, ICC, maker notes), every comment and anything after the end marker is
 *     dropped. The one fact kept is the EXIF Orientation, written into a fresh EXIF block that
 *     holds only that tag, so a phone photo still shows upright. The pixels are not decoded, so
 *     nothing is re-compressed and no quality is lost.
 *   - PNG: every chunk's CRC is checked, the image data is inflated (with a ceiling, so a
 *     decompression bomb stops early) and must be exactly the size the header gives with valid
 *     row filters, then it is deflated again into a new file holding only IHDR, PLTE, tRNS, IDAT
 *     and IEND. Text, EXIF, time and colour-profile chunks are dropped.
 *
 * A GIF, an SVG, an HTML page renamed .png or a truncated file is refused, and so is a picture
 * larger than a screenshot or a phone photo needs (8,192 pixels on the long side, 4,096 on the
 * short one, 40 MB of PNG rows). PNG data is inflated and deflated off the event loop (the zlib
 * thread pool), so a large upload never stalls other requests. Not pure (it uses zlib), so it
 * lives beside the commands rather than in domain/.
 */
import { promisify } from "node:util";
import { crc32, deflate, inflate } from "node:zlib";
import { PROOF_MAX_BYTES } from "@cashback/contracts";

export { PROOF_MAX_BYTES };
/** The long and the short side a proof may have: a tall phone screenshot or a phone photo fits. */
export const PROOF_MAX_LONG_SIDE = 8192;
export const PROOF_MAX_SHORT_SIDE = 4096;
/** The most a PNG's image data may inflate to, so a small file cannot claim a huge canvas. */
export const PNG_MAX_RAW = 40 * 1024 * 1024;

const inflateAsync = promisify(inflate);
const deflateAsync = promisify(deflate);

export type ProofRefusal = "not_an_image" | "too_large" | "malformed";

export type SanitizedProof =
  | { readonly kind: "image"; readonly contentType: "image/jpeg" | "image/png"; readonly bytes: Buffer; readonly width: number; readonly height: number }
  | { readonly kind: "refused"; readonly code: ProofRefusal };

class Refused extends Error {
  constructor(readonly code: ProofRefusal) {
    super(code);
  }
}

const refuse = (code: ProofRefusal = "malformed"): never => {
  throw new Refused(code);
};

function u16(b: Buffer, at: number): number {
  if (at + 2 > b.length) refuse();
  return b.readUInt16BE(at);
}

function u32(b: Buffer, at: number): number {
  if (at + 4 > b.length) refuse();
  return b.readUInt32BE(at);
}

function checkSides(width: number, height: number): void {
  if (width < 1 || height < 1) refuse();
  if (Math.max(width, height) > PROOF_MAX_LONG_SIDE || Math.min(width, height) > PROOF_MAX_SHORT_SIDE) refuse("too_large");
}

// ---- JPEG ----

const isFrame = (m: number): boolean => m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc;
const KEPT_TABLES = new Set([0xdb, 0xc4, 0xcc, 0xdd]);
const isAdobe = (segment: Buffer): boolean => segment.length === 14 && segment.subarray(2, 7).toString("latin1") === "Adobe";

const EXIF_HEADER = Buffer.from([0x45, 0x78, 0x69, 0x66, 0, 0]);

/** The EXIF Orientation (1 to 8) of an APP1 segment (its 2 length bytes, then the payload), or null when it holds none. */
function orientationOf(segment: Buffer): number | null {
  if (segment.length < 18 || !segment.subarray(2, 8).equals(EXIF_HEADER)) return null;
  const tiff = segment.subarray(8);
  const order = tiff.subarray(0, 2).toString("latin1");
  if (order !== "II" && order !== "MM") return null;
  const le = order === "II";
  const read16 = (at: number): number | null => (at < 0 || at + 2 > tiff.length ? null : le ? tiff.readUInt16LE(at) : tiff.readUInt16BE(at));
  const read32 = (at: number): number | null => (at + 4 > tiff.length ? null : le ? tiff.readUInt32LE(at) : tiff.readUInt32BE(at));
  const ifd = read32(4);
  const count = ifd === null ? null : read16(ifd);
  if (ifd === null || count === null) return null;
  for (let i = 0; i < count; i += 1) {
    const at = ifd + 2 + i * 12;
    if (read16(at) === 0x0112 && read16(at + 2) === 3) {
      const value = read16(at + 8);
      return value !== null && value >= 1 && value <= 8 ? value : null;
    }
  }
  return null;
}

/** A fresh APP1 segment holding only the Orientation tag: a big-endian TIFF block with one IFD entry. */
export function orientationSegment(orientation: number): Buffer {
  const tiff = Buffer.alloc(26);
  tiff.write("MM", 0, "latin1");
  tiff.writeUInt16BE(42, 2);
  tiff.writeUInt32BE(8, 4);
  tiff.writeUInt16BE(1, 8);
  tiff.writeUInt16BE(0x0112, 10);
  tiff.writeUInt16BE(3, 12);
  tiff.writeUInt32BE(1, 14);
  tiff.writeUInt16BE(orientation, 18);
  tiff.writeUInt32BE(0, 22);
  const head = Buffer.from([0xff, 0xe1, 0, 0]);
  head.writeUInt16BE(EXIF_HEADER.length + tiff.length + 2, 2);
  return Buffer.concat([head, EXIF_HEADER, tiff]);
}

/** The end of a scan's entropy-coded data: the first marker that is not a stuffed byte or a restart. */
function scanEnd(b: Buffer, from: number): number {
  let pos = from;
  while (pos < b.length - 1) {
    if (b[pos] === 0xff) {
      const next = b[pos + 1] ?? 0;
      if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) {
        pos += 2;
        continue;
      }
      if (next !== 0xff) return pos;
    }
    pos += 1;
  }
  return refuse();
}

function rewriteJpeg(b: Buffer): SanitizedProof {
  const out: Buffer[] = [Buffer.from([0xff, 0xd8])];
  let pos = 2;
  let size: { width: number; height: number } | null = null;
  let orientation: number | null = null;
  let scans = 0;
  for (;;) {
    if (b[pos] !== 0xff) refuse();
    while (b[pos] === 0xff) pos += 1;
    const marker = b[pos] ?? refuse();
    pos += 1;
    if (marker === 0xd9) break;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) refuse();
    const length = u16(b, pos);
    if (length < 2 || pos + length > b.length) refuse();
    const segment = b.subarray(pos, pos + length);
    pos += length;
    if (isFrame(marker)) {
      if (size !== null || length < 8) refuse();
      size = { height: u16(segment, 3), width: u16(segment, 5) };
    }
    const keep = isFrame(marker) || KEPT_TABLES.has(marker) || marker === 0xda || (marker === 0xee && isAdobe(segment));
    const isApp = (marker >= 0xe0 && marker <= 0xef) || marker === 0xfe;
    if (!keep && !isApp) refuse();
    if (marker === 0xe1 && orientation === null) orientation = orientationOf(segment);
    if (keep) out.push(Buffer.from([0xff, marker]), segment);
    if (marker === 0xda) {
      if (size === null) refuse();
      const end = scanEnd(b, pos);
      out.push(b.subarray(pos, end));
      pos = end;
      scans += 1;
    }
  }
  if (size === null || scans === 0) return refuse();
  checkSides(size.width, size.height);
  out.push(Buffer.from([0xff, 0xd9]));
  if (orientation !== null && orientation !== 1) out.splice(1, 0, orientationSegment(orientation));
  return { kind: "image", contentType: "image/jpeg", bytes: Buffer.concat(out), ...size };
}

// ---- PNG ----

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** Bit depths each colour type allows, and its channels per pixel (PNG 11.2.2). */
const COLOUR_TYPES: Readonly<Record<number, { depths: readonly number[]; channels: number }>> = {
  0: { depths: [1, 2, 4, 8, 16], channels: 1 },
  2: { depths: [8, 16], channels: 3 },
  3: { depths: [1, 2, 4, 8], channels: 1 },
  4: { depths: [8, 16], channels: 2 },
  6: { depths: [8, 16], channels: 4 },
};
const ADAM7 = [
  [0, 0, 8, 8],
  [4, 0, 8, 8],
  [0, 4, 4, 8],
  [2, 0, 4, 4],
  [0, 2, 2, 4],
  [1, 0, 2, 2],
  [0, 1, 1, 2],
] as const;

interface Header {
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  readonly colour: number;
  readonly interlaced: boolean;
  readonly bits: number;
}

function headerOf(data: Buffer): Header {
  if (data.length !== 13) refuse();
  const width = u32(data, 0);
  const height = u32(data, 4);
  const [depth = 0, colour = 0, compression, filter, interlace] = data.subarray(8);
  const type = COLOUR_TYPES[colour] ?? refuse();
  if (!type.depths.includes(depth) || compression !== 0 || filter !== 0 || (interlace !== 0 && interlace !== 1)) refuse();
  checkSides(width, height);
  return { width, height, depth, colour, interlaced: interlace === 1, bits: depth * type.channels };
}

/** The rows of the image data, as (row count, bytes per row without the filter byte) per pass. */
function passesOf(h: Header): [number, number][] {
  const rowBytes = (w: number): number => Math.ceil((w * h.bits) / 8);
  if (!h.interlaced) return [[h.height, rowBytes(h.width)]];
  return ADAM7.map(([x0, y0, dx, dy]): [number, number] => {
    const w = Math.ceil((h.width - x0) / dx);
    const rows = Math.ceil((h.height - y0) / dy);
    return w > 0 && rows > 0 ? [rows, rowBytes(w)] : [0, 0];
  }).filter(([rows]) => rows > 0);
}

function checkRows(raw: Buffer, passes: readonly [number, number][]): void {
  let pos = 0;
  for (const [rows, bytes] of passes) {
    for (let r = 0; r < rows; r += 1) {
      if ((raw[pos] ?? 255) > 4) refuse();
      pos += 1 + bytes;
    }
  }
  if (pos !== raw.length) refuse();
}

function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "latin1");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(data, crc32(head.subarray(4))) >>> 0, 0);
  return Buffer.concat([head, data, crc]);
}

interface PngParts {
  header: Header | null;
  palette: Buffer | null;
  transparency: Buffer | null;
  data: Buffer[];
}

function readChunks(b: Buffer): PngParts {
  const parts: PngParts = { header: null, palette: null, transparency: null, data: [] };
  let pos = 8;
  for (;;) {
    const length = u32(b, pos);
    const type = b.subarray(pos + 4, pos + 8).toString("latin1");
    if (!/^[A-Za-z]{4}$/.test(type) || pos + 12 + length > b.length) refuse();
    const data = b.subarray(pos + 8, pos + 8 + length);
    if (((crc32(data, crc32(b.subarray(pos + 4, pos + 8))) >>> 0) !== u32(b, pos + 8 + length))) refuse();
    pos += 12 + length;
    if (parts.header === null && type !== "IHDR") refuse();
    if (type === "IEND") return parts;
    if (type === "IHDR") parts.header = parts.header === null ? headerOf(data) : refuse();
    else if (type === "PLTE") parts.palette = data;
    else if (type === "tRNS") parts.transparency = data;
    else if (type === "IDAT") parts.data.push(data);
    else if (type.charCodeAt(0) < 0x61) refuse();
  }
}

async function rewritePng(b: Buffer): Promise<SanitizedProof> {
  const { header, palette, transparency, data } = readChunks(b);
  if (header === null || data.length === 0 || (header.colour === 3 && palette === null)) return refuse();
  const passes = passesOf(header);
  const expected = passes.reduce((sum, [rows, bytes]) => sum + rows * (1 + bytes), 0);
  if (expected > PNG_MAX_RAW) refuse("too_large");
  let raw: Buffer;
  try {
    raw = await inflateAsync(Buffer.concat(data), { maxOutputLength: expected + 1 });
  } catch {
    return refuse();
  }
  if (raw.length !== expected) refuse();
  checkRows(raw, passes);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(header.width, 0);
  ihdr.writeUInt32BE(header.height, 4);
  ihdr.set([header.depth, header.colour, 0, 0, header.interlaced ? 1 : 0], 8);
  const chunks = [chunk("IHDR", ihdr)];
  if (header.colour === 3 && palette !== null) chunks.push(chunk("PLTE", palette));
  if (transparency !== null && header.colour !== 4 && header.colour !== 6) chunks.push(chunk("tRNS", transparency));
  chunks.push(chunk("IDAT", await deflateAsync(raw)), chunk("IEND", Buffer.alloc(0)));
  return { kind: "image", contentType: "image/png", bytes: Buffer.concat([PNG_SIGNATURE, ...chunks]), width: header.width, height: header.height };
}

/** The proof as it will be stored, or why it is refused. */
export async function sanitizeProofImage(bytes: Buffer): Promise<SanitizedProof> {
  if (bytes.length > PROOF_MAX_BYTES) return { kind: "refused", code: "too_large" };
  try {
    if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return rewriteJpeg(bytes);
    if (bytes.length > 8 && bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return await rewritePng(bytes);
    return { kind: "refused", code: "not_an_image" };
  } catch (error) {
    if (error instanceof Refused) return { kind: "refused", code: error.code };
    throw error;
  }
}
