/**
 * DataList (AD-12, FR-37, UX-DR2): the one way every list renders. It owns no list state: the
 * search, filters, sort and page come from the route's URL search and every change goes back
 * through `onStateChange`, which writes the URL (LC-4). Any change but paging resets to page 1
 * (LC-7); when the server clamps the page, the URL is corrected in place. Previous rows stay,
 * dimmed under the progress line, while the next query loads (LC-8). Loading, empty, no
 * matches, error and stale are separate states (LC-9). A polite live region announces the
 * count after each query (UX-DR13). Table on tablet and desktop, cards on phone (LC-12). On a
 * tablet the secondary columns start hidden and the columns menu shows any of them again.
 */
import type { ListResponse, ListSearchState, ListSort } from "@cashback/contracts";
import type { RowData } from "@tanstack/react-table";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { MoneyFigure } from "../brand/money-figure";
import { useLayout, type Layout } from "../hooks/use-media-query";
import { uiText } from "../labels";
import { cn } from "../lib/utils";
import type { DataListProps, ListColumn } from "./data-list.types";
import { FilterSheet } from "./filter-sheet";
import { ColumnsMenu } from "./columns-menu";
import { CardsFilterButton, CardsFoot, CardsHead } from "./list-cards-controls";
import { ListCards } from "./list-cards";
import { ListPagination } from "./list-pagination";
import { ListEmpty, ListError, ListNoMatches, ListSkeleton, ProgressLine } from "./list-states";
import { ListTable } from "./list-table";
import { RefreshButton, SearchBox, SortSelect } from "./list-toolbar";
import { StatusChips } from "./status-chips";

/** A newly chosen column sorts amounts, counts and dates largest or newest first, text A to Z. */
export function nextSort<R>(current: ListSort, column: ListColumn<R>): ListSort {
  if (current.field === column.key) return { field: column.key, direction: current.direction === "asc" ? "desc" : "asc" };
  const descending = column.kind === "money" || column.kind === "integer" || column.kind === "instant";
  return { field: column.key, direction: descending ? "desc" : "asc" };
}

function withFilter(state: ListSearchState, field: string, values: readonly string[]): ListSearchState["filters"] {
  return withFilters(state, { [field]: values });
}

function withFilters(state: ListSearchState, patch: Readonly<Record<string, readonly string[]>>): ListSearchState["filters"] {
  const next: Record<string, readonly string[]> = { ...state.filters };
  for (const [field, values] of Object.entries(patch)) {
    if (values.length === 0) delete next[field];
    else next[field] = values;
  }
  return next;
}

function useShownData<R>(data: ListResponse<R> | undefined): ListResponse<R> | undefined {
  const last = useRef<ListResponse<R> | undefined>(undefined);
  if (data !== undefined) last.current = data;
  return data ?? last.current;
}

interface ListBodyProps<R> extends DataListProps<R> {
  readonly shown: ListResponse<R> | undefined;
  readonly layout: Layout;
  readonly filtered: boolean;
  readonly onClear: () => void;
  readonly onSort: (column: ListColumn<R>) => void;
  /** The secondary columns the tablet shows anyway, chosen in the columns menu. */
  readonly extraColumns: readonly string[];
}

/** Rows or the one state that replaces them; an error never falls through to an empty text. */
function bodyContent<R extends RowData>({ query, shown, layout, filtered, columns, rowKey, state, emptyText, emptyAction, onClear, onSort, card, extraColumns }: ListBodyProps<R>): ReactNode {
  if (shown === undefined) return query.isError ? null : <ListSkeleton />;
  if (shown.rows.length === 0) {
    if (query.isError) return null;
    return filtered ? <ListNoMatches onClear={onClear} /> : <ListEmpty text={emptyText} action={emptyAction} />;
  }
  const dimmed = query.isFetching || query.isError;
  return (
    <div data-stale={query.isError ? "true" : undefined} className={cn("min-w-0 transition-opacity", dimmed && "opacity-55")}>
      {layout === "phone" && card !== undefined ? (
        <ul className="flex min-w-0 flex-col gap-2">
          {shown.rows.map((row) => (
            <li key={rowKey(row)} className="min-w-0">
              {card(row)}
            </li>
          ))}
        </ul>
      ) : layout === "phone" ? (
        <ListCards columns={columns} rows={shown.rows} rowKey={rowKey} />
      ) : (
        <div className="min-w-0 overflow-hidden rounded-xl border border-border bg-card">
          <ListTable columns={layout === "tablet" ? columns.filter((c) => c.desktopOnly !== true || extraColumns.includes(c.key)) : columns} rows={shown.rows} rowKey={rowKey} sort={state.sort} onSort={onSort} />
        </div>
      )}
    </div>
  );
}

function ListBody<R extends RowData>(props: ListBodyProps<R>) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <ProgressLine active={props.query.isFetching} />
      {bodyContent(props)}
    </div>
  );
}

