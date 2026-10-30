/**
 * Payouts (W4, FR-16, FR-31, Stories 4.6 and 4.7): the two queue tabs, payable now
 * (`payouts_tab_payable`) and needs action first (`payouts_tab_action`), over one DataList whose
 * state is in the URL; the tab is the list's `filter[queue]`, absent for the first tab. The
 * history and network payouts tabs are their own pages (payout-tabs.tsx). Each tab shows its own total, sent
 * with the list itself; the summary
 * line under them is the count and the sum of exactly the filtered rows (LC-6). There is no
 * option anywhere to show awaiting orders. Opening a row opens the payout panel, and the list and
 * its tab totals stop refreshing while it is open (LC-11).
 */
import type { ListSearchState, PayoutQueue, PayoutQueueRow } from "@cashback/contracts";
import { DataList, formatCount } from "@cashback/ui";
import { useMemo, useState } from "react";

import { adminText } from "../labels";
import { useStaff } from "../session/staff-context";
import { PageHeader } from "../shell/page-header";
import { PayoutCard, payoutColumns, type RowActions } from "./payout-columns";
import { PayoutPanel } from "./payout-panel";
import { PayoutTabs } from "./payout-tabs";
import { PAYOUTS_SEARCH, queueOfState, usePayoutsList } from "./payouts.queries";

export interface PayoutsPageProps {
  readonly state: ListSearchState;
  readonly onStateChange: (next: ListSearchState, options?: { readonly replace?: boolean }) => void;
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
        <PayoutTabs current={queue} queue={{ counts: query.data?.queues, onSelect: selectQueue }} />
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
