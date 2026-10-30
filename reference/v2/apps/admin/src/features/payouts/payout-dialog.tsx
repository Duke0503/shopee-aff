import { useState, type ReactElement } from "react";

import type { ApiConfirmPayoutResult, ApiPaymentPlan, ApiPaymentRow } from "@mmo/contracts";
import { Button, colors, spacing } from "@mmo/ui";

import { shortDate } from "../../shared/lib/dates";
import { label, useLabels, type Labels } from "../../shared/lib/labels";
import { vnd } from "../../shared/lib/money";
import { useConfirmPayout, usePaymentPlan, type ConfirmPayoutState } from "./payouts.queries";
import { vietQrImageUrl } from "./vietqr-image";

function Line({ name, value, strong = false }: { name: string; value: string; strong?: boolean }): ReactElement {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: spacing.sm }}>
      <span style={{ color: colors.muted }}>{name}</span>
      <span style={{ fontWeight: strong ? 600 : 400 }}>{value}</span>
    </div>
  );
}

function Copy({
  plan,
  labels,
}: {
  plan: ApiPaymentPlan;
  labels: Labels;
}): ReactElement {
  const [copied, setCopied] = useState(false);
  const bank = plan.bankAccount === null ? label(labels, "profile_bank_not_set") : plan.bankAccount;
  const toCopy = `${plan.bankAccount ?? ""} ${plan.memo}`.trim();

  return (
    <div style={{ border: `1px solid ${colors.border}`, borderRadius: 6, padding: spacing.md }}>
      <Line
        name={label(labels, "admin_col_bank")}
        value={plan.bankName ?? label(labels, "nothing_known")}
      />
      <Line
        name={label(labels, "admin_detail_holder")}
        value={plan.accountHolder ?? label(labels, "nothing_known")}
      />
      <Line name={label(labels, "col_customer")} value={bank} />
      <Line name={label(labels, "admin_transfer_amount")} value={vnd(plan.totalVnd, labels)} strong />
      <Line name={label(labels, "label_reference")} value={plan.memo} />
      <p style={{ color: colors.muted, fontSize: 11, margin: `${spacing.xs}px 0` }}>
        {label(labels, "admin_payouts_memo_hint")}
      </p>
      <Button
        onClick={() => {
          void navigator.clipboard?.writeText(toCopy);
          setCopied(true);
        }}
      >
        {label(labels, "admin_payouts_copy")}
      </Button>
      {copied ? (
        <span style={{ color: colors.muted, fontSize: 11, marginLeft: spacing.sm }}>
          {label(labels, "admin_payouts_copied")}
        </span>
      ) : null}
    </div>
  );
}

function Qr({ plan, labels }: { plan: ApiPaymentPlan; labels: Labels }): ReactElement {
  return (
    <div style={{ textAlign: "center" }}>
      <h3 style={{ fontSize: 13 }}>{label(labels, "admin_payouts_qr")}</h3>
      {plan.qr === null ? (
        <p style={{ color: colors.muted, fontSize: 12 }}>{label(labels, "admin_payouts_qr_none")}</p>
      ) : (
        <img
          alt={label(labels, "admin_payouts_qr_alt")}
          src={vietQrImageUrl(plan.qr, plan.accountHolder)}
          style={{ maxWidth: 220, width: "100%" }}
        />
      )}
    </div>
  );
}

