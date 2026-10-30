/**
 * Grouped digits of a whole number (DESIGN.md Typography): a dot every three digits and a real
 * minus sign, 79216 as "79.216". Shared by the UI's money formatter and the server-rendered pages,
 * so a receipt and the website write an amount the same way. It only formats: a value that is not
 * a safe integer is refused (null) and the caller shows the missing-value dash.
 */
const MINUS = "\u2212";

export function formatAmountDigits(amount: number): string | null {
  if (!Number.isSafeInteger(amount)) return null;
  const digits = String(Math.abs(amount)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return amount < 0 ? `${MINUS}${digits}` : digits;
}
