/**
 * Payouts (W4, FR-16, FR-31, Stories 4.6 and 4.7): two tabs, payable now (`payouts_tab_payable`)
 * and needs action first (`payouts_tab_action`), over one DataList whose state is in the URL; the
 * tab is the list's `filter[queue]`, absent for the first tab. Each tab shows its own total, sent
 * with the list itself; the summary
 * line under them is the count and the sum of exactly the filtered rows (LC-6). There is no
 * option anywhere to show awaiting orders. Opening a row opens the payout panel, and the list and
 * its tab totals stop refreshing while it is open (LC-11).
 */
import type { ListSearchState, PayoutQueue, PayoutQueueRow } from "@cashback/contracts";
import { cn, DataList, formatCount } from "@cashback/ui";
import { useMemo, useState } from "react";

import { adminText } from "../labels";
import { useStaff } from "../session/staff-context";
import { PageHeader } from "../shell/page-header";
import { PayoutCard, payoutColumns, type RowActions } from "./payout-columns";
import { PayoutPanel } from "./payout-panel";
import { PAYOUTS_SEARCH, queueOfState, usePayoutsList } from "./payouts.queries";

export interface PayoutsPageProps {
  readonly state: ListSearchState;
  readonly onStateChange: (next: ListSearchState, options?: { readonly replace?: boolean }) => void;
}

const TABS: readonly { readonly queue: PayoutQueue; readonly label: "payouts_tab_payable" | "payouts_tab_action"; readonly count: "payable" | "action" }[] = [
  { queue: "PAYABLE", label: "payouts_tab_payable", count: "payable" },
  { queue: "ACTION", label: "payouts_tab_action", count: "action" },
];

function QueueTabs({ queue, counts, onSelect }: { readonly queue: PayoutQueue; readonly counts: { payable: number; action: number } | undefined; readonly onSelect: (q: PayoutQueue) => void }) {
  return (
    <div role="tablist" aria-label={adminText("payouts_tabs")} className="flex min-w-0 gap-1 overflow-x-auto border-b border-border">
      {TABS.map((tab) => {
        const selected = tab.queue === queue;
        const count = counts?.[tab.count];
        return (
          <button
            key={tab.queue}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onSelect(tab.queue)}
            className={cn("-mb-px inline-flex min-h-11 shrink-0 items-center gap-2 border-b-2 px-3 text-sm font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50", selected ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}
          >
            <span>{adminText(tab.label)}</span>
            {count !== undefined && (
              <span className="rounded-full bg-muted px-1.5 text-caption tabular-nums" aria-label={adminText("payouts_tab_count", { count: formatCount(count) })}>
                {formatCount(count)}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** The URL state without the tab, for DataList: the tab is not one of its filters, so "clear filters" never changes it. */
function withoutQueue(state: ListSearchState): ListSearchState {
  const { queue: _queue, ...filters } = state.filters;
  return { ...state, filters };
}

export function PayoutsPage({ state, onStateChange }: PayoutsPageProps) {
  const staff = useStaff();
  const [opened, setOpened] = useState<PayoutQueueRow | null>(null);
  const queue = queueOfState(state);
  const listState = useMemo(() => withoutQueue(state), [state]);
  const query = usePayoutsList(listState, queue, opened !== null);
  const actions: RowActions = useMemo(() => ({ staffId: staff.staffId, onOpen: setOpened }), [staff.staffId]);
  const columns = useMemo(() => payoutColumns(actions), [actions]);

  const change = (next: ListSearchState, options?: { readonly replace?: boolean }): void => {
    const filters = queue === "PAYABLE" ? next.filters : { ...next.filters, queue: [queue] };
    onStateChange({ ...next, filters }, options);
  };
  const selectQueue = (next: PayoutQueue): void => {
    const filters = next === "PAYABLE" ? listState.filters : { ...listState.filters, queue: [next] };
    onStateChange({ ...listState, filters, page: 1 });
  };

  return (
    <>
      <PageHeader title={adminText("nav_payouts")} lead={adminText("payouts_lead")} />
      <div className="flex min-w-0 flex-col gap-3">
        <QueueTabs queue={queue} counts={query.data?.queues} onSelect={selectQueue} />
        <DataList
          search={PAYOUTS_SEARCH}
          state={listState}
          onStateChange={change}
          query={query}
          columns={columns}
          rowKey={(row) => row.customerId}
          searchPlaceholder={adminText("payouts_search")}
          countLabel={(count) => adminText("payouts_count", { count: formatCount(count) })}
          emptyText={adminText(queue === "PAYABLE" ? "payouts_empty_payable" : "payouts_empty_action")}
          summary={[{ key: "payable", label: adminText("payouts_summary") }]}
          card={(row) => <PayoutCard row={row} actions={actions} />}
        />
      </div>
      <PayoutPanel row={opened} onClose={() => setOpened(null)} />
    </>
  );
}
