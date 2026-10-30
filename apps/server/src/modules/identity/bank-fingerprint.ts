/**
 * Bank account fingerprints (AD-17, SECURITY_MODEL.md INV-9): audit entries, logs and the
 * shared-account flag see a bank account only as HMAC-SHA-256 of its normalised number under
 * the fingerprint key, or as its last four digits on screens and in reports.
 */
import { createHmac } from "node:crypto";

/** Spaces and dashes removed, letters upper case (FR-10). */
export function normaliseAccountNumber(number: string): string {
  return number.replace(/[\s-]/g, "").toUpperCase();
}

export function bankFingerprint(fingerprintKey: string, accountNumber: string): string {
  if (fingerprintKey.length < 32) throw new RangeError("fingerprint key must be at least 32 characters");
  return createHmac("sha256", fingerprintKey).update(normaliseAccountNumber(accountNumber)).digest("hex");
}

export function lastFour(accountNumber: string): string {
  return normaliseAccountNumber(accountNumber).slice(-4);
}
