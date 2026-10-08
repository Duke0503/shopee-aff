import type { ReactElement } from "react";

import { colors, spacing } from "@mmo/ui";

import { usePayouts } from "./features/payouts/payouts.queries";

/** The payout list: who can be paid now, and who is blocked. Amounts come from the server. */
export function PayoutsPage(): ReactElement {
  const { data, error } = usePayouts();

  if (error !== "") return <p style={{ color: colors.brand }}>{error}</p>;
  if (data === null) return <p style={{ color: colors.muted }}>Loading...</p>;

  return (
    <main style={{ padding: spacing.lg, color: colors.text }}>
      <h1>Payouts</h1>
      <h2>Ready</h2>
      <ul>
        {data.ready.map((payable) => (
          <li key={payable.customerId}>
            {payable.customerId}: {payable.amountVnd}
            {payable.bankChangedRecently ? " (bank changed recently)" : ""}
          </li>
        ))}
      </ul>
      <h2>Blocked</h2>
      <ul>
        {data.blocked.map((payable) => (
          <li key={payable.customerId}>
            {payable.customerId}: {payable.blockedReason}
          </li>
        ))}
      </ul>
    </main>
  );
}
