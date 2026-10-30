/**
 * The one list contract (AD-12, FR-37, LC-1 to LC-7). Every list endpoint answers
 * `GET /api/<surface>/<entity>?q=&filter[<field>]=&sort=<field>:<asc|desc>&page=&pageSize=`
 * with this response. `total`, `facets` and `summary` describe exactly the filtered set the rows
 * come from, and `page` is the page the server actually returned (clamped to the last page).
 * The per-list query schema is generated on the server from its `defineList()` spec.
 */
import { z } from "zod";
import { INSTANT_PATTERN } from "@cashback/core";

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

/** One facet value and how many filtered records carry it; a null value is the missing value (LC-15). */
export const facetCountSchema = z.object({ value: z.string().nullable(), count: z.number().int().min(0) });
export type FacetCount = z.infer<typeof facetCountSchema>;

export function listResponseSchema<R extends z.ZodType>(row: R) {
  return z.object({
    rows: z.array(row),
    /** Every record that matches the filters and search; never capped (LC-6). */
    total: z.number().int().min(0),
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1).max(LIST_MAX_PAGE_SIZE),
    facets: z.record(z.string(), z.array(facetCountSchema)),
    /** Sums of stored whole-dong columns over the filtered set. */
    summary: z.record(z.string(), z.number().int()),
    asOf: z.string().regex(INSTANT_PATTERN),
  });
}

export interface ListResponse<R> {
  rows: R[];
  total: number;
  page: number;
  pageSize: number;
  facets: Record<string, FacetCount[]>;
  summary: Record<string, number>;
  asOf: string;
}
