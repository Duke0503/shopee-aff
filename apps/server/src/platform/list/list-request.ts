/**
 * A list route's whole body (AD-12, AD-20): parse the raw query with the spec's generated schema,
 * run it, and turn a refused query into the one error envelope (`invalid_sort`, or
 * `invalid_request` naming the parameter in `fields`).
 *
 * A scoped list (one customer's orders, payouts or link requests) adds filters the server sets
 * itself: they name fields of the spec that the URL cannot set, so a browser can never widen the
 * scope, and they feed the same WHERE as everything else, so the counts are the scope's own.
 */
import type { ListResponse } from "@cashback/contracts";
import type { Clock } from "@cashback/core";

import type { LedgerDb } from "../db/ledger";
import { HttpError } from "../http/error-envelope";
import type { ListDefinition } from "./define-list";
import { ListQueryError, type ListFilter, type ListQuery } from "./list-query.schema";
import type { FieldSpecs } from "./list.types";
import { runList } from "./run-list";

function parsed<F extends FieldSpecs>(list: ListDefinition<F>, raw: unknown): ListQuery<F> {
  try {
    return list.parse(raw);
  } catch (error) {
    if (error instanceof ListQueryError) throw new HttpError(error.code, `error.${error.code}`, error.fields);
    throw error;
  }
}

export function answerList<F extends FieldSpecs, R = Record<keyof F, unknown>>(db: LedgerDb, list: ListDefinition<F>, raw: unknown, clock: Clock): ListResponse<R> {
  return runList<F, R>(db, list, parsed(list, raw), clock);
}

/** A list limited by server-side filters (`in` values of spec fields) on top of the caller's query. */
export function answerScopedList<F extends FieldSpecs, R = Record<keyof F, unknown>>(
  db: LedgerDb,
  list: ListDefinition<F>,
  raw: unknown,
  clock: Clock,
  scope: readonly ListFilter[],
): ListResponse<R> {
  for (const filter of scope) {
    if (list.fields[filter.field] === undefined)
      throw new Error(`scope names no field of the list: ${filter.field}`);
  }
  return runList<F, R>(db, list, parsed(list, raw), clock, scope);
}
