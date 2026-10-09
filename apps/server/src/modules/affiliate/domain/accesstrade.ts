/**
 * Parsing the money-shaped fields AccessTrade sends back. Amounts arrive as
 * `"1.234.567đ"`, `"1,234,567"` or a nested `{ amount }` object; commission
 * rates arrive as a fraction (`0.07777`). Ports
 * `providers/tiktok_provider.py::_parse_amount` and `_parse_comm_rate`.
 */

function count(value: string, char: string): number {
  let total = 0;
  for (const current of value) if (current === char) total += 1;
  return total;
}

/** A whole-dong amount from whatever AccessTrade called it. */
export function parseVndAmount(value: unknown): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === "object") {
    const object = value as Record<string, unknown>;
    if ("minimum_amount" in object || "maximum_amount" in object) {
      return parseVndAmount(object.minimum_amount ?? object.maximum_amount ?? 0);
    }
    return parseVndAmount(object.amount ?? 0);
  }
  if (typeof value === "number") return Math.round(value);

  let clean = String(value).trim().replace(/ /g, "").replace(/đ/gi, "").replace(/VND/gi, "");
  if (clean === "") return 0;

  if (clean.includes(".") && clean.includes(",")) {
    clean =
      clean.lastIndexOf(",") > clean.lastIndexOf(".")
        ? clean.replace(/\./g, "").replace(/,/g, ".")
        : clean.replace(/,/g, "");
  } else if (count(clean, ".") > 1) {
    clean = clean.replace(/\./g, "");
  } else if (count(clean, ",") > 1) {
    clean = clean.replace(/,/g, "");
  } else if (clean.includes(".")) {
    const [whole = "", fraction = ""] = clean.split(".");
    if (fraction.length === 3 && whole.length <= 3) clean = clean.replace(/\./g, "");
  } else if (clean.includes(",")) {
    const [whole = "", fraction = ""] = clean.split(",");
    clean = fraction.length === 3 && whole.length <= 3 ? clean.replace(/,/g, "") : clean.replace(/,/g, ".");
  }

  const parsed = Number(clean);
  return Number.isFinite(parsed) ? Math.round(parsed) : 0;
}

/** A commission rate as a fraction: `0.07777` stays, `7.777` (a percent) is divided by 10,000. */
export function parseCommissionRate(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const parsed = Number(String(value).trim());
  if (!Number.isFinite(parsed)) return 0;
  return parsed >= 1 ? parsed / 10_000 : parsed;
}
