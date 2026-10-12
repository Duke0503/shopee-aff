import { label, type Labels } from "./labels";

/**
 * Money as Vietnamese readers write it: `12.000đ`, with a dot for thousands.
 * The dot and the currency sign are labels, so the way money reads can change
 * without touching code.
 *
 * Formatting only — the browser never works an amount out. Every figure on a
 * screen came from the server.
 */
export function vnd(amountVnd: number, labels: Labels): string {
  const separator = label(labels, "thousands_separator");
  const currency = label(labels, "currency");
  const grouped = String(Math.round(Math.abs(amountVnd))).replace(
    /\B(?=(\d{3})+(?!\d))/g,
    separator,
  );
  return `${amountVnd < 0 ? "-" : ""}${grouped}${currency}`;
}

/** An amount, or the dash the label file uses for "nothing here". */
export function vndOrDash(amountVnd: number | null, labels: Labels): string {
  return amountVnd === null ? label(labels, "nothing_known") : vnd(amountVnd, labels);
}
