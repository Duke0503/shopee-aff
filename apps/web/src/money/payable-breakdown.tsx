/**
 * How the payable figure is made (Story 7.4 AC4, review M17), shown above the approved lines when
 * the card's payable figure opens them: the approved orders and bonuses (the rows below add up to
 * it), minus what the next payout deducts for clawed-back orders (a link to them), plus what a
 * voided payout gave back, equals the card's figure. Every amount is the server's; nothing is
 * added up here (M-1).
 */
import { CUSTOMER_PATHS, type MyMoney } from "@cashback/contracts";
import { cn, formatMoney, MoneyFigure } from "@cashback/ui";
import { Link } from "@tanstack/react-router";

import { webText } from "../labels";
import { FOCUS_RING } from "../shell/nav-items";
import { moneyLink } from "./money-search";

const LINE = "flex min-w-0 items-baseline justify-between gap-3";

export function PayableBreakdown({ balance }: { readonly balance: MyMoney["balance"] }) {
  const { approved, deducted, refunded, payable } = balance;
  return (
    <section aria-label={webText("breakdown_label")} data-payable-breakdown className="flex flex-col gap-1.5 rounded-xl border border-border bg-card p-4 text-[15px]">
      <p className={LINE}>
        <span>{webText("breakdown_approved")}</span>
        <MoneyFigure amount={approved} />
      </p>
      {deducted > 0 && (
        <Link to={CUSTOMER_PATHS.myMoney} search={moneyLink("deducted")} data-breakdown="deducted" className={cn(LINE, "-mx-1 min-h-11 items-center rounded-md px-1 hover:bg-muted", FOCUS_RING)}>
          <span className="text-status-attention underline decoration-status-attention/40 underline-offset-4">{webText("breakdown_deducted")}</span>
          <span className="font-semibold whitespace-nowrap text-status-attention tabular-nums">{webText("money_deducted_amount", { amount: formatMoney(deducted) ?? "" })}</span>
        </Link>
      )}
      {refunded > 0 && (
        <p className={LINE} data-breakdown="refunded">
          <span>{webText("breakdown_refunded")}</span>
          <span className="font-semibold whitespace-nowrap text-money tabular-nums">{webText("money_plus_amount", { amount: formatMoney(refunded) ?? "" })}</span>
        </p>
      )}
      <p className={cn(LINE, "mt-1 border-t border-border pt-2 font-semibold")} data-breakdown="total">
        <span>{webText("breakdown_total")}</span>
        <MoneyFigure amount={payable} size="md" />
      </p>
    </section>
  );
}
