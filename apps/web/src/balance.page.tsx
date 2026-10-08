import type { ReactElement } from "react";

import { colors, spacing } from "@mmo/ui";

import { useBalance } from "./entities/ledger/balance.queries";

/** The three numbers a customer sees. All computed on the server. */
export function BalancePage(): ReactElement {
  const { balance, error } = useBalance();

  if (error !== "") return <p style={{ color: colors.brand }}>{error}</p>;
  if (balance === null) return <p style={{ color: colors.muted }}>Loading...</p>;

  return (
    <main style={{ padding: spacing.lg, color: colors.text }}>
      <h1>My cashback</h1>
      <ul>
        <li>Approved, waiting for transfer: {balance.approvedWaitingVnd}</li>
        <li>Still with the shop: {balance.stillWithShopVnd}</li>
        <li>Already paid: {balance.alreadyPaidVnd}</li>
      </ul>
    </main>
  );
}
