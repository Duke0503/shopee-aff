/**
 * Review (W5 review, FR-14, UJ-6, Story 4.15): the cases the system declined to guess, oldest
 * first, through DataList with its state in the URL. Two tabs, open and resolved (`review_tab_open`, `review_tab_resolved`), are the
 * list's `filter[status]` (absent for the first) and show the whole totals the list sent; under
 * them, one chip per reason counts the filtered set (LC-6) and only reasons present are shown.
 * One value per column: the order id (a code chip), the reason in words, the network, the day it
 * opened. "Xem" opens the case's panel (a right sheet, a drawer on phone); the list stops
 * refreshing while it is open (LC-11). An empty open queue reads `review_empty_open`.
 */
import { REVIEW_CASE_REASONS, type ListSearchState, type ReviewCaseRow } from "@cashback/contracts";
import { formatVnDateOf, systemClock } from "@cashback/core";
import {
  Button,
  cn,
  CodeChip,
  DataList,
  FacetChips,
  formatCount,
  type ListColumn,
} from "@cashback/ui";
import { useMemo, useState } from "react";

import { adminText } from "../labels";
import { PageHeader } from "../shell/page-header";
import { ReviewPanel } from "./review-panel";
import { reasonLabel, networkName, subjectText } from "./review-text";
import { REVIEW_SEARCH, tabOfState, useReviewCases, type ReviewTab } from "./review.queries";

function Subject({ row }: { readonly row: ReviewCaseRow }) {
  const s = subjectText(row.subject);
  return (
    <span className="flex min-w-0 flex-col items-start gap-0.5">
      {s.code !== null && <CodeChip code={s.code} />}
      {s.text !== null && (
        <span className="text-caption break-words text-muted-foreground">{s.text}</span>
      )}
    </span>
  );
}

function OpenButton({
  row,
  onOpen,
  wide = false,
}: {
  readonly row: ReviewCaseRow;
  readonly onOpen: (row: ReviewCaseRow) => void;
  readonly wide?: boolean;
}) {
  return (
    <Button
      type="button"
      size={wide ? "lg" : "sm"}
      variant="outline"
      className={wide ? "w-full coarse:h-11" : "coarse:h-11"}
      aria-label={adminText("review_open_aria", { subject: row.orderId ?? row.subject })}
      onClick={() => onOpen(row)}
    >
      {adminText("review_open")}
    </Button>
  );
}

/** The resolved tab adds the outcome and when it was resolved. */
const RESOLVED_COLUMNS: readonly ListColumn<ReviewCaseRow>[] = [
  {
    key: "resolution",
    header: adminText("col_resolution"),
    kind: "text",
    width: 120,
    render: (row) => (
      <span className="block truncate">
        {row.resolution === null
          ? null
          : adminText(row.resolution === "APPLIED" ? "resolution_applied" : "resolution_dismissed")}
      </span>
    ),
  },
  {
    key: "resolvedAt",
    header: adminText("col_resolved_at"),
    kind: "instant",
    sortable: true,
  },
];

function reviewColumns(
  tab: ReviewTab,
  onOpen: (row: ReviewCaseRow) => void,
): readonly ListColumn<ReviewCaseRow>[] {
  const resolved = tab === "RESOLVED" ? RESOLVED_COLUMNS : [];
  return [
    {
      key: "orderId",
      header: adminText("col_subject"),
      kind: "code",
      sortable: true,
      width: 168,
      render: (row) => <Subject row={row} />,
    },
    {
      key: "reason",
      header: adminText("col_reason"),
      kind: "text",
      sortable: true,
      render: (row) => (
        <span className="line-clamp-2 leading-snug break-words whitespace-normal">
          {reasonLabel(row.reason)}
        </span>
      ),
    },
    {
      key: "network",
      header: adminText("col_network"),
      kind: "text",
      sortable: true,
      width: 116,
      desktopOnly: true,
      render: (row) => <span className="block truncate">{networkName(row.network)}</span>,
    },
    { key: "openedAt", header: adminText("col_opened_at"), kind: "instant", sortable: true },
    ...resolved,
    {
      key: "caseId",
      header: adminText("col_review_action"),
      kind: "text",
      width: 84,
      render: (row) => <OpenButton row={row} onOpen={onOpen} />,
    },
  ];
}

