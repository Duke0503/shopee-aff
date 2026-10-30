import type { ReactElement } from "react";

import type { ApiAdminOrder, ApiPagination } from "@mmo/contracts";
import { Button, colors, spacing } from "@mmo/ui";

import { shortDate } from "../../shared/lib/dates";
import { label, type Labels } from "../../shared/lib/labels";
import { vnd, vndOrDash } from "../../shared/lib/money";
import { settlementText, statusText } from "../../shared/lib/status";
import { OrderMoney } from "../../shared/ui/order-money";

const table = { borderCollapse: "collapse", width: "100%" } as const;
const cell = { borderBottom: `1px solid ${colors.border}`, fontSize: 12, padding: "4px 8px" } as const;

/** The product the customer asked about, or the link they sent. */
function Product({ order }: { order: ApiAdminOrder }): ReactElement {
  if (order.sourceUrl === null) return <span>{order.productName || "—"}</span>;
  return (
    <a href={order.sourceUrl} rel="noreferrer" target="_blank">
      {order.productName || order.sourceUrl}
    </a>
  );
}

/** Only an approved, unpaid order of a known customer can have been paid. */
function canPay(order: ApiAdminOrder, canMarkPaid: boolean): boolean {
  return canMarkPaid && order.customerId !== null && order.status === "approved" && order.paidAt === null;
}

function Row({
  order,
  labels,
  canMarkPaid,
  busyOrderId,
  onMarkPaid,
}: {
  order: ApiAdminOrder;
  labels: Labels;
  canMarkPaid: boolean;
  busyOrderId: string | null;
  onMarkPaid: (order: ApiAdminOrder) => void;
}): ReactElement {
  return (
    <tr>
      <td style={cell}>{order.orderId}</td>
      <td style={cell}>
        {order.customerCode ?? order.customerName ?? order.customerId ?? label(labels, "nothing_known")}
      </td>
      <td style={cell}>
        <Product order={order} />
      </td>
      <td style={cell}>{vndOrDash(order.orderValueVnd, labels)}</td>
      <td style={cell}>{vnd(order.cashbackVnd, labels)}</td>
      <td style={cell}>
        <OrderMoney breakdown={order.breakdown} />
      </td>
      <td style={cell}>{settlementText(labels, order.settlementStatus)}</td>
      <td style={cell}>{statusText(labels, order.status)}</td>
      <td style={cell}>{shortDate(order.recordedAt)}</td>
      <td style={cell}>
        {canPay(order, canMarkPaid) ? (
          <Button disabled={busyOrderId === order.orderId} onClick={() => onMarkPaid(order)}>
            {label(
              labels,
              busyOrderId === order.orderId ? "admin_order_marking" : "admin_order_mark_paid",
            )}
          </Button>
        ) : null}
      </td>
    </tr>
  );
}

/** Every order, with the same money explanation the customer's own page gives. */
export function OrdersTable({
  orders,
  labels,
  canMarkPaid,
  busyOrderId,
  onMarkPaid,
}: {
  orders: ApiAdminOrder[];
  labels: Labels;
  canMarkPaid: boolean;
  busyOrderId: string | null;
  onMarkPaid: (order: ApiAdminOrder) => void;
}): ReactElement {
  if (orders.length === 0) {
    return <p style={{ color: colors.muted }}>{label(labels, "admin_orders_none")}</p>;
  }
  return (
    <table style={table}>
      <thead>
        <tr>
          <th style={cell}>{label(labels, "col_order")}</th>
          <th style={cell}>{label(labels, "col_customer")}</th>
          <th style={cell}>{label(labels, "col_product")}</th>
          <th style={cell}>{label(labels, "col_value")}</th>
          <th style={cell}>{label(labels, "col_cashback")}</th>
          <th style={cell}>{label(labels, "admin_money_commission")}</th>
          <th style={cell}>{label(labels, "admin_col_settlement")}</th>
          <th style={cell}>{label(labels, "col_status")}</th>
          <th style={cell}>{label(labels, "col_date")}</th>
          <th style={cell} />
        </tr>
      </thead>
      <tbody>
        {orders.map((order) => (
          <Row
            busyOrderId={busyOrderId}
            canMarkPaid={canMarkPaid}
            key={order.orderId}
            labels={labels}
            onMarkPaid={onMarkPaid}
            order={order}
          />
        ))}
      </tbody>
    </table>
  );
}

export function OrdersPager({
  page,
  pagination,
  onPage,
  labels,
}: {
  page: number;
  pagination: ApiPagination | null;
  onPage: (page: number) => void;
  labels: Labels;
}): ReactElement {
  const totalPages = pagination?.total_pages ?? 1;
  return (
    <nav style={{ alignItems: "center", display: "flex", gap: spacing.sm, marginTop: spacing.md }}>
      <Button disabled={page <= 1} onClick={() => onPage(page - 1)}>
        {label(labels, "admin_page_prev")}
      </Button>
      <span style={{ color: colors.muted }}>
        {label(labels, "admin_page_of", { page, total: totalPages })} ·{" "}
        {label(labels, "label_orders", { count: pagination?.total ?? 0 })}
      </span>
      <Button disabled={page >= totalPages} onClick={() => onPage(page + 1)}>
        {label(labels, "admin_page_next")}
      </Button>
    </nav>
  );
}
