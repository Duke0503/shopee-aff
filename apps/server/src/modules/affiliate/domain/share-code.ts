import { randomInt } from "node:crypto";

/**
 * The code on our own short link: `hoantiendp.com/s/<code>`. Eight random
 * letters and digits, NOT built from the request id, so nobody can guess
 * other people's codes. One code belongs to exactly one link request.
 */
export const SHARE_CODE_LENGTH = 8;
const ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

export function generateShareCode(): string {
  let code = "";
  for (let i = 0; i < SHARE_CODE_LENGTH; i += 1) {
    code += ALPHABET.charAt(randomInt(ALPHABET.length));
  }
  return code;
}

export function isValidShareCode(code: string): boolean {
  return code.length === SHARE_CODE_LENGTH && /^[A-Za-z0-9]+$/.test(code);
}
