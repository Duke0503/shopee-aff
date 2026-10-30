/** The shape of a `defineList()` spec (AD-12); see define-list.ts for the rules it enforces. */
import type { EntityName } from "@cashback/core";

export type FieldKind = "text" | "integer" | "money" | "instant" | "status" | "name";

interface FieldBase {
  /** The one stored column (`table.column`), displayed and sorted. */
  readonly column: string;
  readonly sortable?: boolean;
}

export type FieldSpec =
  | (FieldBase & { readonly kind: "text"; readonly filter?: boolean; readonly facet?: boolean })
  | (FieldBase & { readonly kind: "integer"; readonly filter?: boolean })
  | (FieldBase & { readonly kind: "money"; readonly summary?: boolean })
  /** Filtered by a Vietnam calendar date range that includes its whole end day (AD-11). */
  | (FieldBase & { readonly kind: "instant"; readonly filter?: boolean })
  /** Sorted in the registry's lifecycle order, never alphabetically (LC-13, root cause 4). */
  | (FieldBase & { readonly kind: "status"; readonly entity: EntityName; readonly filter?: boolean; readonly facet?: boolean })
  /** A Vietnamese name, sorted by the stored `sort_key` built from it (packages/core/text). */
  | (FieldBase & { readonly kind: "name"; readonly sortKeyColumn: string });

export type FieldSpecs = Readonly<Record<string, FieldSpec>>;

export interface ListSpec<F extends FieldSpecs> {
  /** The FROM clause, joins included (a `*.list.ts` may join read-only, AD-4). */
  readonly from: string;
  /** A unique column: the last sort key, so equal values never swap places between pages. */
  readonly key: string;
  readonly fields: F;
  /** Stored `search_text` columns; any other column is refused. */
  readonly search: readonly string[];
  readonly defaultSort: { readonly field: keyof F & string; readonly direction: "asc" | "desc" };
}