/** The orders the payout covers, and what the campaign adds on top. */
function Items({ plan, labels }: { plan: ApiPaymentPlan; labels: Labels }): ReactElement {
  const cell = { borderBottom: `1px solid ${colors.border}`, fontSize: 12, padding: "4px 8px" } as const;
  return (
    <>
      <h3 style={{ fontSize: 13 }}>
        {label(labels, "admin_transfer_orders", { count: plan.orders.length })}
      </h3>
      <table style={{ borderCollapse: "collapse", width: "100%" }}>
        <thead>
          <tr>
            <th style={cell}>{label(labels, "col_order")}</th>
            <th style={cell}>{label(labels, "col_date")}</th>
            <th style={cell}>{label(labels, "col_cashback")}</th>
          </tr>
        </thead>
        <tbody>
          {plan.orders.map((order) => (
            <tr key={order.orderId}>
              <td style={cell}>{order.orderId}</td>
              <td style={cell}>{shortDate(order.approvedAt ?? order.recordedAt)}</td>
              <td style={cell}>{vnd(order.cashbackVnd, labels)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ marginTop: spacing.sm }}>
        <Line name={label(labels, "admin_payouts_orders_total")} value={vnd(plan.ordersVnd, labels)} />
        {plan.bonusVnd > 0 ? (
          <Line name={label(labels, "admin_payouts_bonus")} value={vnd(plan.bonusVnd, labels)} />
        ) : null}
        <Line name={label(labels, "admin_transfer_amount")} value={vnd(plan.totalVnd, labels)} strong />
      </div>
    </>
  );
}

function Receipt({
  recorded,
  name,
  labels,
  onDone,
}: {
  recorded: ApiConfirmPayoutResult;
  name: string;
  labels: Labels;
  onDone: () => void;
}): ReactElement {
  return (
    <section>
      <p>{label(labels, "admin_transfer_done", { amount: vnd(recorded.amountVnd, labels), name })}</p>
      <p>
        {label(labels, "admin_transfer_bill")}:{" "}
        <a href={recorded.billPath} rel="noreferrer" target="_blank">
          {recorded.billToken}
        </a>
      </p>
      <Button onClick={onDone}>{label(labels, "btn_close")}</Button>
    </section>
  );
}

/** The plan itself: what to copy, what to scan, and what will be recorded. */
function PlanBody({
  plan,
  labels,
  payout,
}: {
  plan: ApiPaymentPlan;
  labels: Labels;
  payout: ConfirmPayoutState;
}): ReactElement {
  const [note, setNote] = useState("");
  const [transferCode, setTransferCode] = useState("");

  const send = (): void => {
    const orderIds = plan.orders.map((order) => order.orderId);
    void payout.confirm(plan.customerId, orderIds, note, transferCode);
  };

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: spacing.lg }}>
      <div style={{ flex: "1 1 280px" }}>
        <Copy labels={labels} plan={plan} />
        <div style={{ marginTop: spacing.sm }}>
          <label style={{ display: "block" }}>
            {label(labels, "admin_transfer_note")}
            <input onChange={(event) => setNote(event.target.value)} value={note} />
          </label>
        </div>
        <div style={{ marginTop: spacing.xs }}>
          <label style={{ display: "block" }}>
            {label(labels, "admin_transfer_code")}
            <input onChange={(event) => setTransferCode(event.target.value)} value={transferCode} />
          </label>
        </div>
        <p>
          <Button disabled={payout.busy} onClick={send}>
            {label(labels, payout.busy ? "admin_transfer_working" : "admin_transfer_submit")}
          </Button>
        </p>
        {payout.error !== "" ? (
          <p style={{ color: colors.brand }}>
            {label(labels, "admin_transfer_failed", { reason: payout.error })}
          </p>
        ) : null}
      </div>
      <div style={{ flex: "1 1 240px" }}>
        <Qr labels={labels} plan={plan} />
      </div>
      <div style={{ flex: "1 1 320px" }}>
        <Items labels={labels} plan={plan} />
      </div>
    </div>
  );
}

export interface PayoutDialogProps {
  row: ApiPaymentRow;
  onClose: () => void;
  /** Called once money was recorded, so the list reloads. */
  onRecorded: () => void;
}

/**
 * The money-out dialog. It shows only what the server worked out — the payable
 * orders, the confirmed bonuses, the total and the memo — and records the
 * transfer the owner already made in the banking app. The amount written is
 * computed again by the server from the orders, never sent from here.
 */
export function PayoutDialog({ row, onClose, onRecorded }: PayoutDialogProps): ReactElement {
  const labels = useLabels();
  const { plan, error } = usePaymentPlan(row.customerId);
  const payout = useConfirmPayout();
  const name = plan?.displayName ?? row.displayName ?? plan?.customerCode ?? row.customerId;

  return (
    <section
      style={{
        border: `2px solid ${colors.brandSoft}`,
        borderRadius: 8,
        marginTop: spacing.md,
        padding: spacing.md,
      }}
    >
      <header style={{ alignItems: "center", display: "flex", justifyContent: "space-between" }}>
        <h2 style={{ margin: 0 }}>{label(labels, "admin_transfer_title")}</h2>
        <Button onClick={payout.recorded === null ? onClose : onRecorded}>
          {label(labels, "btn_close")}
        </Button>
      </header>

      {error !== "" ? (
        <p style={{ color: colors.brand }}>{label(labels, "load_failed", { reason: error })}</p>
      ) : null}

      {payout.recorded !== null ? (
        <Receipt labels={labels} name={name} onDone={onRecorded} recorded={payout.recorded} />
      ) : plan === null ? (
        <p style={{ color: colors.muted }}>{label(labels, "loading")}</p>
      ) : plan.orders.length === 0 ? (
        <p style={{ color: colors.muted }}>{label(labels, "admin_transfer_nothing")}</p>
      ) : (
        <PlanBody labels={labels} payout={payout} plan={plan} />
      )}
    </section>
  );
}
