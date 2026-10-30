/**
 * The column and query shapes DataList renders (AD-12, LC-2, LC-12). A column names one server
 * field: its key is the displayed value and, when sortable, the sort key the request sends, so a
 * header can never sort by something else than what it shows. A column without `sortable` has
 * no sort affordance at all.
 */
import type { ListResponse, ListSearch, ListSearchState } from "@cashback/contracts";
import type { EntityName } from "@cashback/core";
import type { ReactNode } from "react";

import type { FilterApi } from "./list-filters";

export type ColumnKind = "text" | "code" | "name" | "money" | "instant" | "status" | "integer" | "product";

/**
 * Where the value goes on a phone card (LC-12, wireframe phone order card): the status badge and
 * the amount on the first line, the title (a product with its thumbnail, two lines at most), then
 * the "who" line (customer code chip and name) and the "meta" line (order code chip, network and
 * the one labelled date), each on one line.
 */
export type CardSlot = "status" | "amount" | "title" | "who" | "meta" | "none";

export interface ListColumn<R> {
  readonly key: keyof R & string;
  /** The header text, already resolved from a label file. */
  readonly header: string;
  readonly kind: ColumnKind;
  readonly sortable?: boolean;
  /** The registry entity of a status column. */
  readonly entity?: EntityName;
  /** A product column's image URL field (the D56 snapshot image); the column sorts by the name. */
  readonly imageKey?: keyof R & string;
  readonly card?: CardSlot;
  /** The short label a date carries on the phone card's meta line, e.g. the recorded kind. */
  readonly cardLabel?: string;
  /** Table column width in px when the kind's default does not fit this field's values. */
  readonly width?: number;
  /** Dropped from the tablet table (the same figure stays on desktop and in the phone card). */
  readonly desktopOnly?: boolean;
  /**
   * Draws the cell from the row when no kind fits (a set of flag badges, a row action). It shows
   * the field `key` names and nothing else, so a column still holds one value (LC-2).
   */
  readonly render?: (row: R) => ReactNode;
  /** The words of this field on the phone card's meta line, when the stored value is a key (a network's name). */
  readonly cardText?: (row: R) => string | null;
}

/** The part of a TanStack Query result DataList reads; `useListQuery` returns a superset. */
export interface ListQueryResult<R> {
  readonly data: ListResponse<R> | undefined;
  readonly error: unknown;
  readonly isError: boolean;
  readonly isPending: boolean;
  readonly isFetching: boolean;
  readonly isPlaceholderData: boolean;
  readonly refetch: () => unknown;
}

export interface StatusFilter {
  readonly field: string;
  readonly entity: EntityName;
}

export interface SummaryField {
  /** A key of the response's `summary`. */
  readonly key: string;
  readonly label: string;
}

export interface ChangeOptions {
  /** Correct the URL in place (page clamp) instead of adding a history entry. */
  readonly replace?: boolean;
}

export interface DataListProps<R> {
  readonly search: ListSearch;
  readonly state: ListSearchState;
  readonly onStateChange: (next: ListSearchState, options?: ChangeOptions) => void;
  readonly query: ListQueryResult<R>;
  readonly columns: readonly ListColumn<R>[];
  readonly rowKey: (row: R) => string;
  /** Names the searched fields (LC-3). */
  readonly searchPlaceholder: string;
  /** The noun of this list with its count, for the summary and the live region. */
  readonly countLabel: (count: number) => string;
  readonly emptyText: string;
  readonly statusFilter?: StatusFilter;
  readonly summary?: readonly SummaryField[];
  /**
   * The phone card of one row, for a list whose card is composed differently from the order
   * card (the payout card). It is built from the same row the table shows, so the figures match.
   */
  readonly card?: (row: R) => ReactNode;
  /**
   * Filters beside the status chips (a network choice, a date kind with its days), drawn from the
   * same URL state; on phone they sit in the filter sheet with the chips.
   */
  readonly filters?: (api: FilterApi) => ReactNode;
}

/** A list fetch that failed with an HTTP status, or null status for no answer at all. */
export class ListFetchError extends Error {
  constructor(readonly status: number | null) {
    super(status === null ? "list.network_error" : `list.http_${status}`);
    this.name = "ListFetchError";
  }
}
