import { randomInt } from "node:crypto";

/**
 * A link request id: `R` + YYMMDD + five random digits, e.g. R26100612345.
 * No separators — the sub_id field accepts only letters and digits.
 */
export function newRequestId(at: Date = new Date()): string {
  const pad = (value: number, size = 2): string => String(value).padStart(size, "0");
  const stamp = `${pad(at.getFullYear() % 100)}${pad(at.getMonth() + 1)}${pad(at.getDate())}`;
  return `R${stamp}${pad(randomInt(100_000), 5)}`;
}
