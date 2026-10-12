import type { ReactElement } from "react";

import { colors, spacing } from "@mmo/ui";

import { useOrders } from "./features/orders/orders.queries";
import { shortDate } from "./shared/lib/dates";
import { label, useLabels } from "./shared/lib/labels";
import { vndOrDash } from "./shared/lib/money";
import { statusText } from "./shared/lib/status";

const cell = { borderBottom: `1px solid ${colors.border}`, fontSize: 12, padding: "4px 8px" } as const;

/** Admin order list. Every amount is whatever the server sent. */
export function OrdersPage(): ReactElement {
  const labels = useLabels();
  const { orders, error } = useOrders();

  if (error !== "") {
    return <p style={{ color: colors.brand }}>{label(labels, "load_failed", { reason: error })}</p>;
  }

  return (
    <main style={{ color: colors.text, padding: spacing.lg }}>
      <h1>{label(labels, "admin_nav_orders")}</h1>
      <table style={{ borderCollapse: "collapse", width: "100%" }}>
        <thead>
          <tr>
            <th style={cell}>{label(labels, "col_order")}</th>
            <th style={cell}>{label(labels, "col_status")}</th>
            <th style={cell}>{label(labels, "col_value")}</th>
            <th style={cell}>{label(labels, "col_cashback")}</th>
            <th style={cell}>{label(labels, "col_date")}</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((order) => (
            <tr key={order.orderId}>
              <td style={cell}>{order.orderId}</td>
              <td style={cell}>{statusText(labels, order.status)}</td>
              <td style={cell}>{vndOrDash(order.orderValueVnd, labels)}</td>
              <td style={cell}>{vndOrDash(order.cashbackVnd, labels)}</td>
              <td style={cell}>{shortDate(order.recordedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
