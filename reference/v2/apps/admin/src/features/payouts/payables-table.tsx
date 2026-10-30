import type { ReactElement } from "react";

import type { ApiPaymentRow, ApiPaymentTotals } from "@mmo/contracts";
import { Button, colors, spacing } from "@mmo/ui";

import { label, type Labels } from "../../shared/lib/labels";
import { vnd } from "../../shared/lib/money";
import { blockedText } from "../../shared/lib/status";

const table = { borderCollapse: "collapse", width: "100%" } as const;
const cell = { borderBottom: `1px solid ${colors.border}`, fontSize: 12, padding: "4px 8px" } as const;

function who(row: ApiPaymentRow, labels: Labels): string {
  return row.displayName ?? row.customerCode ?? row.customerId ?? label(labels, "nothing_known");
}

function bank(row: ApiPaymentRow, labels: Labels): string {
  if (!row.bankAccount) return label(labels, "profile_bank_not_set");
  return [row.bankName, row.bankAccount].filter(Boolean).join(" ");
}

function Card({ name, value, hint }: { name: string; value: string; hint: string }): ReactElement {
  return (
    <div
      style={{
        border: `1px solid ${colors.border}`,
        borderRadius: 6,
        minWidth: 140,
        padding: spacing.sm,
      }}
    >
      <div style={{ color: colors.muted, fontSize: 11 }}>{name}</div>
      <div style={{ fontWeight: 600 }}>{value}</div>
      <div style={{ color: colors.muted, fontSize: 11 }}>{hint}</div>
    </div>
  );
}

/** What is owed right now, before the owner touches anything. */
export function PayoutSummary({
  totals,
  labels,
}: {
  totals: ApiPaymentTotals;
  labels: Labels;
}): ReactElement {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: spacing.sm, marginBottom: spacing.md }}>
      <Card
        hint={label(labels, "admin_users_total", { count: totals.readyCount })}
        name={label(labels, "admin_payouts_ready")}
        value={vnd(totals.readyVnd, labels)}
      />
      <Card
        hint={label(labels, "admin_users_total", { count: totals.blockedCount })}
        name={label(labels, "admin_payouts_blocked")}
        value={vnd(totals.blockedVnd, labels)}
      />
      <Card
        hint={label(labels, "admin_users_total", { count: totals.allCount })}
        name={label(labels, "admin_payouts_total")}
        value={vnd(totals.allVnd, labels)}
      />
    </div>
  );
}

/** Everyone whose money can leave now. */
export function ReadyTable({
  rows,
  labels,
  onPay,
}: {
  rows: ApiPaymentRow[];
  labels: Labels;
  onPay: (row: ApiPaymentRow) => void;
}): ReactElement {
  if (rows.length === 0) {
    return <p style={{ color: colors.muted }}>{label(labels, "admin_payouts_empty")}</p>;
  }
  return (
    <table style={table}>
      <thead>
        <tr>
          <th style={cell}>{label(labels, "admin_col_code")}</th>
          <th style={cell}>{label(labels, "col_customer")}</th>
          <th style={cell}>{label(labels, "admin_col_bank")}</th>
          <th style={cell}>{label(labels, "admin_transfer_amount")}</th>
          <th style={cell} />
          <th style={cell} />
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.customerId}>
            <td style={cell}>{row.customerCode ?? label(labels, "nothing_known")}</td>
            <td style={cell}>{who(row, labels)}</td>
            <td style={cell}>{bank(row, labels)}</td>
            <td style={cell}>{vnd(row.amountVnd, labels)}</td>
            <td style={{ ...cell, color: colors.brand, fontSize: 11 }}>
              {row.bankChangedRecently ? label(labels, "admin_payouts_warning") : null}
            </td>
            <td style={cell}>
              <Button onClick={() => onPay(row)}>{label(labels, "admin_payouts_pay")}</Button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Everyone who cannot be paid yet, and why. */
export function BlockedTable({
  rows,
  labels,
  askedFor,
  onAsk,
}: {
  rows: ApiPaymentRow[];
  labels: Labels;
  askedFor: string | null;
  onAsk: (row: ApiPaymentRow) => void;
}): ReactElement {
  if (rows.length === 0) return <></>;
  return (
    <>
      <h2 style={{ fontSize: 15 }}>{label(labels, "admin_payouts_blocked")}</h2>
      <table style={table}>
        <thead>
          <tr>
            <th style={cell}>{label(labels, "admin_col_code")}</th>
            <th style={cell}>{label(labels, "col_customer")}</th>
            <th style={cell}>{label(labels, "admin_transfer_amount")}</th>
            <th style={cell}>{label(labels, "admin_payouts_reason")}</th>
            <th style={cell} />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.customerId}>
              <td style={cell}>{row.customerCode ?? label(labels, "nothing_known")}</td>
              <td style={cell}>{who(row, labels)}</td>
              <td style={cell}>{vnd(row.amountVnd, labels)}</td>
              <td style={cell}>{blockedText(labels, row.blockedReason)}</td>
              <td style={cell}>
                {askedFor === row.customerId ? (
                  <span style={{ color: colors.muted, fontSize: 11 }}>
                    {label(labels, "admin_payouts_ask_sent")}
                  </span>
                ) : (
                  <Button onClick={() => onAsk(row)}>{label(labels, "admin_payouts_ask_bank")}</Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
