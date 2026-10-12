import type { ReactElement } from "react";

import { colors, spacing } from "@mmo/ui";

import { usePayouts } from "./features/payouts/payouts.queries";
import { label, useLabels } from "./shared/lib/labels";
import { vnd } from "./shared/lib/money";

/** The payout list: who can be paid now, and who is blocked. Amounts come from the server. */
export function PayoutsPage(): ReactElement {
  const labels = useLabels();
  const { data, error } = usePayouts();

  if (error !== "") {
    return <p style={{ color: colors.brand }}>{label(labels, "load_failed", { reason: error })}</p>;
  }
  if (data === null) {
    return <p style={{ color: colors.muted }}>{label(labels, "loading")}</p>;
  }

  return (
    <main style={{ color: colors.text, padding: spacing.lg }}>
      <h1>{label(labels, "admin_nav_payouts")}</h1>

      <h2>{label(labels, "admin_payouts_ready")}</h2>
      {data.ready.length === 0 ? (
        <p style={{ color: colors.muted }}>{label(labels, "admin_payouts_empty")}</p>
      ) : (
        <ul>
          {data.ready.map((payable) => (
            <li key={payable.customerId}>
              {payable.customerId}: {vnd(payable.amountVnd, labels)}
              {payable.bankChangedRecently
                ? ` (${label(labels, "admin_payouts_bank_changed")})`
                : ""}
            </li>
          ))}
        </ul>
      )}

      <h2>{label(labels, "admin_payouts_blocked")}</h2>
      <ul>
        {data.blocked.map((payable) => (
          <li key={payable.customerId}>
            {payable.customerId}: {payable.blockedReason ?? label(labels, "nothing_known")}
          </li>
        ))}
      </ul>
    </main>
  );
}