/** "1.284 orders · cashback 12.345.678" for the filtered set the rows come from (LC-6), then the overall total, labelled so, when the list sends one. */
function SummaryLine<R>({ shown, text, fields, overallText }: { shown: ListResponse<R>; text: string; fields: DataListProps<R>["summary"]; overallText: string | null }) {
  return (
    <p className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-sm text-muted-foreground">
      <span className="tabular-nums">{text}</span>
      {(fields ?? []).map((field) => (
        <span key={field.key} className="inline-flex items-baseline gap-1">
          <span>· {field.label}</span>
          <MoneyFigure amount={shown.summary[field.key]} className="font-bold" />
        </span>
      ))}
      {overallText !== null && <span>· {overallText}</span>}
    </p>
  );
}

interface FilterControls<R> {
  readonly statusFilter: DataListProps<R>["statusFilter"];
  readonly filters: DataListProps<R>["filters"];
  readonly state: ListSearchState;
  readonly shown: ListResponse<R> | undefined;
  readonly change: (patch: Partial<ListSearchState>) => void;
  readonly hideEmpty: boolean;
}

interface Filters {
  /** The list's own filters (selects and chip groups). */
  readonly extra: ReactNode;
  readonly statusChips: ReactNode;
}

/** The list's own filters and the status chips, each null when the list has none. */
function filterControls<R>({ statusFilter, filters, state, shown, change, hideEmpty }: FilterControls<R>): Filters {
  const selected = statusFilter === undefined ? [] : (state.filters[statusFilter.field] ?? []);
  const statusChips =
    statusFilter === undefined ? null : (
      <StatusChips entity={statusFilter.entity} labels={statusFilter.labels} facets={shown?.facets[statusFilter.field]} total={shown?.total} overall={shown?.overall} hideEmpty={hideEmpty} selected={selected} onChange={(values) => change({ filters: withFilter(state, statusFilter.field, values) })} />
    );
  const extra = filters?.({ state, setFilters: (patch) => change({ filters: withFilters(state, patch) }), facets: shown?.facets, total: shown?.total, overall: shown?.overall }) ?? null;
  return { extra, statusChips };
}

/** Both kinds of filter stacked (the card form and the phone sheet), or null. */
function stacked({ extra, statusChips }: Filters): ReactNode {
  if (extra === null && statusChips === null) return null;
  return (
    <div className="flex min-w-0 flex-col gap-3">
      {extra !== null && <div className="flex min-w-0 flex-wrap items-end gap-2">{extra}</div>}
      {statusChips}
    </div>
  );
}

interface CardsControlsProps<R> {
  readonly list: DataListProps<R>;
  readonly layout: Layout;
  readonly filters: Filters;
  readonly sheetFilters: ReactNode;
  readonly search: ReactNode;
  readonly shown: ListResponse<R> | undefined;
  readonly summary: string;
}

/**
 * The customer website's controls (list-cards-controls.tsx): a search only for a list that has one,
 * then on a phone the one filter button with its sheet, wider the chips in line.
 */
function CardsControls<R>({ list, layout, filters, sheetFilters, search, shown, summary }: CardsControlsProps<R>) {
  const { statusFilter, state } = list;
  const sheet = layout === "phone" && statusFilter !== undefined;
  return (
    <>
      {search}
      {sheet ? (
        <CardsFilterButton statusFilter={statusFilter} selected={state.filters[statusFilter.field] ?? []} total={shown?.total} summary={summary}>
          {filters.statusChips}
          {filters.extra}
        </CardsFilterButton>
      ) : (
        sheetFilters
      )}
    </>
  );
}

/**
 * The table form's toolbar (wireframe list toolbar): one wrapping row with the search, the list's
 * selects and the refresh time at the right edge; chip groups take a whole line of their own under
 * it (their inline style is `order-last basis-full`).
 */
function TableToolbar({ search, filters, refresh, columnsMenu }: { search: ReactNode; filters: Filters; refresh: ReactNode; columnsMenu: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-3">
      {search}
      {filters.extra}
      <span className="ml-auto flex shrink-0 items-center gap-2">
        {refresh}
        {columnsMenu}
      </span>
      {filters.statusChips}
    </div>
  );
}

/** The phone toolbar (wireframe phone list): the search, then the filters button with the active count, opening the filter sheet with the status chips first. */
function PhoneToolbar({ search, filters, activeCount, summary }: { search: ReactNode; filters: Filters | null; activeCount: number; summary: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      {search ?? <span className="flex-1" />}
      {filters !== null && (
        <FilterSheet activeCount={activeCount} summary={summary}>
          {filters.statusChips}
          {filters.extra}
        </FilterSheet>
      )}
    </div>
  );
}

/** The phone keeps the count line short (wireframe: count only), with the sort at its right. */
function PhoneCountLine({ text, sort }: { text: string; sort: ReactNode }) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-2">
      <p className="min-w-0 shrink-0 text-meta text-muted-foreground tabular-nums">{text}</p>
      {sort}
    </div>
  );
}

