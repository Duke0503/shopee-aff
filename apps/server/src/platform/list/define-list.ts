/**
 * `defineList()` (AD-12, FR-37, LC-1 to LC-7, code.md §6): one spec per list names each field
 * once. A field is one stored column, and that column is both what the row shows and what the
 * list sorts by, so a sort can never use another expression than the displayed value
 * (list-defects root cause 3). There is no option for a separate sort expression: the only
 * sort helpers are the registry's lifecycle order for a status and the stored Vietnamese
 * `sort_key` of the same row for a name. Search names stored `search_text` columns only, so raw
 * text or JSON is never searched (root cause 7).
 *
 * The spec is checked when the module loads; a mistake in a spec fails every test that imports it.
 * Column names and the FROM clause are trusted spec text; nothing a caller sends becomes SQL text.
 */
import { listQuerySchema, type ListQuery } from "./list-query.schema";
import type { FieldSpec, FieldSpecs, ListSpec } from "./list.types";

export type { FieldKind, FieldSpec, FieldSpecs, ListSpec } from "./list.types";

export interface ListDefinition<F extends FieldSpecs> extends ListSpec<F> {
  /** Parses a raw query string object into a checked query, or throws a `ListQueryError`. */
  parse(raw: unknown): ListQuery<F>;
}

const COLUMN = /^[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*)?$/;
const FIELD_KEY = /^[a-z][a-zA-Z0-9]*$/;

export class ListSpecError extends Error {
  constructor(message: string) {
    super(`defineList: ${message}`);
    this.name = "ListSpecError";
  }
}

function checkColumn(column: string, what: string): void {
  if (!COLUMN.test(column)) throw new ListSpecError(`${what} is not a plain column name: ${column}`);
}

function checkField(key: string, field: FieldSpec): void {
  if (!FIELD_KEY.test(key)) throw new ListSpecError(`field key must be camelCase letters and digits: ${key}`);
  checkColumn(field.column, `field ${key}`);
  if (field.kind === "name") {
    checkColumn(field.sortKeyColumn, `field ${key} sort key`);
    if (!field.sortKeyColumn.endsWith("sort_key")) throw new ListSpecError(`field ${key} sorts by a stored sort_key column only`);
  }
}

function checkSpec<F extends FieldSpecs>(spec: ListSpec<F>): void {
  if (spec.from.trim() === "" || spec.from.includes(";")) throw new ListSpecError("from must be one FROM clause");
  checkColumn(spec.key, "key");
  for (const [key, field] of Object.entries(spec.fields)) checkField(key, field);
  for (const column of spec.search) {
    checkColumn(column, "search column");
    if (!column.endsWith("search_text")) throw new ListSpecError(`search covers stored search_text columns only, not ${column}`);
  }
  const sorted = spec.fields[spec.defaultSort.field];
  if (sorted === undefined || !sorted.sortable) throw new ListSpecError(`default sort ${spec.defaultSort.field} is not a sortable field`);
}

export function defineList<F extends FieldSpecs>(spec: ListSpec<F>): ListDefinition<F> {
  checkSpec(spec);
  const schema = listQuerySchema(spec);
  return { ...spec, parse: (raw) => schema(raw) };
}
