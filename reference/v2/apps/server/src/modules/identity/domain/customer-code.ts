/**
 * The DP code: "DP" plus five digits, e.g. DP00012. The code a customer sees
 * and types. The database hands it out from a counter that only goes up, so a
 * deleted customer's number is NEVER given to anyone else.
 *
 * Lookup accepts the code however a person types it: "dp00012", "DP 00012"
 * and "DP00012" all mean the same customer.
 */
const CODE_RE = /^DP[0-9]{5}$/;

export const CUSTOMER_CODE_LENGTH = 5;

/** Format a counter value as a DP code. Throws outside 0..99999. */
export function formatCustomerCode(number: number): string {
  if (!Number.isInteger(number) || number < 0 || number > 99_999) {
    throw new RangeError(`customer code number out of range: ${number}`);
  }
  return `DP${String(number).padStart(CUSTOMER_CODE_LENGTH, "0")}`;
}

/**
 * Parse a typed code into its canonical form, or null when it is not a code.
 * Case and spaces are ignored; nothing else is.
 */
export function parseCustomerCode(text: string): string | null {
  const compact = text.replace(/\s+/g, "").toUpperCase();
  return CODE_RE.test(compact) ? compact : null;
}

export const isValidCustomerCode = (text: string): boolean => parseCustomerCode(text) !== null;

/** Staff and the guest account (HOUSE) have no DP code. */
export function customerCodeFor(role: string): string | null {
  return role === "admin" || role === "employee" || role === "house" ? null : "assign";
}
