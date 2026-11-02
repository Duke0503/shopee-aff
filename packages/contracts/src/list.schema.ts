/**
 * The one list contract (AD-12, FR-37, LC-1 to LC-7). Every list endpoint answers
 * `GET /api/<surface>/<entity>?q=&filter[<field>]=&sort=<field>:<asc|desc>&page=&pageSize=`
 * with this response. `total`, `facets` and `summary` describe exactly the filtered set the rows
 * come from, and `page` is the page the server actually returned (clamped to the last page).
 * The per-list query schema is generated on the server from its `defineList()` spec.
 */
import { z } from "zod";
import { INSTANT_PATTERN } from "@cashback/core";

import { LIST_RESPONSE_BOUNDS as B } from "./list-params";

export {
  LIST_RESPONSE_BOUNDS,
  filterParam,
  LIST_DEFAULT_PAGE_SIZE,
  LIST_MAX_PAGE,
  LIST_MAX_PAGE_SIZE,
  LIST_MAX_QUERY_LENGTH,
  parseSortParam,
  SORT_DIRECTIONS,
  splitFilterValues,
  type SortDirection,
} from "./list-params";

/** One facet value and how many filtered records carry it; a null value is the missing value (LC-15). */
export const facetCountSchema = z.object({ value: z.string().nullable(), count: z.number().int().min(B.minCount) });
export type FacetCount = z.infer<typeof facetCountSchema>;

export function listResponseSchema<R extends z.ZodType>(row: R) {
  return z.object({
    rows: z.array(row),
    /** Every record that matches the filters and search; never capped (LC-6). */
    total: z.number().int().min(B.minCount),
    page: z.number().int().min(B.minPage),
    pageSize: z.number().int().min(B.minPageSize).max(B.maxPageSize),
    facets: z.record(z.string(), z.array(facetCountSchema)),
    /** Sums of stored whole-dong columns over the filtered set. */
    summary: z.record(z.string(), z.number().int()),
    asOf: z.string().regex(INSTANT_PATTERN),
    /** Every record with no filter and no search; sent only by a list that shows it, labelled as the overall total. */
    overall: z.number().int().min(B.minCount).optional(),
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
  overall?: number;
}
