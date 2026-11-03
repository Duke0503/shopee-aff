/**
 * The encryption of the off-site copy sent through the Google Drive webhook (owner decision
 * 2026-11-03, replacing age for that path): AES-256-GCM with BACKUP_ENCRYPTION_KEY, 32 random
 * bytes written in base64. The key lives in the production env file and in the owner's password
 * manager; Drive only ever holds the encrypted file, so a Drive account alone never reveals the
 * ledger. A wrong key or a changed byte fails the GCM tag check, never yields a wrong archive.
 *
 * File format (`.tar.enc`): the 7-byte magic `CBKPENC`, one version byte (1), the 12-byte IV, the
 * ciphertext and the 16-byte tag. The magic and the version are authenticated as additional data,
 * so a file cannot be relabelled as another version.
 *
 * The whole archive is held in memory: the webhook needs it as one base64 body anyway, and the
 * daily job refuses an archive whose payload would exceed what Apps Script accepts (~45 MB).
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export const ENCRYPTED_ARCHIVE_MAGIC = Buffer.from("CBKPENC", "ascii");
export const ENCRYPTED_ARCHIVE_VERSION = 1;
export const IV_BYTES = 12;
export const TAG_BYTES = 16;
export const KEY_BYTES = 32;
const HEADER_BYTES = ENCRYPTED_ARCHIVE_MAGIC.length + 1;
/** Header, IV and tag: what encryption adds to the archive's size. */
export const ENCRYPTION_OVERHEAD = HEADER_BYTES + IV_BYTES + TAG_BYTES;

export class ArchiveCipherError extends Error {
  constructor(readonly reason: "not_encrypted" | "unknown_version" | "truncated" | "wrong_key_or_damaged") {
    super(`encrypted archive: ${reason}`);
    this.name = "ArchiveCipherError";
  }
}

/** The 32-byte key BACKUP_ENCRYPTION_KEY holds, or null when the text is not exactly that in canonical base64. */
export function parseEncryptionKey(text: string | null | undefined): Buffer | null {
  const trimmed = text?.trim() ?? "";
  if (!/^[A-Za-z0-9+/]{43}=$/.test(trimmed)) return null;
  const key = Buffer.from(trimmed, "base64");
  return key.length === KEY_BYTES && key.toString("base64") === trimmed ? key : null;
}

const header = (): Buffer => Buffer.concat([ENCRYPTED_ARCHIVE_MAGIC, Buffer.from([ENCRYPTED_ARCHIVE_VERSION])]);

/** True when the bytes start with this format's magic (any version). */
export const isEncryptedArchive = (head: Buffer): boolean => head.length >= ENCRYPTED_ARCHIVE_MAGIC.length && head.subarray(0, ENCRYPTED_ARCHIVE_MAGIC.length).equals(ENCRYPTED_ARCHIVE_MAGIC);

export function encryptArchive(plain: Buffer, key: Buffer, iv: Buffer = randomBytes(IV_BYTES)): Buffer {
  const head = header();
  const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(head);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([head, iv, body, cipher.getAuthTag()]);
}

export function decryptArchive(data: Buffer, key: Buffer): Buffer {
  if (!isEncryptedArchive(data)) throw new ArchiveCipherError("not_encrypted");
  if (data.length < ENCRYPTION_OVERHEAD) throw new ArchiveCipherError("truncated");
  if (data[ENCRYPTED_ARCHIVE_MAGIC.length] !== ENCRYPTED_ARCHIVE_VERSION) throw new ArchiveCipherError("unknown_version");
  const head = data.subarray(0, HEADER_BYTES);
  const iv = data.subarray(HEADER_BYTES, HEADER_BYTES + IV_BYTES);
  const tag = data.subarray(data.length - TAG_BYTES);
  const body = data.subarray(HEADER_BYTES + IV_BYTES, data.length - TAG_BYTES);
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
    decipher.setAAD(head);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]);
  } catch {
    throw new ArchiveCipherError("wrong_key_or_damaged");
  }
}
