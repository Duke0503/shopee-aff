/**
 * Orders (W5): every order the networks reported, through DataList with its state in the URL.
 * One value per column: the customer code and the customer name are separate columns; codes are
 * code chips; the product shows its snapshot thumbnail. On phone the compact card puts status and
 * cashback first, then the product, the customer line and the order line with the recorded date.
 * Tablet drops the order id, customer code and network columns; desktop and phone show them.
 */
import type { ListSearchState } from "@cashback/contracts";
import { DataList, formatCount, type ListColumn } from "@cashback/ui";

import { adminText } from "../labels";
import { PageHeader } from "../shell/page-header";
import { useOrdersList, ORDERS_SEARCH, type OrderRow } from "./orders.queries";

export function orderColumns(): readonly ListColumn<OrderRow>[] {
  return [
    { key: "orderId", header: adminText("col_order_id"), kind: "code", card: "meta", width: 156, desktopOnly: true },
    { key: "customerCode", header: adminText("col_customer_code"), kind: "code", card: "who", desktopOnly: true },
    { key: "customerName", header: adminText("col_customer_name"), kind: "name", sortable: true, card: "who" },
    { key: "productName", header: adminText("col_product"), kind: "product", imageKey: "productImageUrl", card: "title" },
    { key: "network", header: adminText("col_network"), kind: "text", card: "meta", desktopOnly: true, width: 112 },
    { key: "status", header: adminText("col_status"), kind: "status", entity: "order", sortable: true, card: "status" },
    { key: "cashback", header: adminText("col_cashback"), kind: "money", sortable: true, card: "amount" },
    { key: "recordedAt", header: adminText("col_recorded_at"), kind: "instant", sortable: true, card: "meta", cardLabel: adminText("col_recorded_short") },
  ];
}

const COLUMNS = orderColumns();

export interface OrdersPageProps {
  readonly state: ListSearchState;
  readonly onStateChange: (next: ListSearchState, options?: { readonly replace?: boolean }) => void;
}

export function OrdersPage({ state, onStateChange }: OrdersPageProps) {
  const query = useOrdersList(state);
  return (
    <>
      <PageHeader title={adminText("nav_orders")} lead={adminText("orders_lead")} />
      <DataList
        search={ORDERS_SEARCH}
        state={state}
        onStateChange={onStateChange}
        query={query}
        columns={COLUMNS}
        rowKey={(row) => row.orderId}
        searchPlaceholder={adminText("orders_search")}
        countLabel={(count) => adminText("orders_count", { count: formatCount(count) })}
        emptyText={adminText("orders_empty")}
        statusFilter={{ field: "status", entity: "order" }}
        summary={[{ key: "cashback", label: adminText("orders_summary_cashback") }]}
      />
    </>
  );
}
