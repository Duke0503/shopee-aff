import { useState, type ReactElement } from "react";

import type { ApiAdminOrder } from "@mmo/contracts";
import { Button, colors, spacing } from "@mmo/ui";

import { useMarkPaid, useOrders, type OrdersFilter } from "./features/orders/orders.queries";
import { OrdersPager, OrdersTable } from "./features/orders/orders-table";
import { label, useLabels, type LabelKey, type Labels } from "./shared/lib/labels";

/** The choices in each filter, and what the label file calls them. */
const STATUS_OPTIONS: ReadonlyArray<readonly [string, LabelKey]> = [
  ["all", "admin_filter_all"],
  ["awaiting_approval", "status_awaiting_approval"],
  ["approved", "status_approved"],
  ["paid", "status_paid"],
  ["rejected", "status_rejected"],
];

const PLATFORM_OPTIONS: ReadonlyArray<readonly [string, LabelKey]> = [
  ["all", "admin_filter_all"],
  ["shopee", "admin_platform_shopee"],
  ["tiktok", "admin_platform_tiktok"],
];

const SETTLEMENT_OPTIONS: ReadonlyArray<readonly [string, LabelKey]> = [
  ["all", "admin_filter_all"],
  ["unsettled", "admin_settlement_unsettled"],
  ["processing", "admin_settlement_processing"],
  ["settled", "admin_settlement_settled"],
];

const SORT_OPTIONS: ReadonlyArray<readonly [string, LabelKey]> = [
  ["", "admin_sort_newest"],
  ["order_value", "admin_sort_value"],
  ["cashback", "admin_sort_cashback"],
];

const EMPTY: OrdersFilter = {
  search: "",
  status: "all",
  platform: "all",
  settlement: "all",
  fromDate: "",
  toDate: "",
  sort: "",
  page: 1,
};

function Choice({
  name,
  value,
  options,
  onChange,
  labels,
}: {
  name: LabelKey;
  value: string;
  options: ReadonlyArray<readonly [string, LabelKey]>;
  onChange: (value: string) => void;
  labels: Labels;
}): ReactElement {
  return (
    <label style={{ display: "block" }}>
      {label(labels, name)}
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map(([option, optionLabel]) => (
          <option key={option} value={option}>
            {label(labels, optionLabel)}
          </option>
        ))}
      </select>
    </label>
  );
}

function SearchField({
  draft,
  onDraft,
  labels,
}: {
  draft: string;
  onDraft: (value: string) => void;
  labels: Labels;
}): ReactElement {
  return (
    <label style={{ display: "block" }}>
      {label(labels, "admin_search_orders")}
      <input value={draft} onChange={(event) => onDraft(event.target.value)} />
    </label>
  );
}

function DayField({
  name,
  value,
  onChange,
  labels,
}: {
  name: LabelKey;
  value: string;
  onChange: (value: string) => void;
  labels: Labels;
}): ReactElement {
  return (
    <label style={{ display: "block" }}>
      {label(labels, name)}
      <input onChange={(event) => onChange(event.target.value)} type="date" value={value} />
    </label>
  );
}

/** The three dropdowns, kept together so the form itself stays short. */
function Selects({
  filter,
  onChange,
  labels,
}: {
  filter: OrdersFilter;
  onChange: (patch: Partial<OrdersFilter>) => void;
  labels: Labels;
}): ReactElement {
  return (
    <>
      <Choice
        labels={labels}
        name="admin_filter_status"
        onChange={(status) => onChange({ status })}
        options={STATUS_OPTIONS}
        value={filter.status}
      />
      <Choice
        labels={labels}
        name="admin_filter_platform"
        onChange={(platform) => onChange({ platform })}
        options={PLATFORM_OPTIONS}
        value={filter.platform}
      />
      <Choice
        labels={labels}
        name="admin_filter_settlement"
        onChange={(settlement) => onChange({ settlement })}
        options={SETTLEMENT_OPTIONS}
        value={filter.settlement}
      />
    </>
  );
}

function Filters({
  filter,
  draft,
  onDraft,
  onChange,
  onClear,
  labels,
}: {
  filter: OrdersFilter;
  draft: string;
  onDraft: (value: string) => void;
  onChange: (patch: Partial<OrdersFilter>) => void;
  onClear: () => void;
  labels: Labels;
}): ReactElement {
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onChange({ search: draft });
      }}
      style={{ alignItems: "flex-end", display: "flex", flexWrap: "wrap", gap: spacing.sm }}
    >
      <SearchField draft={draft} labels={labels} onDraft={onDraft} />
      <Selects filter={filter} labels={labels} onChange={onChange} />
      <DayField
        labels={labels}
        name="admin_orders_from"
        onChange={(fromDate) => onChange({ fromDate })}
        value={filter.fromDate}
      />
      <DayField
        labels={labels}
        name="admin_orders_to"
        onChange={(toDate) => onChange({ toDate })}
        value={filter.toDate}
      />
      <Choice
        labels={labels}
        name="admin_sort_by"
        onChange={(sort) => onChange({ sort })}
        options={SORT_OPTIONS}
        value={filter.sort}
      />
      <Button onClick={() => onChange({ search: draft })}>
        {label(labels, "admin_filter_apply")}
      </Button>
      <Button onClick={onClear}>{label(labels, "admin_filter_clear")}</Button>
    </form>
  );
}

/**
 * The order list. Every figure on it is the server's; the browser only formats.
 * Marking an order paid is the owner's record that the money already left, so
 * it is offered only for approved, unpaid orders and only to the owner.
 */
export function OrdersPage({ canMarkPaid }: { canMarkPaid: boolean }): ReactElement {
  const labels = useLabels();
  const [draft, setDraft] = useState("");
  const [filter, setFilter] = useState<OrdersFilter>(EMPTY);
  const [reloadKey, setReloadKey] = useState(0);
  const { orders, pagination, error } = useOrders(filter, reloadKey);
  const paid = useMarkPaid();

  /** A newly chosen filter starts again at page one. */
  const change = (patch: Partial<OrdersFilter>): void => {
    setFilter((current) => ({ ...current, ...patch, page: patch.page ?? 1 }));
  };

  const markPaid = (order: ApiAdminOrder): void => {
    if (order.customerId === null) return;
    void paid.mark(order.customerId, order.orderId).then((ok) => {
      if (ok) setReloadKey((value) => value + 1);
    });
  };

  return (
    <main style={{ color: colors.text, padding: spacing.lg }}>
      <h1>{label(labels, "admin_nav_orders")}</h1>
      {canMarkPaid ? (
        <p style={{ color: colors.muted, fontSize: 12 }}>{label(labels, "admin_orders_mark_hint")}</p>
      ) : null}
      <Filters
        draft={draft}
        filter={filter}
        labels={labels}
        onChange={change}
        onClear={() => {
          setDraft("");
          setFilter(EMPTY);
        }}
        onDraft={setDraft}
      />
      {error !== "" ? (
        <p style={{ color: colors.brand }}>{label(labels, "load_failed", { reason: error })}</p>
      ) : (
        <>
          <OrdersTable
            busyOrderId={paid.busyOrderId}
            canMarkPaid={canMarkPaid}
            labels={labels}
            onMarkPaid={markPaid}
            orders={orders}
          />
          <OrdersPager
            labels={labels}
            onPage={(page) => setFilter((current) => ({ ...current, page }))}
            page={filter.page}
            pagination={pagination}
          />
        </>
      )}
      {paid.error !== "" ? (
        <p style={{ color: colors.brand }}>
          {label(labels, "admin_order_mark_failed", { reason: paid.error })}
        </p>
      ) : null}
    </main>
  );
}
