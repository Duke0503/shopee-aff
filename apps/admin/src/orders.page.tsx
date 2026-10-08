import type { ReactElement } from "react";

import { colors, spacing } from "@mmo/ui";

import { useOrders } from "./features/orders/orders.queries";

/** Admin order list. Every amount is whatever the server sent. */
export function OrdersPage(): ReactElement {
  const { orders, error } = useOrders();

  if (error !== "") return <p style={{ color: colors.brand }}>{error}</p>;

  return (
    <main style={{ padding: spacing.lg, color: colors.text }}>
      <h1>Orders</h1>
      <table>
        <thead>
          <tr>
            <th>Order</th>
            <th>Status</th>
            <th>Value</th>
            <th>Cashback</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((order) => (
            <tr key={order.orderId}>
              <td>{order.orderId}</td>
              <td>{order.status}</td>
              <td>{order.orderValueVnd ?? 0}</td>
              <td>{order.cashbackVnd ?? 0}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
