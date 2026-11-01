/** A bank account number as it is stored and fingerprinted: spaces and dashes removed, letters upper case (FR-10). */
export function normaliseAccountNumber(number: string): string {
  return number.replace(/[\s-]/g, "").toUpperCase();
}
