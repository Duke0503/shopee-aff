/**
 * The list contract's response (list.schema.ts) in zod/mini: the same fields, built from the same
 * bounds (`LIST_RESPONSE_BOUNDS`), for the website's on-demand pages, so the Zod core they share
 * with the first script stays small (Story 7.1 AC3). tests/list-response.test.ts checks that both
 * forms infer the same type and accept and refuse the same bodies.
 */
import { INSTANT_PATTERN } from "@cashback/core";
import { z } from "zod/mini";

import { LIST_RESPONSE_BOUNDS as B } from "./list-params";

const count = z.int().check(z.minimum(B.minCount));

export function listResponseMiniSchema<R extends z.ZodMiniType>(row: R) {
  return z.object({
    rows: z.array(row),
    total: count,
    page: z.int().check(z.minimum(B.minPage)),
    pageSize: z.int().check(z.minimum(B.minPageSize), z.maximum(B.maxPageSize)),
    facets: z.record(z.string(), z.array(z.object({ value: z.nullable(z.string()), count }))),
    summary: z.record(z.string(), z.int()),
    asOf: z.string().check(z.regex(INSTANT_PATTERN)),
    overall: z.optional(count),
  });
}
