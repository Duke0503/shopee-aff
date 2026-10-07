import { createHash, pbkdf2Sync, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Password and session-token hashing, byte-for-byte compatible with the
 * Python in `src/cashback/core/accounts.py`, so a password set by one runtime
 * verifies in the other (the Phase 2 gate).
 *
 * Stored format: `pbkdf2$rounds$salt$hash`, self-describing so the round count
 * can change later and old rows keep verifying.
 */
export const PBKDF2_ROUNDS = 240_000;

/** SHA-256 digest size, matching hashlib.pbkdf2_hmac's default dklen. */
const PBKDF2_KEYLEN = 32;

export function hashPassword(password: string, salt?: string): string {
  const actualSalt = salt ?? randomBytes(16).toString("hex");
  const digest = pbkdf2Sync(password, actualSalt, PBKDF2_ROUNDS, PBKDF2_KEYLEN, "sha256");
  return `pbkdf2$${PBKDF2_ROUNDS}$${actualSalt}$${digest.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string | null | undefined): boolean {
  if (!stored) return false;
  const parts = stored.split("$");
  if (parts.length !== 4) return false;
  const [scheme, rounds, salt, digest] = parts;
  if (scheme !== "pbkdf2" || !rounds || !salt || !digest) return false;

  const candidate = pbkdf2Sync(password, salt, Number(rounds), PBKDF2_KEYLEN, "sha256").toString(
    "hex",
  );
  // Constant-time compare: an early return leaks the shared prefix.
  const a = Buffer.from(candidate, "utf8");
  const b = Buffer.from(digest, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Sessions are stored hashed for the same reason passwords are. */
export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}
