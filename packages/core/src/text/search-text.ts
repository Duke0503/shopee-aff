/**
 * Stored search text (AD-12, FR-37, list-defects root cause 7). Every list searches a
 * `search_text` column built here, never raw text or JSON with `LIKE`, so a staff member
 * typing "nguyen" finds every spelling of the name and `%` or `_` never acts as a wildcard.
 */

/**
 * Text a list may search; built only by `searchText`. It takes text fields only: an
 * object or array (a raw report row, parsed JSON) is refused by type and at runtime.
 */
export type SearchText = string & { readonly __brand: "SearchText" };

/** The escape character for `search_text LIKE ? ESCAPE '\'`. */
export const LIKE_ESCAPE = "\\";

/** Joins the fields of one row so a query never matches across two of them. */
const FIELD_SEPARATOR = "|";
const COMBINING_MARKS = /[\u0300-\u036f]/g;
const D_STROKE = /\u0111/g;
const WHITESPACE = /\s+/g;
const LIKE_SPECIAL = /[\\%_]/g;

/** Lowercase, diacritics folded (d-stroke to d), whitespace removed. */
function fold(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(COMBINING_MARKS, "").replace(D_STROKE, "d").replace(WHITESPACE, "");
}

function textPart(part: unknown): string {
  if (part === null || part === undefined) return "";
  if (typeof part !== "string") throw new TypeError(`search text takes text, not ${typeof part}`);
  return part;
}

/** Builds the stored `search_text` of a row from its searchable fields. */
export function searchText(...parts: readonly (string | null | undefined)[]): SearchText {
  return parts
    .map(textPart)
    .map(fold)
    .filter((part) => part.length > 0)
    .join(FIELD_SEPARATOR) as SearchText;
}

function foldQuery(query: string): string {
  return fold(query).replaceAll(FIELD_SEPARATOR, "");
}

/** The `LIKE` pattern for a typed query, or null when the query is blank (no search). */
export function searchPattern(query: string): string | null {
  const folded = foldQuery(query);
  if (folded.length === 0) return null;
  return `%${folded.replace(LIKE_SPECIAL, (c) => LIKE_ESCAPE + c)}%`;
}

/** The same match as the SQL pattern, for code that already holds the row. */
export function matchesSearch(stored: string, query: string): boolean {
  return stored.includes(foldQuery(query));
}
