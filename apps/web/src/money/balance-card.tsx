/**
 * The balance card (W2 My money, Story 7.3, UX-DR9): the server's three figures and nothing
 * computed here (M-1). The hero is what the next payout sends (`money_payable_label`); under it,
 * while a clawback is open, what that payout deducts and, when it cannot deduct it all, what stays
 * owed after it (the netting `/sodu` states, D42). Waiting is an estimate and says so (M-2); paid is
 * what the recorded payouts sent. Each figure is a link to the rows that add up to it: the approved
 * lines, the waiting lines, the payouts, the clawed-back orders (URL state). The sentence under
 * the card says there is no fixed payout date (D11, M-5).
 */
import { CUSTOMER_PATHS, type MyMoney } from "@cashback/contracts";
import { formatMoney, MoneyFigure, cn } from "@cashback/ui";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { webText, type WebKey } from "../labels";
import { FOCUS_RING } from "../shell/nav-items";
import { moneyLink, ordersWithStatus, type MoneyView } from "./money-search";

const FIGURE_LINK = cn("-mx-2 flex min-w-0 flex-col gap-1 rounded-lg px-2 py-1.5 hover:bg-muted/70", FOCUS_RING);

interface FigureProps {
  readonly label: WebKey;
  readonly amount: number;
  readonly view: MoneyView;
  readonly status?: string;
  readonly children: ReactNode;
}

function Figure({ label, amount, view, status, children }: FigureProps) {
  const search = moneyLink(view, status === undefined ? undefined : ordersWithStatus(status));
  const aria = webText(view === "payouts" ? "money_show_payouts" : "money_show_orders", { label: webText(label), amount: formatMoney(amount) ?? "" });
  return (
    <Link to={CUSTOMER_PATHS.myMoney} search={search} aria-label={aria} data-figure={label} className={FIGURE_LINK}>
      <span className="text-meta text-muted-foreground">{webText(label)}</span>
      {children}
    </Link>
  );
}

function Deduction({ deducted, owedAfter }: { readonly deducted: number; readonly owedAfter: number }) {
  const amount = formatMoney(deducted) ?? "";
  return (
    <div className="flex flex-col gap-1">
      <Link to={CUSTOMER_PATHS.myMoney} search={moneyLink("deducted")} aria-label={webText("money_show_deducted", { amount })} data-deduction className={cn("-mx-2 flex min-h-11 min-w-0 flex-wrap items-center justify-between gap-x-3 rounded-lg px-2 py-1.5 text-[15px] hover:bg-muted/70", FOCUS_RING)}>
        <span className="text-status-attention underline decoration-status-attention/40 underline-offset-4">{webText("money_deducted_label")}</span>
        <span className="font-semibold whitespace-nowrap text-status-attention tabular-nums">{webText("money_deducted_amount", { amount })}</span>
      </Link>
      {owedAfter > 0 && <p className="text-meta text-muted-foreground">{webText("money_owed_after", { amount: formatMoney(owedAfter) ?? "" })}</p>}
    </div>
  );
}

export function BalanceCard({ money }: { readonly money: MyMoney }) {
  const { payable, waiting, paid, deducted, owedAfter } = money.balance;
  return (
    <section aria-label={webText("money_card_label")} data-balance-card className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 md:p-5">
      <Figure label="money_payable_label" amount={payable} view="orders" status="APPROVED">
        <MoneyFigure amount={payable} size="lg" />
      </Figure>
      {deducted > 0 && <Deduction deducted={deducted} owedAfter={owedAfter} />}
      <div className="grid grid-cols-2 gap-3 border-t border-border pt-3">
        <Figure label="money_waiting_label" amount={waiting} view="orders" status="AWAITING_APPROVAL">
          {/* Nothing waiting is a fact, not an estimate. */}
          <MoneyFigure amount={waiting} estimate={waiting > 0} size="md" />
        </Figure>
        <Figure label="money_paid_label" amount={paid} view="payouts">
          <MoneyFigure amount={paid} size="md" />
        </Figure>
      </div>
      <p className="text-meta text-muted-foreground">{webText("money_note")}</p>
    </section>
  );
}
