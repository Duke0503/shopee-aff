/**
 * The tabs of one customer's page (W5 customer page, Story 4.14): the customer's orders, link
 * requests and payouts, each a DataList on its own list endpoint that the server scopes to this
 * customer, with the tab and its list state in the URL. Each tab's count is the exact total the
 * page answered (never a capped number). Orders show the product thumbnail (D56); codes are code
 * chips; one value per column. Tablet drops the secondary columns behind the columns menu (`list_columns`).
 */
import type {
  AdminLinkRequestRow,
  CustomerPage,
  ListSearchState,
  PayoutHistoryRow,
} from "@cashback/contracts";
import { cn, DataList, formatCount, type ListColumn } from "@cashback/ui";

import { adminText, type AdminKey } from "../labels";
import { orderColumns } from "../orders/orders.page";
import { ReceiptLink } from "../payouts/payout-history.page";
import {
  CUSTOMER_LINKS_SEARCH,
  CUSTOMER_ORDERS_SEARCH,
  CUSTOMER_PAYOUTS_SEARCH,
  CUSTOMER_TABS,
  useCustomerLinks,
  useCustomerOrders,
  useCustomerPayouts,
  type CustomerTab,
} from "./customers.queries";

const NETWORK_LABEL: Record<string, AdminKey> = {
  shopee: "network_shopee",
  accesstrade: "network_accesstrade",
};

const LINK_COLUMNS: readonly ListColumn<AdminLinkRequestRow>[] = [
  {
    key: "requestId",
    header: adminText("col_request_id"),
    kind: "code",
    sortable: true,
    card: "meta",
    desktopOnly: true,
    width: 156,
  },
  {
    key: "productName",
    header: adminText("col_product"),
    kind: "product",
    imageKey: "productImageUrl",
    sortable: true,
    card: "title",
  },
  {
    key: "network",
    header: adminText("col_network"),
    kind: "text",
    sortable: true,
    card: "meta",
    width: 120,
    render: (row) => (
      <span className="block truncate">
        {row.network === null ? null : adminText(NETWORK_LABEL[row.network] ?? "network_unknown")}
      </span>
    ),
    cardText: (row) =>
      row.network === null ? null : adminText(NETWORK_LABEL[row.network] ?? "network_unknown"),
  },
  {
    key: "status",
    header: adminText("col_status"),
    kind: "status",
    entity: "linkRequest",
    sortable: true,
    card: "status",
  },
  {
    key: "createdAt",
    header: adminText("col_created_at"),
    kind: "instant",
    sortable: true,
    card: "meta",
    cardLabel: adminText("col_created_short"),
  },
];

const PAYOUT_COLUMNS: readonly ListColumn<PayoutHistoryRow>[] = [
  {
    key: "amount",
    header: adminText("col_payout_amount"),
    kind: "money",
    sortable: true,
    card: "amount",
  },
  {
    key: "status",
    header: adminText("col_status"),
    kind: "status",
    entity: "payout",
    sortable: true,
    card: "status",
  },
  {
    key: "recordedAt",
    header: adminText("col_paid_on"),
    kind: "instant",
    sortable: true,
    card: "meta",
    cardLabel: adminText("col_paid_on_short"),
  },
  {
    key: "recordedBy",
    header: adminText("col_recorded_by"),
    kind: "text",
    sortable: true,
    desktopOnly: true,
    card: "meta",
  },
  {
    key: "voidedAt",
    header: adminText("col_voided_at"),
    kind: "instant",
    desktopOnly: true,
    card: "meta",
    cardLabel: adminText("col_voided_short"),
  },
  {
    key: "receiptToken",
    header: adminText("col_receipt"),
    kind: "text",
    width: 88,
    card: "none",
    render: (row) => <ReceiptLink row={row} />,
  },
];

/** The customer's own orders: the Orders columns without the customer, who is this page. */
const ORDER_COLUMNS = orderColumns().filter(
  (c) => c.key !== "customerCode" && c.key !== "customerName",
);

const TAB_LABEL: Record<CustomerTab, AdminKey> = {
  orders: "customer_tab_orders",
  links: "customer_tab_links",
  payouts: "customer_tab_payouts",
};

export interface CustomerListsProps {
  readonly customerKey: string;
  readonly counts: CustomerPage["counts"];
  readonly tab: CustomerTab;
  readonly state: ListSearchState;
  readonly onChange: (
    tab: CustomerTab,
    state: ListSearchState,
    options?: { readonly replace?: boolean },
  ) => void;
}

const TAB_CLASS =
  "-mb-px inline-flex min-h-11 min-w-0 items-center justify-center gap-2 border-b-2 px-3 text-sm font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50 sm:justify-start";

