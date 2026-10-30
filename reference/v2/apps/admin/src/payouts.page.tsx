import { useState, type ReactElement } from "react";

import type { ApiPaymentRow } from "@mmo/contracts";
import { colors, spacing } from "@mmo/ui";

import { PayoutDialog } from "./features/payouts/payout-dialog";
import { BlockedTable, PayoutSummary, ReadyTable } from "./features/payouts/payables-table";
import { useAskBank, usePayables } from "./features/payouts/payouts.queries";
import { label, useLabels } from "./shared/lib/labels";

/**
 * The money-out desk: who is owed what right now, who is blocked and why, and
 * the dialog that records a transfer already made in the banking app. Every
 * figure on this screen is the server's; the browser only shows it.
 */
export function PayoutsPage(): ReactElement {
  const labels = useLabels();
  const [reloadKey, setReloadKey] = useState(0);
  const [paying, setPaying] = useState<ApiPaymentRow | null>(null);
  const { data, error } = usePayables(reloadKey);
  const askBank = useAskBank();

  return (
    <main style={{ color: colors.text, padding: spacing.lg }}>
      <h1>{label(labels, "admin_nav_payouts")}</h1>

      {error !== "" ? (
        <p style={{ color: colors.brand }}>{label(labels, "load_failed", { reason: error })}</p>
      ) : null}
      {data === null && error === "" ? (
        <p style={{ color: colors.muted }}>{label(labels, "loading")}</p>
      ) : null}

      {data === null ? null : (
        <>
          <PayoutSummary labels={labels} totals={data.totals} />
          <ReadyTable labels={labels} onPay={setPaying} rows={data.payables.ready} />
          <BlockedTable
            askedFor={askBank.askedFor}
            labels={labels}
            onAsk={(row) => {
              void askBank.ask(row.customerId);
            }}
            rows={data.payables.blocked}
          />
          {askBank.error !== "" ? (
            <p style={{ color: colors.brand }}>
              {label(labels, "admin_payouts_ask_failed", { reason: askBank.error })}
            </p>
          ) : null}
        </>
      )}

      {paying === null ? null : (
        <PayoutDialog
          key={paying.customerId}
          onClose={() => setPaying(null)}
          onRecorded={() => {
            setPaying(null);
            setReloadKey((value) => value + 1);
          }}
          row={paying}
        />
      )}
    </main>
  );
}
