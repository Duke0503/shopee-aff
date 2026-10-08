import type { ReactElement } from "react";

import { colors, spacing } from "@mmo/ui";

import { useMyOrders } from "./entities/orders/my-orders.queries";

/** A customer's orders. The cashback amount is whatever the server sent. */
export function MyOrdersPage(): ReactElement {
  const { orders, error } = useMyOrders();

  if (error !== "") return <p style={{ color: colors.brand }}>{error}</p>;
  if (orders.length === 0) return <p style={{ color: colors.muted }}>No orders yet.</p>;

  return (
    <main style={{ padding: spacing.lg, color: colors.text }}>
      <h1>My orders</h1>
      <ul>
        {orders.map((order) => (
          <li key={order.orderId}>
            {order.orderId} — {order.status} — {order.cashbackVnd ?? 0}
          </li>
        ))}
      </ul>
    </main>
  );
}