function Tabs({
  tab,
  counts,
  onSelect,
}: {
  readonly tab: CustomerTab;
  readonly counts: CustomerPage["counts"];
  readonly onSelect: (tab: CustomerTab) => void;
}) {
  const countOf: Record<CustomerTab, number> = {
    orders: counts.orders,
    links: counts.linkRequests,
    payouts: counts.payouts,
  };
  return (
    <div
      role="tablist"
      aria-label={adminText("customer_tabs")}
      className="grid min-w-0 grid-cols-3 gap-x-1 border-b border-border sm:flex sm:gap-1"
    >
      {CUSTOMER_TABS.map((t) => (
        <button
          key={t}
          type="button"
          role="tab"
          aria-selected={t === tab}
          onClick={() => onSelect(t)}
          className={cn(
            TAB_CLASS,
            t === tab
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          <span>{adminText(TAB_LABEL[t])}</span>
          <span
            className="rounded-full bg-muted px-1.5 text-caption tabular-nums"
            aria-label={adminText("customer_tab_count", { count: formatCount(countOf[t]) })}
          >
            {formatCount(countOf[t])}
          </span>
        </button>
      ))}
    </div>
  );
}

function OrdersTab({
  customerKey,
  state,
  onChange,
}: {
  readonly customerKey: string;
  readonly state: ListSearchState;
  readonly onChange: CustomerListsProps["onChange"];
}) {
  const query = useCustomerOrders(customerKey, state);
  return (
    <DataList
      search={CUSTOMER_ORDERS_SEARCH}
      state={state}
      onStateChange={(next, options) => onChange("orders", next, options)}
      query={query}
      columns={ORDER_COLUMNS}
      rowKey={(row) => row.orderId}
      searchPlaceholder={adminText("customer_orders_search")}
      countLabel={(count) => adminText("orders_count", { count: formatCount(count) })}
      emptyText={adminText("customer_orders_empty")}
      statusFilter={{ field: "status", entity: "order" }}
      summary={[{ key: "cashback", label: adminText("orders_summary_cashback") }]}
    />
  );
}

function LinksTab({
  customerKey,
  state,
  onChange,
}: {
  readonly customerKey: string;
  readonly state: ListSearchState;
  readonly onChange: CustomerListsProps["onChange"];
}) {
  const query = useCustomerLinks(customerKey, state);
  return (
    <DataList
      search={CUSTOMER_LINKS_SEARCH}
      state={state}
      onStateChange={(next, options) => onChange("links", next, options)}
      query={query}
      columns={LINK_COLUMNS}
      rowKey={(row) => row.requestId}
      searchPlaceholder={adminText("links_search")}
      countLabel={(count) => adminText("links_count", { count: formatCount(count) })}
      emptyText={adminText("customer_links_empty")}
      statusFilter={{ field: "status", entity: "linkRequest" }}
    />
  );
}

function PayoutsTab({
  customerKey,
  state,
  onChange,
}: {
  readonly customerKey: string;
  readonly state: ListSearchState;
  readonly onChange: CustomerListsProps["onChange"];
}) {
  const query = useCustomerPayouts(customerKey, state);
  return (
    <DataList
      search={CUSTOMER_PAYOUTS_SEARCH}
      state={state}
      onStateChange={(next, options) => onChange("payouts", next, options)}
      query={query}
      columns={PAYOUT_COLUMNS}
      rowKey={(row) => String(row.payoutId)}
      searchPlaceholder={adminText("customer_payouts_search")}
      countLabel={(count) => adminText("history_count", { count: formatCount(count) })}
      emptyText={adminText("customer_payouts_empty")}
      statusFilter={{ field: "status", entity: "payout" }}
      summary={[{ key: "paidAmount", label: adminText("history_summary_paid") }]}
    />
  );
}

export function CustomerLists({ customerKey, counts, tab, state, onChange }: CustomerListsProps) {
  const defaults = {
    orders: CUSTOMER_ORDERS_SEARCH,
    links: CUSTOMER_LINKS_SEARCH,
    payouts: CUSTOMER_PAYOUTS_SEARCH,
  };
  return (
    <section className="flex min-w-0 flex-col gap-3">
      <Tabs
        tab={tab}
        counts={counts}
        onSelect={(next) => onChange(next, defaults[next].defaults)}
      />
      {tab === "orders" && (
        <OrdersTab customerKey={customerKey} state={state} onChange={onChange} />
      )}
      {tab === "links" && <LinksTab customerKey={customerKey} state={state} onChange={onChange} />}
      {tab === "payouts" && (
        <PayoutsTab customerKey={customerKey} state={state} onChange={onChange} />
      )}
    </section>
  );
}