/** The count a newly settled response announces, and the page the server clamped to, put in the URL in place. */
function useSettledAnswer<R>({ query, state, onStateChange, countLabel }: DataListProps<R>): string {
  const [announcement, setAnnouncement] = useState("");
  const settled = query.data !== undefined && !query.isPlaceholderData ? query.data : undefined;
  useEffect(() => {
    if (settled === undefined) return;
    setAnnouncement(countLabel(settled.total));
    if (settled.page !== state.page) onStateChange({ ...state, page: settled.page }, { replace: true });
    // Only a newly settled response announces its count and corrects the page.
  }, [settled]);
  return announcement;
}

export function DataList<R extends RowData>(props: DataListProps<R>) {
  const { search, state, onStateChange, query, columns, statusFilter, countLabel } = props;
  const cardsOnly = props.form === "cards";
  const measured = useLayout();
  const layout: Layout = cardsOnly ? "phone" : measured;
  const shown = useShownData(query.data);
  const announcement = useSettledAnswer(props);
  const [extraColumns, setExtraColumns] = useState<readonly string[]>([]);
  const secondary = columns.filter((c) => c.desktopOnly === true);

  const change = (patch: Partial<ListSearchState>): void => onStateChange({ ...state, page: 1, ...patch });
  const activeFilters = Object.values(state.filters).reduce((n, values) => n + values.length, 0);
  const filtered = state.q.trim() !== "" || activeFilters > 0;
  const filters = filterControls({ statusFilter, filters: props.filters, state, shown, change, hideEmpty: cardsOnly });
  const summaryText = shown === undefined ? "" : countLabel(shown.total);
  const refresh = <RefreshButton asOf={shown?.asOf} onRefresh={() => void query.refetch()} />;
  // The card form names the overall total only beside a filtered count, where it says something.
  const overallText = shown?.overall === undefined || (cardsOnly && !filtered) ? null : uiText("list_total_overall", { total: countLabel(shown.overall) });
  // A customer with no record at all gets the empty state alone: no search, sort or chips over nothing.
  const bare = cardsOnly && !filtered && shown?.overall === 0;

  // The card form says its count in the filter and the range; a summary line only for figures (the payouts' total).
  const summaryShown = shown !== undefined && !bare && (!cardsOnly || (props.summary ?? []).length > 0);
  const summary = summaryShown ? <SummaryLine shown={shown} text={summaryText} fields={props.summary} overallText={overallText} /> : null;
  const searchBox = props.searchable === false ? null : <SearchBox committed={state.q} placeholder={props.searchPlaceholder} onCommit={(q) => change({ q })} />;
  const sheetFilters = stacked(filters);

  return (
    <section className="flex min-w-0 flex-col gap-3">
      {cardsOnly && <CardsHead title={props.title ?? null} columns={bare ? [] : columns} sort={state.sort} sortLabel={props.sortLabel} onSort={(sort) => change({ sort })} />}
      {bare ? null : cardsOnly ? (
        <CardsControls list={props} layout={measured} filters={filters} sheetFilters={sheetFilters} search={searchBox} shown={shown} summary={summaryText} />
      ) : layout === "phone" ? (
        <PhoneToolbar search={searchBox} filters={sheetFilters === null ? null : filters} activeCount={activeFilters} summary={summaryText} />
      ) : (
        <TableToolbar search={searchBox} filters={filters} refresh={refresh} columnsMenu={layout === "tablet" && secondary.length > 0 ? <ColumnsMenu columns={secondary} shown={extraColumns} onChange={setExtraColumns} /> : null} />
      )}
      {layout === "phone" && !cardsOnly ? (
        shown !== undefined && <PhoneCountLine text={summaryText} sort={<SortSelect columns={columns} sort={state.sort} onChange={(sort) => change({ sort })} compact />} />
      ) : (
        summary
      )}
      <div role="status" aria-live="polite" className="sr-only">
        {announcement}
      </div>
      {query.isError && <ListError error={query.error} staleAsOf={shown?.asOf ?? null} onRetry={() => void query.refetch()} onClear={filtered ? () => change({ q: "", filters: {} }) : undefined} />}
      <ListBody {...props} shown={shown} layout={layout} filtered={filtered} extraColumns={extraColumns} onClear={() => change({ q: "", filters: {} })} onSort={(column) => change({ sort: nextSort(state.sort, column) })} />
      {shown !== undefined && shown.total > 0 && cardsOnly && (
        <CardsFoot facts={{ page: shown.page, pageSize: shown.pageSize, total: shown.total }} search={search} state={state} onState={(next) => onStateChange(next)} link={props.footerLink ?? null} />
      )}
      {shown !== undefined && shown.total > 0 && !cardsOnly && (
        <ListPagination
          facts={{ page: shown.page, pageSize: shown.pageSize, total: shown.total }}
          compact={layout === "phone"}
          pageSizes={search.pageSizes}
          onPage={(page) => onStateChange({ ...state, page })}
          onPageSize={(pageSize) => change({ pageSize })}
        />
      )}
    </section>
  );
}
