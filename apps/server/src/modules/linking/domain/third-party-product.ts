/**
 * Reading the third party's product answer (owner decision 2026-11-02, live
 * `third_party_lookup.py` and `commission.py` since 1819487). The answer is someone else's cached
 * data, so it is read exactly or not at all: a wrong estimate is worse than none, and anything not
 * usable sends the lookup on to the Shopee pages through the bridge.
 *
 * Usable means: `status` "success", a `productInfo` with an item id equal to the one asked for and
 * a product name (an unknown product still answers "success" with an empty shell), a positive whole
 * dong price, and Shopee's rate and the XTRA rate each as one percentage with at most two decimals.
 * The rates are read from their digits, never with float maths. When the answer also states the
 * total rate it must equal their sum, an answer that flags XTRA must carry an XTRA rate, and both
 * rates at 0 is "not found", never 0% (live fix 2326e07). The answer's own commission, cap and
 * capped flag are not used: the estimate is always computed by packages/money.
 */
import type { ProductFacts } from "./product-lookup";

export type ThirdPartyFacts = Omit<ProductFacts, "shopId" | "price" | "shopeeRateBps" | "sellerRateBps"> & {
  readonly price: number;
  readonly shopeeRateBps: number;
  readonly sellerRateBps: number;
};

export type ThirdPartyReading = { readonly ok: true; readonly facts: ThirdPartyFacts } | { readonly ok: false; readonly reason: ThirdPartyMiss };

export type ThirdPartyMiss = "not_success" | "not_found" | "other_item" | "bad_price" | "bad_rates" | "no_rates";

const PERCENT = /^(\d{1,3})(?:\.(\d{1,2}))?$/;
const WHOLE = /^\d{1,12}$/;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** A number or numeric string as its plain decimal text; anything else (exponents, signs, blanks) gives null. */
function decimalText(value: unknown): string | null {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? String(value) : null;
  if (typeof value === "string") return value.trim();
  return null;
}

/** A percentage (`4`, `2.5`, `"7.25"`) as basis points, or null. */
export function percentToBps(value: unknown): number | null {
  const text = decimalText(value);
  const m = text === null ? null : PERCENT.exec(text);
  if (!m?.[1]) return null;
  const bps = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
  return bps <= 10_000 ? bps : null;
}

/** A whole positive dong amount (`242250`, `"242250"`, `242250.0`), or null. */
export function wholeDong(value: unknown): number | null {
  const text = decimalText(value)?.replace(/\.0+$/, "") ?? null;
  if (text === null || !WHOLE.test(text)) return null;
  const n = Number(text);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

const httpsOnly = (url: unknown): string | null => (typeof url === "string" && url.startsWith("https://") ? url : null);

function ratesOf(info: Record<string, unknown>): { shopeeRateBps: number; sellerRateBps: number } | ThirdPartyMiss {
  const shopee = percentToBps(info["shopeeRatePercent"]);
  const seller = percentToBps(info["sellerRatePercent"]);
  if (shopee === null || seller === null) return "bad_rates";
  const total = info["totalRatePercent"];
  if (total !== undefined && total !== null && percentToBps(total) !== shopee + seller) return "bad_rates";
  if (info["isXtra"] === true && seller === 0) return "bad_rates";
  if (shopee + seller === 0) return "no_rates";
  return { shopeeRateBps: shopee, sellerRateBps: seller };
}

/** The facts of the item `itemId` in a parsed answer body, or why it is not usable. */
export function readThirdPartyAnswer(body: unknown, itemId: string): ThirdPartyReading {
  const miss = (reason: ThirdPartyMiss): ThirdPartyReading => ({ ok: false, reason });
  if (!isRecord(body) || body["status"] !== "success") return miss("not_success");
  const info = body["productInfo"];
  if (!isRecord(info)) return miss("not_found");
  const id = info["itemId"];
  const name = typeof info["productName"] === "string" ? info["productName"].trim() : "";
  if ((typeof id !== "string" && typeof id !== "number") || String(id) === "" || name === "") return miss("not_found");
  if (String(id) !== itemId) return miss("other_item");
  const price = wholeDong(info["price"]);
  if (price === null) return miss("bad_price");
  const rates = ratesOf(info);
  if (typeof rates === "string") return miss(rates);
  return { ok: true, facts: { productOfferId: itemId, name, imageUrl: httpsOnly(info["imageUrl"]), price, ...rates } };
}
