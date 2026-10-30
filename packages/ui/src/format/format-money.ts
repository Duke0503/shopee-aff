/**
 * The one money formatter (DESIGN.md Typography, EXPERIENCE.md M-1). It only formats a whole-dong
 * integer the server sent: dot thousands separator, the sign from the label file, no space,
 * 79216 shown as "79.216" plus the sign. It never adds, rounds or converts; a value that is not a whole dong integer is
 * refused (null), and the caller shows the missing-value dash instead of a made-up figure.
 */
import { formatAmountDigits } from "@cashback/core";

import { uiText } from "../labels";

export { formatAmountDigits };

export function formatMoney(amount: number): string | null {
  const digits = formatAmountDigits(amount);
  return digits === null ? null : `${digits}${uiText("money_sign")}`;
}

/** What a screen reader hears: the amount followed by the word for dong. */
export function moneyAriaLabel(amount: number): string | null {
  const digits = formatAmountDigits(amount);
  return digits === null ? null : uiText("money_aria", { amount: digits });
}

/** Counts use the same grouping: "1.284". */
export function formatCount(count: number): string {
  return formatAmountDigits(count) ?? String(count);
}
