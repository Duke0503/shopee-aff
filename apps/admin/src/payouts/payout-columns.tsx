/**
 * The Payouts list's columns and phone card (W4, FR-16). One value per column: customer code and
 * name apart, bank apart from the masked account, order count, settlement, flags, the amount the
 * customer receives (server `getBalances` payable), and the row action. On tablet the code, bank
 * and settlement columns are dropped; the phone card shows the same figures, composed as the
 * wireframe's payout card. A row another staff member holds reads `payout_taken` and has no
 * action; a row with no confirmed bank account has none either and says why. A netting-only row
 * (open clawbacks reach the gross, Story 4.11) opens with `payout_open_netting`: it needs no bank account,
 * because no money moves.
 */
import { BLOCKING_FLAGS, type PayoutQueueRow } from "@cashback/contracts";
import { Button, cn, CodeChip, MoneyFigure, QrCodeIcon, type ListColumn } from "@cashback/ui";

import { adminText } from "../labels";
import { FlagBadges, flagsOf, MaskedAccount, SettlementBadge } from "./payout-badges";

export interface RowActions {
  /** The signed-in staff member, to tell "mine" from "someone else's" claim. */
  readonly staffId: string;
  readonly onOpen: (row: PayoutQueueRow) => void;
}

export function PayoutAction({ row, actions, wide = false }: { readonly row: PayoutQueueRow; readonly actions: RowActions; readonly wide?: boolean }) {
  if (row.claimStaffId !== null && row.claimStaffId !== actions.staffId) {
    const taken = adminText("payout_taken", { name: row.claimStaffName ?? row.claimStaffId });
    if (wide) return <span className="inline-flex h-6 max-w-full items-center rounded-full bg-muted px-2.5 text-meta font-medium text-muted-foreground">{taken}</span>;
    return <span className="block text-meta break-words whitespace-normal text-muted-foreground">{taken}</span>;
  }
  const flags = flagsOf(row.flags);
  const netting = flags.includes("NETTING_ONLY");
  if (!netting && flags.some((flag) => BLOCKING_FLAGS.includes(flag))) {
    return <span className="block text-meta break-words whitespace-normal text-muted-foreground">{adminText("payout_blocked")}</span>;
  }
  const mine = row.claimStaffId === actions.staffId;
  const name = row.customerName ?? row.customerCode ?? row.customerId;
  const label = mine ? adminText("payout_continue") : adminText(netting ? "payout_open_netting" : "payout_open");
  const aria = mine ? "payout_continue_aria" : netting ? "payout_open_netting_aria" : "payout_open_aria";
  // The phone card is itself the "open" control (wireframe phone payouts): a button stretched over it.
  if (wide && !mine && !netting) {
    return <button type="button" aria-label={adminText(aria, { name })} onClick={() => actions.onOpen(row)} className="absolute inset-0 rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/60" />;
  }
  return (
    <Button type="button" variant={netting && !mine ? "outline" : "default"} className={wide ? "h-11 w-full" : "h-8 px-3 coarse:h-11"} aria-label={adminText(aria, { name })} onClick={() => actions.onOpen(row)}>
      {!netting && <QrCodeIcon aria-hidden />}
      {label}
    </Button>
  );
}

export function payoutColumns(actions: RowActions): readonly ListColumn<PayoutQueueRow>[] {
  return [
    { key: "customerCode", header: adminText("col_customer_code"), kind: "code", sortable: true, desktopOnly: true },
    { key: "customerName", header: adminText("col_customer_name"), kind: "name", sortable: true },
    { key: "bankName", header: adminText("col_bank"), kind: "text", sortable: true, desktopOnly: true, width: 128 },
    { key: "accountLastFour", header: adminText("col_account"), kind: "text", width: 92, render: (row) => <MaskedAccount lastFour={row.accountLastFour} /> },
    { key: "orderCount", header: adminText("col_order_count"), kind: "integer", sortable: true, width: 76, render: (row) => <span className="tabular-nums">{adminText("payout_order_count", { count: row.orderCount })}</span> },
    { key: "settlement", header: adminText("col_settlement"), kind: "text", desktopOnly: true, width: 156, render: (row) => <SettlementBadge row={row} /> },
    { key: "flags", header: adminText("col_flags"), kind: "text", width: 128, render: (row) => <FlagBadges flags={flagsOf(row.flags)} changedAt={row.bankChangedAt} /> },
    { key: "payable", header: adminText("col_payable"), kind: "money", sortable: true },
    { key: "claimStaffName", header: adminText("col_payout_action"), kind: "text", width: 128, render: (row) => <PayoutAction row={row} actions={actions} /> },
  ];
}

/** The phone card (wireframe phone payouts): name and amount, then the code chip and the order count, then the bank, account and flags; a row someone else holds is greyed. */
export function PayoutCard({ row, actions }: { readonly row: PayoutQueueRow; readonly actions: RowActions }) {
  const flags = flagsOf(row.flags);
  const taken = row.claimStaffId !== null && row.claimStaffId !== actions.staffId;
  return (
    <article data-card="payout" className={cn("relative flex min-w-0 flex-col gap-1.5 rounded-xl border border-border bg-card p-4", taken && "bg-muted/40 [&_[data-money]]:opacity-60 [&_p]:text-muted-foreground")}>
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1.5">
          <p className="min-w-0 text-base leading-snug font-semibold break-words">{row.customerName ?? row.customerCode ?? row.customerId}</p>
          <div className="flex min-w-0 flex-wrap items-center gap-2 text-meta text-muted-foreground">
            {row.customerCode !== null && <CodeChip code={row.customerCode} className="relative z-10 shrink-0" />}
            <span className="tabular-nums">{adminText("payout_order_count", { count: row.orderCount })}</span>
            <SettlementBadge row={row} />
          </div>
        </div>
        <span className="mt-2 shrink-0 text-right">
          <span className="sr-only">{adminText("col_payable")} </span>
          <MoneyFigure amount={row.payable} size="md" className="text-xl font-bold" />
        </span>
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm text-muted-foreground">
        {row.bankName !== null && <span className="min-w-0 truncate">{row.bankName}</span>}
        <MaskedAccount lastFour={row.accountLastFour} />
        {flags.length > 0 && <FlagBadges flags={flags} changedAt={row.bankChangedAt} />}
        {taken && <PayoutAction row={row} actions={actions} wide />}
      </div>
      {!taken && <PayoutAction row={row} actions={actions} wide />}
    </article>
  );
}