function ReviewCard({
  row,
  onOpen,
}: {
  readonly row: ReviewCaseRow;
  readonly onOpen: (row: ReviewCaseRow) => void;
}) {
  const opened = formatVnDateOf(row.openedAt, systemClock);
  return (
    <article
      data-card="review"
      className="flex min-w-0 flex-col gap-2 rounded-xl border border-border bg-card p-3"
    >
      <p className="text-[15px] leading-snug font-semibold break-words">
        {reasonLabel(row.reason)}
      </p>
      <Subject row={row} />
      <p className="flex min-w-0 flex-wrap gap-x-2 text-meta text-muted-foreground">
        <span>{networkName(row.network)}</span>
        {opened !== null && (
          <span className="tabular-nums">{`${adminText("col_opened_short")} ${opened}`}</span>
        )}
      </p>
      <OpenButton row={row} onOpen={onOpen} wide />
    </article>
  );
}

const TAB_CLASS =
  "-mb-px inline-flex min-h-11 min-w-0 items-center justify-center gap-2 border-b-2 px-3 text-sm font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50 sm:justify-start";

function Tabs({
  tab,
  counts,
  onSelect,
}: {
  readonly tab: ReviewTab;
  readonly counts: { open: number; resolved: number } | undefined;
  readonly onSelect: (tab: ReviewTab) => void;
}) {
  const tabs = [
    { tab: "OPEN" as const, label: adminText("review_tab_open"), count: counts?.open },
    { tab: "RESOLVED" as const, label: adminText("review_tab_resolved"), count: counts?.resolved },
  ];
  return (
    <div
      role="tablist"
      aria-label={adminText("review_tabs")}
      className="grid min-w-0 grid-cols-2 gap-x-1 border-b border-border sm:flex sm:gap-1"
    >
      {tabs.map((t) => (
        <button
          key={t.tab}
          type="button"
          role="tab"
          aria-selected={t.tab === tab}
          onClick={() => onSelect(t.tab)}
          className={cn(
            TAB_CLASS,
            t.tab === tab
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          <span>{t.label}</span>
          {t.count !== undefined && (
            <span
              className="rounded-full bg-muted px-1.5 text-caption tabular-nums"
              aria-label={adminText("review_tab_count", { count: formatCount(t.count) })}
            >
              {formatCount(t.count)}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

const CHOICES = REVIEW_CASE_REASONS.map((value) => ({
  field: "reason",
  value,
  label: reasonLabel(value),
}));

function withoutStatus(state: ListSearchState): ListSearchState {
  const { status: _status, ...filters } = state.filters;
  return { ...state, filters };
}

export interface ReviewPageProps {
  readonly state: ListSearchState;
  readonly onStateChange: (next: ListSearchState, options?: { readonly replace?: boolean }) => void;
}

export function ReviewPage({ state, onStateChange }: ReviewPageProps) {
  const [opened, setOpened] = useState<ReviewCaseRow | null>(null);
  const tab = tabOfState(state);
  const listState = useMemo(() => withoutStatus(state), [state]);
  const query = useReviewCases(listState, tab, opened !== null);
  const columns = useMemo(() => reviewColumns(tab, setOpened), [tab]);
  const change = (next: ListSearchState, options?: { readonly replace?: boolean }): void => {
    onStateChange(
      { ...next, filters: tab === "OPEN" ? next.filters : { ...next.filters, status: [tab] } },
      options,
    );
  };
  const selectTab = (next: ReviewTab): void => {
    onStateChange({
      ...listState,
      filters: next === "OPEN" ? listState.filters : { ...listState.filters, status: [next] },
      page: 1,
    });
  };
  return (
    <>
      <PageHeader title={adminText("nav_review")} lead={adminText("review_lead")} />
      <div className="flex min-w-0 flex-col gap-3">
        <Tabs tab={tab} counts={query.data?.counts} onSelect={selectTab} />
        <DataList
          search={REVIEW_SEARCH}
          state={listState}
          onStateChange={change}
          query={query}
          columns={columns}
          rowKey={(row) => String(row.caseId)}
          searchPlaceholder={adminText("review_search")}
          countLabel={(count) => adminText("review_count", { count: formatCount(count) })}
          emptyText={adminText(tab === "OPEN" ? "review_empty_open" : "review_empty_resolved")}
          card={(row) => <ReviewCard row={row} onOpen={setOpened} />}
          filters={(api) => (
            <FacetChips api={api} choices={CHOICES} label={adminText("review_reasons")} hideEmpty />
          )}
        />
      </div>
      <ReviewPanel row={opened} onClose={() => setOpened(null)} />
    </>
  );
}
