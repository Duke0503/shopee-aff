/**
 * The customer website's list controls (`form="cards"`, Story 7.4, pen.dev ktmGZ, jW4fD, YtS6u):
 * one line with the list's heading and the sort as a quiet dropdown at its right; then on a phone
 * one filter button naming the chosen status and the count it shows (`list_filters_choice`),
 * opening the status choices in the bottom sheet, and wider the status chips in line; under the
 * rows one line with the range, "show more" while more rows exist (the next page size, so the rows
 * already read stay in place) and the list's own link. No search, refresh or pager: the
 * fewest choices (EXPERIENCE.md). The desk's controls are in data-list.tsx and stay as they are.
 */
import type { ListSearch, ListSearchState, ListSort } from "@cashback/contracts";
import { statusesOf, type EntityName } from "@cashback/core";
import type { ReactNode } from "react";

import { formatCount } from "../format/format-money";
import { statusLabel, uiText } from "../labels";
import { cn } from "../lib/utils";
import type { ListColumn, StatusFilter } from "./data-list.types";
import { FilterSheet } from "./filter-sheet";
import { rangeText, type PageFacts } from "./list-pagination";
import { SortSelect } from "./list-toolbar";

/** A status's words: the list's own short label when it gives one, else the registry's. */
export function statusWords(entity: EntityName, value: string, labels: StatusFilter["labels"]): string {
  const own = labels?.[value];
  if (own !== undefined) return own;
  const status = statusesOf(entity).find((s) => s.value === value);
  return status === undefined ? value : statusLabel(status.labelKey);
}

export interface CardsHeadProps<R> {
  readonly title: ReactNode;
  readonly columns: readonly ListColumn<R>[];
  readonly sort: ListSort;
  readonly sortLabel: ((column: string, direction: "asc" | "desc") => string) | undefined;
  readonly onSort: (sort: ListSort) => void;
}

/** The heading with the sort dropdown at its right, when the list sorts at all. */
export function CardsHead<R>({ title, columns, sort, sortLabel, onSort }: CardsHeadProps<R>) {
  const sortable = columns.some((c) => c.sortable === true);
  if (title === null && !sortable) return null;
  return (
    <div className="flex min-w-0 items-center justify-between gap-3">
      <div className="min-w-0">{title}</div>
      {sortable && <SortSelect columns={columns} sort={sort} onChange={onSort} label={sortLabel} compact className="relative -mr-1 inline-flex min-w-0 shrink items-center text-muted-foreground" />}
    </div>
  );
}

export interface CardsFilterButtonProps {
  readonly statusFilter: StatusFilter;
  readonly selected: readonly string[];
  readonly total: number | undefined;
  readonly summary: string;
  readonly children: ReactNode;
}

/** The phone's one filter button: the chosen status (or all) and how many rows it shows. */
export function CardsFilterButton({ statusFilter, selected, total, summary, children }: CardsFilterButtonProps) {
  const [only] = selected;
  const choice = selected.length === 0 ? uiText("list_all") : selected.length === 1 && only !== undefined ? statusWords(statusFilter.entity, only, statusFilter.labels) : uiText("list_statuses_chosen", { count: formatCount(selected.length) });
  const label = uiText("list_filters_choice", { choice, count: total === undefined ? "…" : formatCount(total) });
  return (
    <div className="flex min-w-0">
      <FilterSheet activeCount={selected.length} summary={summary} label={label}>
        {children}
      </FilterSheet>
    </div>
  );
}

export interface CardsFootProps {
  readonly facts: PageFacts;
  readonly search: ListSearch;
  readonly state: ListSearchState;
  readonly onState: (next: ListSearchState) => void;
  /** The list's own link after the range (the missing-order page). */
  readonly link: ReactNode;
}

const FOOT_LINK = "inline-flex min-h-11 items-center rounded-md font-medium text-primary hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none";

/** The next step of "show more": a bigger first page while the list offers one, else the next page. */
export function moreState(search: ListSearch, state: ListSearchState): ListSearchState {
  const bigger = search.pageSizes.find((size) => size > state.pageSize);
  return bigger !== undefined && state.page === 1 ? { ...state, pageSize: bigger } : { ...state, page: state.page + 1 };
}

export function CardsFoot({ facts, search, state, onState, link }: CardsFootProps) {
  const more = facts.page * facts.pageSize < facts.total;
  return (
    <nav aria-label={uiText("list_pagination")} className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-sm text-primary">
      <span className="tabular-nums">{rangeText(facts)}</span>
      {more && (
        <>
          <span aria-hidden>·</span>
          <button type="button" className={cn(FOOT_LINK, "px-0.5")} onClick={() => onState(moreState(search, state))}>
            {uiText("list_more")}
          </button>
        </>
      )}
      {link !== null && link !== undefined && (
        <>
          <span aria-hidden>·</span>
          {link}
        </>
      )}
    </nav>
  );
}
