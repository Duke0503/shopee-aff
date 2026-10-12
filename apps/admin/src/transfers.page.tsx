import type { ReactElement } from "react";

import { colors, spacing } from "@mmo/ui";

import { useTransfers } from "./features/transfers/transfers.queries";
import { shortDateTime } from "./shared/lib/dates";
import { label, useLabels } from "./shared/lib/labels";
import { vnd } from "./shared/lib/money";

const cell = { borderBottom: `1px solid ${colors.border}`, fontSize: 12, padding: "4px 8px" } as const;

/** The payouts we have already made, newest first. */
export function TransfersPage(): ReactElement {
  const labels = useLabels();
  const { transfers, error } = useTransfers();

  if (error !== "") {
    return <p style={{ color: colors.brand }}>{label(labels, "load_failed", { reason: error })}</p>;
  }

  return (
    <main style={{ color: colors.text, padding: spacing.lg }}>
      <h1>{label(labels, "admin_nav_transfers")}</h1>
      <table style={{ borderCollapse: "collapse", width: "100%" }}>
        <thead>
          <tr>
            <th style={cell}>{label(labels, "admin_col_code")}</th>
            <th style={cell}>{label(labels, "col_customer")}</th>
            <th style={cell}>{label(labels, "admin_transfer_amount")}</th>
            <th style={cell}>{label(labels, "admin_col_orders")}</th>
            <th style={cell}>{label(labels, "col_date")}</th>
          </tr>
        </thead>
        <tbody>
          {transfers.map((transfer) => (
            <tr key={transfer.id}>
              <td style={cell}>{transfer.id}</td>
              <td style={cell}>{transfer.customerId}</td>
              <td style={cell}>{vnd(transfer.amountVnd, labels)}</td>
              <td style={cell}>{transfer.orderIds.length}</td>
              <td style={cell}>{shortDateTime(transfer.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
