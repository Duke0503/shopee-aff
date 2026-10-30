/**
 * Session tokens (AD-18, INV-8): 32 random bytes, sent to the browser once as unpadded base64url
 * in an HttpOnly cookie. The ledger keeps only the SHA-256 of the token, in hex, so a copy of the
 * database or a backup opens no session.
 */
import { createHash, randomBytes } from "node:crypto";

export const SESSION_TOKEN_BYTES = 32;
/** 32 bytes as unpadded base64url. */
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

export interface SessionToken {
  readonly token: string;
  readonly tokenHash: string;
}

const sha256Hex = (token: string): string => createHash("sha256").update(token, "utf8").digest("hex");

export function newSessionToken(): SessionToken {
  const token = randomBytes(SESSION_TOKEN_BYTES).toString("base64url");
  return { token, tokenHash: sha256Hex(token) };
}

/** The stored hash of a cookie value, or null when it is not a token this server issues. */
export function sessionTokenHash(token: string | null | undefined): string | null {
  return typeof token === "string" && TOKEN.test(token) ? sha256Hex(token) : null;
}
