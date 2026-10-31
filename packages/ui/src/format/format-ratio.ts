/**
 * Formatting the Overview's server figures (FR-27): a ratio arrives in integer basis points and is
 * written as a percentage with its exact digits (1780 is "17,8%", 2727 is "27,27%"), a change in
 * basis points as percentage points, and an axis value in a compact form. Nothing is rounded or
 * computed: the digits are the server's, only placed around the decimal comma.
 */
import { formatAmountDigits } from "@cashback/core";

import { uiText } from "../labels";

const MINUS = "\u2212";

function bpsDigits(bps: number): string {
  const abs = Math.abs(bps);
  const whole = formatAmountDigits(Math.trunc(abs / 100)) ?? String(Math.trunc(abs / 100));
  const cents = String(abs % 100).padStart(2, "0").replace(/0+$/, "");
  return `${bps < 0 ? MINUS : ""}${whole}${cents === "" ? "" : `,${cents}`}`;
}

/** "17,8%"; null for a ratio with nothing to measure. */
export function formatBps(bps: number | null): string | null {
  return bps === null || !Number.isSafeInteger(bps) ? null : uiText("percent", { value: bpsDigits(bps) });
}

/** A change of a ratio in percentage points (+4,5 or minus 2 points). */
export function formatBpsChange(bps: number | null): string | null {
  if (bps === null || !Number.isSafeInteger(bps)) return null;
  return uiText("points_change", { value: `${bps > 0 ? "+" : ""}${bpsDigits(bps)}` });
}

/** A signed whole-dong amount with a true minus sign (minus 10.098 or +7.067 dong). */
export function formatSignedMoney(amount: number | null): string | null {
  if (amount === null) return null;
  const digits = formatAmountDigits(Math.abs(amount));
  if (digits === null) return null;
  return `${amount < 0 ? MINUS : amount > 0 ? "+" : ""}${digits}${uiText("money_sign")}`;
}

/** An axis tick: in full under 10.000, else "250k" or "1,2tr" (the digits shown, never a new amount). */
export function formatCompactMoney(amount: number): string {
  const abs = Math.abs(amount);
  const sign = amount < 0 ? MINUS : "";
  if (abs < 10_000) return `${sign}${formatAmountDigits(abs) ?? String(abs)}`;
  if (abs < 1_000_000) return `${sign}${uiText("compact_thousand", { value: formatAmountDigits(Math.trunc(abs / 1000)) ?? "" })}`;
  const tenths = Math.trunc((abs % 1_000_000) / 100_000);
  return `${sign}${uiText("compact_million", { value: `${Math.trunc(abs / 1_000_000)}${tenths === 0 ? "" : `,${tenths}`}` })}`;
}
