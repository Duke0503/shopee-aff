import type { ReactElement } from "react";

import { colors, spacing } from "@mmo/ui";

import { useTransfers } from "./features/transfers/transfers.queries";

/** The payouts we have already made, newest first. */
export function TransfersPage(): ReactElement {
  const { transfers, error } = useTransfers();

  if (error !== "") return <p style={{ color: colors.brand }}>{error}</p>;

  return (
    <main style={{ padding: spacing.lg, color: colors.text }}>
      <h1>Transfers</h1>
      <table>
        <thead>
          <tr>
            <th>Id</th>
            <th>Customer</th>
            <th>Amount</th>
            <th>Orders</th>
            <th>When</th>
          </tr>
        </thead>
        <tbody>
          {transfers.map((transfer) => (
            <tr key={transfer.id}>
              <td>{transfer.id}</td>
              <td>{transfer.customerId}</td>
              <td>{transfer.amountVnd}</td>
              <td>{transfer.orderIds.length}</td>
              <td>{transfer.createdAt}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
