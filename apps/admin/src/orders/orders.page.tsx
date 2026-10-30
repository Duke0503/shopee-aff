/**
 * Orders (W5, FR-26, FR-37, Story 4.13): every order the networks reported, through DataList with
 * its state in the URL. One value per column: the customer code and the customer name apart;
 * codes are code chips; the product shows its snapshot thumbnail; the approved commission and the
 * cashback are the stored figures, a dash until approved. One date kind per column: the column
 * shows the kind the date filter (or the sort) is on, recorded by default, and says which. There
 * is one network filter beside the status chips, whose "all" chip carries the overall total named
 * as such. There is no action on a row: an order becomes paid only through a payout confirm.
 * Tablet drops the order id, customer code, network and commission; phone shows compact cards.
 */
import type { ListSearchState, OrderDateField } from "@cashback/contracts";
import { DataList, DateFilter, formatCount, OptionFilter, type ListColumn } from "@cashback/ui";
import { useMemo } from "react";

import { adminText, type AdminKey } from "../labels";
import { PageHeader } from "../shell/page-header";
import { dateFieldOf, ORDERS_SEARCH, useOrdersList, type OrderRow } from "./orders.queries";

const DATE_HEADER: Record<OrderDateField, { readonly header: AdminKey; readonly short: AdminKey }> = {
  recordedAt: { header: "col_recorded_at", short: "col_recorded_short" },
  approvedAt: { header: "col_approved_at", short: "col_approved_short" },
  paidAt: { header: "col_paid_at", short: "col_paid_short" },
};

const NETWORK_LABEL: Record<string, AdminKey> = { shopee: "network_shopee", accesstrade: "network_accesstrade" };
const networkName = (network: string | null): string | null => (network === null ? null : adminText(NETWORK_LABEL[network] ?? "network_unknown"));

export function orderColumns(dateField: OrderDateField = "recordedAt"): readonly ListColumn<OrderRow>[] {
  const date = DATE_HEADER[dateField];
  return [
    { key: "orderId", header: adminText("col_order_id"), kind: "code", sortable: true, card: "meta", width: 156, desktopOnly: true },
    { key: "customerCode", header: adminText("col_customer_code"), kind: "code", sortable: true, card: "who", desktopOnly: true },
    { key: "customerName", header: adminText("col_customer_name"), kind: "name", sortable: true, card: "who" },
    { key: "productName", header: adminText("col_product"), kind: "product", imageKey: "productImageUrl", card: "title" },
    { key: "network", header: adminText("col_network"), kind: "text", sortable: true, card: "meta", desktopOnly: true, width: 120, render: (row) => <span className="block truncate">{networkName(row.network)}</span>, cardText: (row) => networkName(row.network) },
    { key: "status", header: adminText("col_status"), kind: "status", entity: "order", sortable: true, card: "status" },
    { key: "approvedCommission", header: adminText("col_approved_commission"), kind: "money", sortable: true, card: "none", desktopOnly: true, width: 112 },
    { key: "cashback", header: adminText("col_cashback"), kind: "money", sortable: true, card: "amount" },
    { key: dateField, header: adminText(date.header), kind: "instant", sortable: true, card: "meta", cardLabel: adminText(date.short), width: 116 },
  ];
}

export interface OrdersPageProps {
  readonly state: ListSearchState;
  readonly onStateChange: (next: ListSearchState, options?: { readonly replace?: boolean }) => void;
}

const DATE_FIELDS = (["recordedAt", "approvedAt", "paidAt"] as const).map((value) => ({ value, label: adminText(DATE_HEADER[value].header) }));
const NETWORKS = [
  { value: "shopee", label: adminText("network_shopee") },
  { value: "accesstrade", label: adminText("network_accesstrade") },
];

export function OrdersPage({ state, onStateChange }: OrdersPageProps) {
  const query = useOrdersList(state);
  const dateField = dateFieldOf(state);
  const columns = useMemo(() => orderColumns(dateField), [dateField]);
  return (
    <>
      <PageHeader title={adminText("nav_orders")} lead={adminText("orders_lead")} />
      <DataList
        search={ORDERS_SEARCH}
        state={state}
        onStateChange={onStateChange}
        query={query}
        columns={columns}
        rowKey={(row) => row.orderId}
        searchPlaceholder={adminText("orders_search")}
        countLabel={(count) => adminText("orders_count", { count: formatCount(count) })}
        emptyText={adminText("orders_empty")}
        statusFilter={{ field: "status", entity: "order" }}
        summary={[
          { key: "approvedCommission", label: adminText("orders_summary_commission") },
          { key: "cashback", label: adminText("orders_summary_cashback") },
        ]}
        filters={(api) => (
          <>
            <OptionFilter api={api} field="network" label={adminText("orders_network")} allLabel={adminText("orders_network_all")} options={NETWORKS} />
            <DateFilter api={api} fields={DATE_FIELDS} />
          </>
        )}
      />
    </>
  );
}
