/**
 * The bank account card (W2 My money, Story 7.3, UX-DR9, FR-10): the bank, the last four digits
 * only and the holder, with `bank_change` to Account. With money to send and no account, the card becomes
 * the one thing to fix: the amount it waits for and one button to Account. A change made on the
 * website and not yet confirmed in the Zalo private chat says so; payouts wait for it. Without an
 * account and nothing to send, one quiet line.
 */
import { CUSTOMER_PATHS, type MyMoney } from "@cashback/contracts";
import { buttonVariants, cn, formatMoney, TriangleAlertIcon } from "@cashback/ui";
import { Link } from "@tanstack/react-router";

import { webText } from "../labels";
import { CommandHint } from "../shell/command-hint";
import { FOCUS_RING } from "../shell/nav-items";

const ACCOUNT_LINK = cn("inline-flex h-11 shrink-0 items-center rounded-lg px-3 text-[15px] font-semibold text-primary hover:bg-muted", FOCUS_RING);

function MissingBank({ payable }: { readonly payable: number }) {
  return (
    <section data-bank="missing" role="status" className="flex flex-col items-start gap-3 rounded-xl border border-warning/40 bg-warning-soft p-4 md:p-5">
      <div className="flex items-start gap-2.5">
        <TriangleAlertIcon aria-hidden className="mt-0.5 size-5 shrink-0 text-warning" />
        <div className="flex flex-col gap-1">
          <h2 className="text-[17px] leading-snug font-semibold">{webText("bank_missing_title", { amount: formatMoney(payable) ?? "" })}</h2>
          <p className="text-[15px]">{webText("bank_missing_body")}</p>
        </div>
      </div>
      <Link to={CUSTOMER_PATHS.account} className={cn(buttonVariants(), "h-11 w-full px-5 text-[15px] md:w-fit")}>
        {webText("bank_missing_button")}
      </Link>
    </section>
  );
}

export function BankCard({ money }: { readonly money: MyMoney }) {
  const { bank } = money;
  if (bank === null) {
    if (money.balance.payable > 0) return <MissingBank payable={money.balance.payable} />;
    return (
      <p data-bank="none" className="flex flex-wrap items-center justify-between gap-x-3 px-1 text-[15px] text-muted-foreground">
        {webText("bank_none")}
        <Link to={CUSTOMER_PATHS.account} className={ACCOUNT_LINK}>
          {webText("bank_none_add")}
        </Link>
      </p>
    );
  }
  return (
    <section data-bank={bank.held ? "held" : "saved"} aria-label={webText("bank_title")} className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 md:p-5">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-meta text-muted-foreground">{webText("bank_title")}</span>
          <p className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-[15px] font-semibold">
            <span className="min-w-0 break-words">{bank.bankName ?? webText("bank_unnamed")}</span>
            <span className="font-mono whitespace-nowrap tabular-nums">{webText("bank_masked", { lastFour: bank.lastFour })}</span>
          </p>
          {bank.holderName !== null && <p className="truncate text-meta text-muted-foreground">{bank.holderName}</p>}
        </div>
        <Link to={CUSTOMER_PATHS.account} className={cn(ACCOUNT_LINK, "-mt-2 -mr-2")}>
          {webText("bank_change")}
        </Link>
      </div>
      {bank.held && (
        <div className="rounded-md bg-status-attention-soft px-3 py-2 text-status-attention">
          <p className="text-[15px] font-semibold">{webText("bank_held")}</p>
          <CommandHint className="text-meta text-status-attention" template={webText("bank_held_body")} command={webText("command_bank_confirm", { lastFour: bank.lastFour })} />
        </div>
      )}
    </section>
  );
}
