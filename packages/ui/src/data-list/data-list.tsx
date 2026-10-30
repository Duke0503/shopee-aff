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
function bodyContent<R extends RowData>({ query, shown, layout, filtered, columns, rowKey, state, emptyText, onClear, onSort, card, extraColumns }: ListBodyProps<R>): ReactNode {
  if (shown === undefined) return query.isError ? null : <ListSkeleton />;
  if (shown.rows.length === 0) {
    if (query.isError) return null;
    return filtered ? <ListNoMatches onClear={onClear} /> : <ListEmpty text={emptyText} />;
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
    <p className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-meta">
      <span className="font-medium tabular-nums">{text}</span>
      {(fields ?? []).map((field) => (
        <span key={field.key} className="inline-flex items-baseline gap-1">
          <span className="text-muted-foreground">· {field.label}</span>
          <MoneyFigure amount={shown.summary[field.key]} />
        </span>
      ))}
      {overallText !== null && <span className="text-muted-foreground">· {overallText}</span>}
    </p>
  );
}

interface FilterControls<R> {
  readonly statusFilter: DataListProps<R>["statusFilter"];
  readonly filters: DataListProps<R>["filters"];
  readonly state: ListSearchState;
  readonly shown: ListResponse<R> | undefined;
  readonly change: (patch: Partial<ListSearchState>) => void;
}

/** The list's own filters (beside the chips) and the status chips, or null when it has neither. */
function filterControls<R>({ statusFilter, filters, state, shown, change }: FilterControls<R>): ReactNode {
  const selected = statusFilter === undefined ? [] : (state.filters[statusFilter.field] ?? []);
  const statusChips =
    statusFilter === undefined ? null : (
      <StatusChips entity={statusFilter.entity} facets={shown?.facets[statusFilter.field]} total={shown?.total} overall={shown?.overall} selected={selected} onChange={(values) => change({ filters: withFilter(state, statusFilter.field, values) })} />
    );
  const extra = filters?.({ state, setFilters: (patch) => change({ filters: withFilters(state, patch) }), facets: shown?.facets, total: shown?.total, overall: shown?.overall });
  if (statusChips === null && extra === undefined) return null;
  return (
    <div className="flex min-w-0 flex-col gap-3">
      {extra !== undefined && <div className="flex min-w-0 flex-wrap items-end gap-2">{extra}</div>}
      {statusChips}
    </div>
  );
}

export function DataList<R extends RowData>(props: DataListProps<R>) {
  const { search, state, onStateChange, query, columns, statusFilter, countLabel } = props;
  const layout = useLayout();
  const shown = useShownData(query.data);
  const [announcement, setAnnouncement] = useState("");
  const [extraColumns, setExtraColumns] = useState<readonly string[]>([]);
  const secondary = columns.filter((c) => c.desktopOnly === true);
  const settled = query.data !== undefined && !query.isPlaceholderData ? query.data : undefined;

  useEffect(() => {
    if (settled === undefined) return;
    setAnnouncement(countLabel(settled.total));
    if (settled.page !== state.page) onStateChange({ ...state, page: settled.page }, { replace: true });
    // Only a newly settled response announces its count and corrects the page.
  }, [settled]);

  const change = (patch: Partial<ListSearchState>): void => onStateChange({ ...state, page: 1, ...patch });
  const activeFilters = Object.values(state.filters).reduce((n, values) => n + values.length, 0);
  const filtered = state.q.trim() !== "" || activeFilters > 0;
  const chips = filterControls({ statusFilter, filters: props.filters, state, shown, change });
  const summaryText = shown === undefined ? "" : countLabel(shown.total);
  const overallText = shown?.overall === undefined ? null : uiText("list_total_overall", { total: countLabel(shown.overall) });

  return (
    <section className="flex min-w-0 flex-col gap-3">
      <div className="flex min-w-0 items-center gap-2">
        <SearchBox committed={state.q} placeholder={props.searchPlaceholder} onCommit={(q) => change({ q })} />
        <RefreshButton asOf={shown?.asOf} onRefresh={() => void query.refetch()} />
        {layout === "tablet" && secondary.length > 0 && <ColumnsMenu columns={secondary} shown={extraColumns} onChange={setExtraColumns} />}
      </div>
      {layout === "phone" ? (
        <div className="flex min-w-0 items-end gap-2">
          <SortSelect columns={columns} sort={state.sort} onChange={(sort) => change({ sort })} />
          {chips !== null && (
            <FilterSheet activeCount={activeFilters} summary={summaryText}>
              {chips}
            </FilterSheet>
          )}
        </div>
      ) : (
        chips
      )}
      {shown !== undefined && <SummaryLine shown={shown} text={summaryText} fields={props.summary} overallText={overallText} />}
      <div role="status" aria-live="polite" className="sr-only">
        {announcement}
      </div>
      {query.isError && <ListError error={query.error} staleAsOf={shown?.asOf ?? null} onRetry={() => void query.refetch()} onClear={filtered ? () => change({ q: "", filters: {} }) : undefined} />}
      <ListBody {...props} shown={shown} layout={layout} filtered={filtered} extraColumns={extraColumns} onClear={() => change({ q: "", filters: {} })} onSort={(column) => change({ sort: nextSort(state.sort, column) })} />
      {shown !== undefined && shown.total > 0 && (
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
