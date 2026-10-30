/**
 * URL search serialisation for the router: flat `key=value` pairs, not TanStack's JSON default,
 * so a list's address reads `?q=lan&filter[status]=APPROVED,PAID&sort=cashback:desc&page=2`, the
 * same text the list endpoint takes. Brackets, colons and commas stay readable; everything else
 * is percent-encoded.
 */
const READABLE: readonly (readonly [RegExp, string])[] = [
  [/%5B/g, "["],
  [/%5D/g, "]"],
  [/%3A/g, ":"],
  [/%2C/g, ","],
];

const encode = (text: string): string => READABLE.reduce((s, [pattern, char]) => s.replace(pattern, char), encodeURIComponent(text));

const isFilterKey = (key: string): boolean => key.startsWith("filter[");

/**
 * A repeated `filter[field]` key is one filter with several values (`filter[status]=A&filter[status]=B`
 * reads as `A,B`, the list contract's other spelling); any other repeated key keeps its last value.
 */
export function parseSearch(searchStr: string): Record<string, string> {
  const params = new URLSearchParams(searchStr.startsWith("?") ? searchStr.slice(1) : searchStr);
  const out: Record<string, string> = {};
  for (const [key, value] of params) out[key] = isFilterKey(key) && out[key] !== undefined ? `${out[key]},${value}` : value;
  return out;
}

export function stringifySearch(search: Record<string, unknown>): string {
  const pairs = Object.entries(search)
    .filter((entry): entry is [string, string | number] => typeof entry[1] === "string" || typeof entry[1] === "number")
    .map(([key, value]) => `${encode(key)}=${encode(String(value))}`);
  return pairs.length === 0 ? "" : `?${pairs.join("&")}`;
}
