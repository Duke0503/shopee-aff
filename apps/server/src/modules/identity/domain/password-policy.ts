import { randomInt } from "node:crypto";

/**
 * Password rules. A password is 8 characters from an alphabet with no
 * look-alikes (no 0/O, no 1/I) so a customer can read it off a phone and
 * type it with a thumb. It is never derived from anything about the customer.
 */
export const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const PASSWORD_LENGTH = 8;

/** Five wrong guesses inside the window stop the account answering. */
export const MAX_ATTEMPTS = 5;
export const LOCKOUT_MINUTES = 15;

/** Session lifetime, renewed on use. (Owner is deciding a shorter value.) */
export const SESSION_DAYS = 3650;
export const SESSION_BYTES = 32;

/** A fresh password. */
export function newPassword(): string {
  let out = "";
  for (let i = 0; i < PASSWORD_LENGTH; i += 1) {
    out += ALPHABET.charAt(randomInt(ALPHABET.length));
  }
  return out;
}
