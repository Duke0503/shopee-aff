/**
 * Network payouts (W4 network payouts tab, `payouts_tab_network`, FR-19, D59, Story 4.21): every
 * payout batch a network made to the operator, on DataList with its state in the URL. One value
 * per column: the network, its payout id as a code chip, the day the network created it, the
 * status, what the match did, the batch's gross, what was received, the gross of the customers'
 * orders and the unattributed rest (guest or unknown orders), all server figures. Opening a
 * row shows its orders (network-settlement-sheet.tsx); the list holds still while it is open.
 */
import type { ListSearchState, NetworkSettlementRow } from "@cashback/contracts";
import { Button, CodeChip, DataList, DateFilter, formatCount, MoneyFigure, OptionFilter, type ListColumn } from "@cashback/ui";
import { useMemo, useState } from "react";

import { adminText, type AdminKey } from "../labels";
import { PageHeader } from "../shell/page-header";
import { MatchBadge, Unattributed, WithheldBadge } from "./network-badges";
import { NetworkSettlementSheet } from "./network-settlement-sheet";
import { NETWORK_SETTLEMENTS_SEARCH, useNetworkSettlements } from "./network-settlements.queries";
import { PayoutTabs } from "./payout-tabs";

const NETWORK: Record<string, AdminKey> = { shopee: "network_shopee", accesstrade: "network_accesstrade" };
const networkName = (network: string): string => adminText(NETWORK[network] ?? "network_unknown");

function OpenButton({ row, onOpen, wide = false }: { readonly row: NetworkSettlementRow; readonly onOpen: (row: NetworkSettlementRow) => void; readonly wide?: boolean }) {
  return (
    <Button type="button" variant="outline" size={wide ? "lg" : "sm"} className={wide ? "w-full coarse:h-11" : "px-2 coarse:h-11"} aria-label={adminText("network_open_aria", { id: row.networkPayoutId })} onClick={() => onOpen(row)}>
      {adminText("network_open")}
    </Button>
  );
}

function networkColumns(onOpen: (row: NetworkSettlementRow) => void): readonly ListColumn<NetworkSettlementRow>[] {
  return [
    { key: "network", header: adminText("col_network"), kind: "text", sortable: true, desktopOnly: true, width: 104, render: (row) => <span className="block truncate">{networkName(row.network)}</span> },
    { key: "networkPayoutId", header: adminText("col_network_payout_id"), kind: "code", sortable: true, width: 124 },
    { key: "createdAt", header: adminText("col_network_created_at"), kind: "instant", sortable: true, width: 100 },
    { key: "status", header: adminText("col_network_status"), kind: "status", entity: "networkSettlement", sortable: true, desktopOnly: true, width: 132 },
    { key: "match", header: adminText("col_match"), kind: "text", width: 120, render: (row) => <MatchBadge match={row.match} /> },
    { key: "eligibleAmount", header: adminText("col_eligible"), kind: "money", sortable: true, desktopOnly: true, width: 112 },
    { key: "amount", header: adminText("col_network_amount"), kind: "money", sortable: true, width: 104 },
    { key: "matchedGross", header: adminText("col_matched_gross"), kind: "money", sortable: true, desktopOnly: true, width: 112 },
    { key: "unattributed", header: adminText("col_unattributed"), kind: "integer", sortable: true, width: 104, render: (row) => <Unattributed amount={row.unattributed} /> },
    { key: "settlementId", header: adminText("col_actions"), kind: "text", width: 88, render: (row) => <OpenButton row={row} onOpen={onOpen} /> },
  ];
}

function NetworkCard({ row, onOpen }: { readonly row: NetworkSettlementRow; readonly onOpen: (row: NetworkSettlementRow) => void }) {
  return (
    <article data-card="network-settlement" className="flex min-w-0 flex-col gap-2 rounded-xl border border-border bg-card p-3">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <span className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="text-[15px] font-semibold">{networkName(row.network)}</span>
          <CodeChip code={row.networkPayoutId} />
        </span>
        <span className="shrink-0 text-right">
          <span className="sr-only">{adminText("col_network_amount")} </span>
          <MoneyFigure amount={row.amount} size="md" />
        </span>
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
        <MatchBadge match={row.match} />
        <WithheldBadge withheld={row.withheld} />
      </div>
      <dl className="grid min-w-0 grid-cols-3 gap-2 text-meta">
        <div className="min-w-0">
          <dt className="text-muted-foreground">{adminText("col_eligible")}</dt>
          <dd>
            <MoneyFigure amount={row.eligibleAmount} />
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-muted-foreground">{adminText("col_matched_gross")}</dt>
          <dd>
            <MoneyFigure amount={row.matchedGross} />
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-muted-foreground">{adminText("col_unattributed")}</dt>
          <dd>
            <Unattributed amount={row.unattributed} />
          </dd>
        </div>
      </dl>
      <OpenButton row={row} onOpen={onOpen} wide />
    </article>
  );
}

export interface NetworkSettlementsPageProps {
  readonly state: ListSearchState;
  readonly onStateChange: (next: ListSearchState, options?: { readonly replace?: boolean }) => void;
}

const NETWORKS = [
  { value: "shopee", label: adminText("network_shopee") },
  { value: "accesstrade", label: adminText("network_accesstrade") },
];
const DATE_FIELDS = [{ value: "createdAt", label: adminText("col_network_created_at") }];
const MATCHES = [
  { value: "MATCHED", label: adminText("match_matched") },
  { value: "MISMATCH", label: adminText("match_mismatch") },
  { value: "PENDING", label: adminText("match_pending") },
  { value: "HISTORIC", label: adminText("match_historic") },
];

export function NetworkSettlementsPage({ state, onStateChange }: NetworkSettlementsPageProps) {
  const [opened, setOpened] = useState<NetworkSettlementRow | null>(null);
  const query = useNetworkSettlements(state, opened !== null);
  const columns = useMemo(() => networkColumns(setOpened), []);
  return (
    <>
      <PageHeader title={adminText("nav_payouts")} lead={adminText("network_lead")} />
      <div className="flex min-w-0 flex-col gap-3">
        <PayoutTabs current="NETWORK" />
        <DataList
          search={NETWORK_SETTLEMENTS_SEARCH}
          state={state}
          onStateChange={onStateChange}
          query={query}
          columns={columns}
          rowKey={(row) => String(row.settlementId)}
          searchPlaceholder={adminText("network_search")}
          countLabel={(count) => adminText("network_count", { count: formatCount(count) })}
          emptyText={adminText("network_empty")}
          statusFilter={{ field: "status", entity: "networkSettlement" }}
          summary={[
            { key: "eligibleAmount", label: adminText("network_summary_eligible") },
            { key: "amount", label: adminText("network_summary_amount") },
            { key: "matchedGross", label: adminText("network_summary_matched") },
          ]}
          filters={(api) => (
            <>
              <OptionFilter api={api} field="network" label={adminText("orders_network")} allLabel={adminText("orders_network_all")} options={NETWORKS} />
              <OptionFilter api={api} field="match" label={adminText("col_match")} allLabel={adminText("match_all")} options={MATCHES} />
              <DateFilter api={api} fields={DATE_FIELDS} />
            </>
          )}
          card={(row) => <NetworkCard row={row} onOpen={setOpened} />}
        />
      </div>
      <NetworkSettlementSheet row={opened} onClose={() => setOpened(null)} />
    </>
  );
}
