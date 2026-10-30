/**
 * The list contract's URL state (AD-12, LC-4, LC-7): the browser keeps a list's search,
 * filters, sort, page and page size in the address bar in exactly the shape the list endpoint
 * takes (`q`, `filter[<field>]`, `sort=<field>:<asc|desc>`, `page`, `pageSize`), so the URL query
 * and the API query are one thing. A screen's router search schema is generated from its list's
 * spec with `listSearch()`: a hand-edited or stale URL is normalised (unknown keys, filter values
 * the list does not know, a sort it does not offer and a page out of range fall back to the
 * defaults), so a stale link can never send a query the server refuses. Defaults are left out of
 * the URL so one view has one address. The parsing rules are the server's own (list.schema.ts).
 */
import {
  filterParam,
  LIST_DEFAULT_PAGE_SIZE,
  LIST_MAX_PAGE,
  LIST_MAX_QUERY_LENGTH,
  parseSortParam,
  splitFilterValues,
  type SortDirection,
} from "./list.schema";

/** One filterable field; `values` lists what it may hold (a status field's stored values). */
export interface ListFilterSpec {
  readonly field: string;
  readonly values?: readonly string[];
}

/** The client half of a server `defineList()` spec: what the URL may carry. */
export interface ListSearchSpec {
  readonly sortable: readonly string[];
  readonly filters: readonly ListFilterSpec[];
  readonly defaultSort: { readonly field: string; readonly direction: SortDirection };
  readonly pageSizes?: readonly number[];
}

export interface ListSort {
  readonly field: string;
  readonly direction: SortDirection;
}

export interface ListSearchState {
  /** The typed search text as typed; blank means no search. */
  readonly q: string;
  /** Selected values per filterable field; a field with no values is absent. */
  readonly filters: Readonly<Record<string, readonly string[]>>;
  readonly sort: ListSort;
  readonly page: number;
  readonly pageSize: number;
}

/** The URL (and API) form: flat string parameters, defaults omitted. */
export type ListSearchParams = Record<string, string>;

export const LIST_PAGE_SIZES = [LIST_DEFAULT_PAGE_SIZE, 50, 100] as const;

export interface ListSearch {
  readonly spec: ListSearchSpec;
  readonly pageSizes: readonly number[];
  readonly defaults: ListSearchState;
  parse(raw: unknown): ListSearchState;
  toParams(state: ListSearchState): ListSearchParams;
  /** The router's `validateSearch`: any raw search in, the canonical URL form out. */
  validate(raw: unknown): ListSearchParams;
}

const POSITIVE_INTEGER = /^[1-9]\d*$/;

function text(value: unknown): string | null {
  if (typeof value === "number") return String(value);
  return typeof value === "string" ? value : null;
}

/** A page from the URL: a positive whole number within the server's bound, else page 1. */
function pageOf(raw: unknown): number {
  const value = text(raw) ?? "";
  if (!POSITIVE_INTEGER.test(value)) return 1;
  const page = Number(value);
  return page <= LIST_MAX_PAGE ? page : 1;
}

const sameSort = (a: ListSort, b: ListSort): boolean => a.field === b.field && a.direction === b.direction;

export function listSearch(spec: ListSearchSpec): ListSearch {
  if (!spec.sortable.includes(spec.defaultSort.field)) throw new Error(`listSearch: default sort ${spec.defaultSort.field} is not sortable`);
  const pageSizes = spec.pageSizes ?? LIST_PAGE_SIZES;
  const defaults: ListSearchState = { q: "", filters: {}, sort: spec.defaultSort, page: 1, pageSize: pageSizes[0] ?? LIST_DEFAULT_PAGE_SIZE };

  const parse = (raw: unknown): ListSearchState => {
    const input = (raw !== null && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const filters: Record<string, string[]> = {};
    for (const { field, values: allowed } of spec.filters) {
      const values = splitFilterValues(input[filterParam(field)]).filter((v) => allowed === undefined || allowed.includes(v));
      if (values.length > 0) filters[field] = values;
    }
    const size = Number(text(input["pageSize"]) ?? "");
    return {
      q: (text(input["q"]) ?? "").slice(0, LIST_MAX_QUERY_LENGTH),
      filters,
      sort: parseSortParam(text(input["sort"]) ?? "", spec.sortable) ?? spec.defaultSort,
      page: pageOf(input["page"]),
      pageSize: pageSizes.includes(size) ? size : defaults.pageSize,
    };
  };

  const toParams = (state: ListSearchState): ListSearchParams => {
    const params: ListSearchParams = {};
    if (state.q.trim() !== "") params["q"] = state.q.trim();
    for (const { field } of spec.filters) {
      const values = state.filters[field] ?? [];
      if (values.length > 0) params[filterParam(field)] = values.join(",");
    }
    if (!sameSort(state.sort, defaults.sort)) params["sort"] = `${state.sort.field}:${state.sort.direction}`;
    if (state.page !== 1) params["page"] = String(state.page);
    if (state.pageSize !== defaults.pageSize) params["pageSize"] = String(state.pageSize);
    return params;
  };

  return { spec, pageSizes, defaults, parse, toParams, validate: (raw) => toParams(parse(raw)) };
}

/**
 * The API query for a state. It always names the page size, so a request is complete on its own
 * (LC-5: every request carries the full query).
 */
export function listQueryString(search: ListSearch, state: ListSearchState): string {
  const params = { ...search.toParams(state), pageSize: String(state.pageSize) };
  return Object.entries(params)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");
}
