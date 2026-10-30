/**
 * The query schema a `defineList()` spec generates (AD-12): `q`, `filter[<field>]` for each
 * filterable field, `sort=<field>:<asc|desc>`, `page` and `pageSize`. Unknown keys are refused,
 * so a misspelt filter never silently shows the unfiltered list. A sort on a field the spec does
 * not declare sortable is `invalid_sort` (Story 4.3 AC3). A filter value is checked against the
 * field: a status must be a stored registry value, a date range is Vietnam calendar days and
 * becomes the half-open instant range that includes the whole end day (AD-11).
 */
import { filterParam, LIST_DEFAULT_PAGE_SIZE, LIST_MAX_PAGE, LIST_MAX_PAGE_SIZE, LIST_MAX_QUERY_LENGTH, parseSortParam, splitFilterValues, type SortDirection } from "@cashback/contracts";
import { storedValues, vnDateRange, type InstantRange } from "@cashback/core";
import { z } from "zod";

import type { FieldSpec, FieldSpecs, ListSpec } from "./list.types";

export type ListFilter =
  | { readonly field: string; readonly kind: "in"; readonly values: readonly (string | number)[] }
  | { readonly field: string; readonly kind: "range"; readonly range: InstantRange };

export interface ListQuery<F extends FieldSpecs> {
  /** The typed search text, trimmed; null when blank. */
  readonly q: string | null;
  readonly filters: readonly ListFilter[];
  readonly sort: { readonly field: keyof F & string; readonly direction: SortDirection };
  /** The page asked for; the server clamps it to the last page of the filtered set. */
  readonly page: number;
  readonly pageSize: number;
}

export type ListQueryErrorCode = "invalid_sort" | "invalid_request";

export class ListQueryError extends Error {
  constructor(
    readonly code: ListQueryErrorCode,
    /** Query parameter name to problem code, for the error envelope's `fields`. */
    readonly fields: Record<string, string>,
  ) {
    super(code);
    this.name = "ListQueryError";
  }
}

const DATE_RANGE = /^(\d{4}-\d{2}-\d{2})(?:\.\.(\d{4}-\d{2}-\d{2}))?$/;
const INTEGER = /^-?\d{1,15}$/;

const isFilterable = (field: FieldSpec): boolean => "filter" in field && field.filter === true;

function shapeOf<F extends FieldSpecs>(spec: ListSpec<F>) {
  const text = z.string().max(LIST_MAX_QUERY_LENGTH);
  const filterValue = z.union([text, z.array(text).max(50)]);
  const filters = Object.entries(spec.fields)
    .filter(([, field]) => isFilterable(field))
    .map(([key]) => [filterParam(key), filterValue.optional()] as const);
  return z.strictObject({
    q: text.optional(),
    sort: text.optional(),
    page: z.coerce.number().int().min(1).max(LIST_MAX_PAGE).default(1),
    pageSize: z.coerce.number().int().min(1).max(LIST_MAX_PAGE_SIZE).default(LIST_DEFAULT_PAGE_SIZE),
    ...Object.fromEntries(filters),
  });
}

function parseSort<F extends FieldSpecs>(spec: ListSpec<F>, raw: string | undefined): ListQuery<F>["sort"] {
  if (raw === undefined || raw.trim() === "") return spec.defaultSort;
  const sortable = Object.entries(spec.fields)
    .filter(([, field]) => field.sortable === true)
    .map(([key]) => key);
  const sort = parseSortParam(raw, sortable);
  if (sort === null) throw new ListQueryError("invalid_sort", { sort: "invalid_sort" });
  return { field: sort.field as keyof F & string, direction: sort.direction };
}

function parseFilter(key: string, field: FieldSpec, raw: string | string[]): ListFilter | null {
  const values = splitFilterValues(raw);
  if (values.length === 0) return null;
  const refuse = (): never => {
    throw new ListQueryError("invalid_request", { [filterParam(key)]: "invalid_filter" });
  };
  if (field.kind === "instant") {
    const m = values.length === 1 ? DATE_RANGE.exec(values[0] ?? "") : null;
    if (!m) return refuse();
    try {
      return { field: key, kind: "range", range: vnDateRange(m[1] ?? "", m[2] ?? m[1] ?? "") };
    } catch {
      return refuse();
    }
  }
  if (field.kind === "status") {
    const allowed: readonly string[] = storedValues(field.entity);
    if (!values.every((v) => allowed.includes(v))) refuse();
    return { field: key, kind: "in", values };
  }
  if (field.kind === "integer") {
    if (!values.every((v) => INTEGER.test(v))) refuse();
    return { field: key, kind: "in", values: values.map(Number) };
  }
  return { field: key, kind: "in", values };
}

/** The generated parser: raw query object in, checked query out, or a `ListQueryError`. */
export function listQuerySchema<F extends FieldSpecs>(spec: ListSpec<F>): (raw: unknown) => ListQuery<F> {
  const shape = shapeOf(spec);
  return (raw) => {
    const parsed = shape.safeParse(raw ?? {});
    if (!parsed.success) {
      const fields = Object.fromEntries(parsed.error.issues.map((issue) => [issue.path.join(".") || "query", "invalid"]));
      throw new ListQueryError("invalid_request", fields);
    }
    const data = parsed.data as Record<string, string | string[] | number | undefined>;
    const filters = Object.entries(spec.fields).flatMap(([key, field]) => {
      const value = isFilterable(field) ? data[filterParam(key)] : undefined;
      const filter = value === undefined || typeof value === "number" ? null : parseFilter(key, field, value);
      return filter === null ? [] : [filter];
    });
    const q = typeof data["q"] === "string" && data["q"].trim() !== "" ? data["q"].trim() : null;
    const sort = parseSort(spec, typeof data["sort"] === "string" ? data["sort"] : undefined);
    return { q, filters, sort, page: Number(data["page"]), pageSize: Number(data["pageSize"]) };
  };
}
