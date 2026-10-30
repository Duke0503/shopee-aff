/**
 * Password hashing (AD-18, INV-8, NFR-5): argon2id from node:crypto, stored in the PHC string
 * form `$argon2id$v=19$m=<KiB>,t=<passes>,p=<lanes>$<salt>$<hash>` (unpadded base64), so the
 * parameters travel with the hash and can be raised later without breaking stored ones. The
 * defaults are the OWASP minimum for argon2id (19 MiB, 2 passes, 1 lane). Hashing runs on the
 * thread pool and is never called inside a transaction.
 */
import { argon2, randomBytes, timingSafeEqual } from "node:crypto";

export interface Argon2Params {
  readonly memoryKiB: number;
  readonly passes: number;
  readonly parallelism: number;
}

export const DEFAULT_ARGON2: Argon2Params = { memoryKiB: 19_456, passes: 2, parallelism: 1 };

const VERSION = 19;
const SALT_BYTES = 16;
const TAG_BYTES = 32;
const PHC = /^\$argon2id\$v=19\$m=(\d{1,7}),t=(\d{1,3}),p=(\d{1,2})\$([A-Za-z0-9+/]{16,})\$([A-Za-z0-9+/]{16,})$/;
/** Passwords are typed by people; a megabyte "password" is an attack on the hasher. */
export const MAX_PASSWORD_LENGTH = 256;

const b64 = (bytes: Buffer): string => bytes.toString("base64").replace(/=+$/, "");

function derive(password: string, salt: Buffer, params: Argon2Params): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    argon2("argon2id", { message: password, nonce: salt, parallelism: params.parallelism, tagLength: TAG_BYTES, memory: params.memoryKiB, passes: params.passes }, (error, key) => (error ? reject(error) : resolve(key)));
  });
}

export async function hashPassword(password: string, params: Argon2Params = DEFAULT_ARGON2): Promise<string> {
  if (password.length === 0 || password.length > MAX_PASSWORD_LENGTH) throw new RangeError("password length out of range");
  const salt = randomBytes(SALT_BYTES);
  const tag = await derive(password, salt, params);
  return `$argon2id$v=${VERSION}$m=${params.memoryKiB},t=${params.passes},p=${params.parallelism}$${b64(salt)}$${b64(tag)}`;
}

/** True when `password` matches `stored`; a malformed hash or an oversized password is false. */
export async function verifyPassword(stored: string, password: string): Promise<boolean> {
  const m = PHC.exec(stored);
  if (!m || password.length === 0 || password.length > MAX_PASSWORD_LENGTH) return false;
  const [, memory = "", passes = "", lanes = "", salt = "", hash = ""] = m;
  const expected = Buffer.from(hash, "base64");
  const tag = await derive(password, Buffer.from(salt, "base64"), { memoryKiB: Number(memory), passes: Number(passes), parallelism: Number(lanes) });
  return tag.length === expected.length && timingSafeEqual(tag, expected);
}
