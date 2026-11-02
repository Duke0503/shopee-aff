/**
 * The list contract's query parameters (AD-12, LC-4): page bounds, the `filter[<field>]` and
 * `sort=<field>:<asc|desc>` spellings and their parsing, shared by the server and the browsers.
 * Free of Zod, so a page that only keeps list state in its URL loads no schema code.
 */
export const LIST_DEFAULT_PAGE_SIZE = 25;
export const LIST_MAX_PAGE_SIZE = 100;
/** A longer search text is refused; nobody types 200 characters into a list search. */
export const LIST_MAX_QUERY_LENGTH = 200;

/** The highest page a list query may ask for; the server clamps any page to the last one. */
export const LIST_MAX_PAGE = 1_000_000;

export const SORT_DIRECTIONS = ["asc", "desc"] as const;
export type SortDirection = (typeof SORT_DIRECTIONS)[number];

/** The query parameter of one filterable field: `filter[status]`. */
export const filterParam = (field: string): string => `filter[${field}]`;

/**
 * The values of one filter parameter, the same on server and client: repeated keys or
 * comma-separated, trimmed, blanks and repeats dropped, in the order given.
 */
export function splitFilterValues(raw: unknown): string[] {
  const parts = (Array.isArray(raw) ? raw : [raw]).filter((v): v is string | number => typeof v === "string" || typeof v === "number");
  const values = parts.flatMap((v) => String(v).split(",")).map((v) => v.trim()).filter((v) => v !== "");
  return [...new Set(values)];
}

/** `field:asc|desc` for a field in `sortable`, or null for anything else (blank included). */
export function parseSortParam(raw: string, sortable: readonly string[]): { field: string; direction: SortDirection } | null {
  const [field = "", direction = "", extra] = raw.split(":");
  if (extra !== undefined || !sortable.includes(field) || !(SORT_DIRECTIONS as readonly string[]).includes(direction)) return null;
  return { field, direction: direction as SortDirection };
}

/**
 * The bounds of every list response (list.schema.ts): the one definition both its Zod forms
 * (classic for the desk, mini for the website's pages) are built from.
 */
export const LIST_RESPONSE_BOUNDS = { minPage: 1, minPageSize: 1, maxPageSize: LIST_MAX_PAGE_SIZE, minCount: 0 } as const;
