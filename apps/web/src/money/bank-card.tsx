/**
 * The bank account card (W2 My money, pen.dev ktmGZ and ADaDc, Story 7.3, UX-DR9,
 * FR-10): the bank icon, the bank, the last four digits
 * only and the holder, with `bank_change` to Account. With money to send and no account, the card becomes
 * the one thing to fix: the amount it waits for and one button to Account. A change made on the
 * website and not yet confirmed in the Zalo private chat says so; payouts wait for it. Without an
 * account and nothing to send, one quiet line.
 */
import { CUSTOMER_PATHS, type MyMoney } from "@cashback/contracts";
import { buttonVariants, cn, formatMoney, LandmarkIcon } from "@cashback/ui";
import { Link } from "@tanstack/react-router";

import { webText } from "../labels";
import { CommandHint } from "../shell/command-hint";
import { FOCUS_RING } from "../shell/nav-items";

const ACCOUNT_LINK = cn("inline-flex h-11 shrink-0 items-center rounded-lg bg-muted px-3.5 text-[15px] font-semibold hover:bg-border", FOCUS_RING);

function MissingBank({ payable }: { readonly payable: number }) {
  return (
    <section data-bank="missing" role="status" className="flex items-center gap-3 rounded-xl border border-[#FDBA74] bg-attention-soft p-4 text-attention md:p-5">
      <LandmarkIcon aria-hidden className="size-6 shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <h2 className="text-base leading-snug font-semibold">{webText("bank_missing_title", { amount: formatMoney(payable) ?? "" })}</h2>
        <p className="text-meta md:text-sm">{webText("bank_missing_body")}</p>
      </div>
      <Link to={CUSTOMER_PATHS.account} className={cn(buttonVariants(), "h-11 shrink-0 rounded-lg px-4 text-[15px] font-semibold")}>
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
      <div className="flex min-w-0 items-center gap-3">
        <LandmarkIcon aria-hidden className="size-6 shrink-0 text-primary" />
        <div className="flex min-w-0 flex-1 flex-col">
          <p className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-base font-semibold">
            <span className="min-w-0 break-words">{bank.bankName ?? webText("bank_unnamed")}</span>
            <span className="whitespace-nowrap tabular-nums">{webText("bank_masked", { lastFour: bank.lastFour })}</span>
          </p>
          {bank.holderName !== null && <p className="truncate text-meta text-muted-foreground uppercase">{bank.holderName}</p>}
        </div>
        <Link to={CUSTOMER_PATHS.account} className={ACCOUNT_LINK}>
          {webText("bank_change")}
        </Link>
      </div>
      {bank.held && (
        <div className="rounded-lg bg-warning-soft px-3 py-2.5 text-warning">
          <p className="text-[15px] font-semibold">{webText("bank_held")}</p>
          <CommandHint className="text-meta text-warning" template={webText("bank_held_body")} command={webText("command_bank_confirm", { lastFour: bank.lastFour })} />
        </div>
      )}
    </section>
  );
}
