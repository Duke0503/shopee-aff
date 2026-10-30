/**
 * Test images for the proof upload (Story 4.9): a JPEG with an EXIF segment carrying a GPS
 * position (inserted right after the start marker, the way a phone camera writes it), and a small
 * PNG with a text chunk naming its author. Both are built here byte by byte; nothing real.
 */
import { crc32, deflateSync } from "node:zlib";

/** The GPS latitude rational of the fake EXIF block: 10 deg 46 min 30.00 s N. */
const LATITUDE = [10, 1, 46, 1, 3000, 100];
export const GPS_MARK = Buffer.from(LATITUDE.flatMap((n) => [...u32(n)]));

function u16(n: number): Buffer {
  const b = Buffer.alloc(2);
  b.writeUInt16BE(n);
  return b;
}

function u32(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n);
  return b;
}

const entry = (tag: number, type: number, count: number, value: Buffer): Buffer => Buffer.concat([u16(tag), u16(type), u32(count), value]);

/** A big-endian TIFF block: IFD0 with a GPS pointer (and an Orientation), the GPS IFD with latitude ref and latitude. */
function exifWithGps(orientation?: number): Buffer {
  const own = orientation === undefined ? [] : [entry(0x0112, 3, 1, Buffer.concat([u16(orientation), u16(0)]))];
  const gpsIfdAt = 8 + 2 + 12 * (1 + own.length) + 4;
  const latitudeAt = gpsIfdAt + 2 + 12 * 2 + 4;
  const tiff = Buffer.concat([
    Buffer.from("MM"),
    u16(42),
    u32(8),
    u16(1 + own.length),
    ...own,
    entry(0x8825, 4, 1, u32(gpsIfdAt)),
    u32(0),
    u16(2),
    entry(0x0001, 2, 2, Buffer.from([0x4e, 0, 0, 0])),
    entry(0x0002, 5, 3, u32(latitudeAt)),
    u32(0),
    GPS_MARK,
  ]);
  return Buffer.concat([Buffer.from("Exif\0\0"), tiff]);
}

export function jpegWithGps(jpeg: Buffer, orientation?: number): Buffer {
  const payload = exifWithGps(orientation);
  return Buffer.concat([jpeg.subarray(0, 2), Buffer.from([0xff, 0xe1]), u16(payload.length + 2), payload, jpeg.subarray(2)]);
}

function chunk(type: string, data: Buffer): Buffer {
  const name = Buffer.from(type, "latin1");
  return Buffer.concat([u32(data.length), name, data, u32(crc32(data, crc32(name)) >>> 0)]);
}

/** An RGB PNG (3 x 2 by default) with a tEXt chunk; `data` replaces its compressed image data. */
export function pngWithText(options: { width?: number; height?: number; data?: Buffer } = {}): Buffer {
  const width = options.width ?? 3;
  const height = options.height ?? 2;
  const ihdr = Buffer.concat([u32(width), u32(height), Buffer.from([8, options.data === undefined ? 2 : 6, 0, 0, 0])]);
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, 0x47)]);
  const raw = Buffer.concat(Array.from({ length: Math.min(height, 2) }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("tEXt", Buffer.from("Author\0Test Person", "latin1")),
    chunk("IDAT", options.data ?? deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
