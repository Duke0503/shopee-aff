/**
 * One customer's page (W5 customer page, FR-26, FR-15, FR-10, Story 4.14): who the customer is,
 * the balance card's three figures and the netting line from the server's `getBalances` (the same
 * as the Customers row and Payouts), the bank account with only `•• 1234` and the 72-hour change
 * flag with its time, the open clawbacks, the flags, and the tabs of orders, link requests and
 * payouts. The router mounts the page once per customer key, so opening customer B after A starts
 * from nothing: no figure, tab or list state of A can show on B's page (list-defects
 * `UserDetailDialog.tsx:85`). Nothing here changes money; the payout button goes to Payouts.
 */
import type { CustomerPage as Page, ListSearchState } from "@cashback/contracts";
import { formatVnDateOf, formatVnDateTime, parseInstant, systemClock } from "@cashback/core";
import {
  buttonVariants,
  ChevronLeftIcon,
  CodeChip,
  formatMoney,
  MissingValue,
  MoneyFigure,
  QrCodeIcon,
  Skeleton,
  StatusBadge,
} from "@cashback/ui";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { ApiError } from "../api/api.queries";
import { adminText, errorText } from "../labels";
import { FlagBadges, MaskedAccount } from "../payouts/payout-badges";
import { DangerZone } from "./customer-erase";
import { CustomerLists } from "./customer-lists";
import { useCustomerPage, type CustomerTab } from "./customers.queries";

/** One line of the balance card (wireframe customer page): the label left, the amount right. */
function Figure({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
      <dt className="text-[15px] text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right">{children}</dd>
    </div>
  );
}

const CARD = "flex min-w-0 flex-col gap-2 rounded-xl border border-border bg-card p-5";

function Balance({ page }: { readonly page: Page }) {
  const { balance } = page;
  return (
    <section aria-label={adminText("customer_money")} className={CARD}>
      <dl data-balance className="flex min-w-0 flex-col gap-2">
        <Figure label={adminText("balance_payable")}>
          <MoneyFigure amount={balance.payable} className="text-[15px] font-bold" />
        </Figure>
        <Figure label={adminText("balance_waiting")}>
          <MoneyFigure amount={balance.waiting} estimate className="text-foreground [&_[aria-label]]:font-bold" />
        </Figure>
        <Figure label={adminText("balance_paid")}>
          <MoneyFigure amount={balance.paid} className="text-[15px] font-bold text-foreground" />
        </Figure>
      </dl>
      {balance.deductedNext > 0 && (
        <p className="text-sm break-words">
          {adminText("balance_deducted")}{" "}
          <span className="font-semibold text-status-rejected tabular-nums">
            −{formatMoney(balance.deductedNext)}
          </span>
        </p>
      )}
    </section>
  );
}

const timeOf = (at: string): string => formatVnDateTime(parseInstant(at), systemClock);

function BankCard({ page }: { readonly page: Page }) {
  const bank = page.bank;
  return (
    <section data-bank className={CARD}>
      <h2 className="text-sm font-medium text-muted-foreground">{adminText("customer_bank_title")}</h2>
      {page.status === "ERASED" ? (
        <MissingValue className="text-sm" />
      ) : bank === null ? (
        <p className="text-sm text-muted-foreground">{adminText("customer_bank_none")}</p>
      ) : (
        <>
          <p className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-[17px] font-bold">
            <span className="min-w-0 break-words">{bank.bankName}</span>
            <MaskedAccount lastFour={bank.lastFour} />
          </p>
          <p className="text-meta break-words text-muted-foreground">
            {bank.holderName !== null && <span>{bank.holderName} · </span>}
            {bank.changedAt === null
              ? adminText("customer_bank_saved_unknown")
              : adminText("customer_bank_saved", { time: timeOf(bank.changedAt) })}
          </p>
          {bank.changedRecently && bank.changedAt !== null && (
            <p
              data-bank-changed
              className="rounded-md bg-status-attention-soft p-2 text-sm break-words text-status-attention"
            >
              {adminText("customer_bank_changed", { time: timeOf(bank.changedAt) })}
            </p>
          )}
          {bank.held && (
            <p className="rounded-md bg-status-waiting-soft p-2 text-sm break-words text-status-waiting">
              {adminText("customer_bank_held")}
            </p>
          )}
          {page.flags.includes("SHARED_BANK") && (
            <p className="rounded-md bg-status-attention-soft p-2 text-sm break-words text-status-attention">
              {adminText("customer_bank_shared")}
            </p>
          )}
        </>
      )}
    </section>
  );
}

function Clawbacks({ page }: { readonly page: Page }) {
  if (page.clawbacks.length === 0) return null;
  return (
    <section className={CARD}>
      <h2 className="text-sm font-medium text-muted-foreground">{adminText("customer_clawbacks_title")}</h2>
      <ul className="flex min-w-0 flex-col divide-y divide-border">
        {page.clawbacks.map((c) => (
          <li
            key={c.clawbackId}
            className="flex min-w-0 items-center justify-between gap-3 py-2 text-sm"
          >
            {c.orderId === null ? (
              <span className="min-w-0 break-words">
                {adminText("customer_clawback_none_order", { id: c.clawbackId })}
              </span>
            ) : (
              <CodeChip code={c.orderId} />
            )}
            <span className="shrink-0 font-semibold text-status-rejected tabular-nums">
              −{formatMoney(c.open)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Header({ page }: { readonly page: Page }) {
  const erased = page.status === "ERASED";
  const joined = formatVnDateOf(page.joinedAt, systemClock);
  const facts = [
    joined === null ? null : adminText("customer_joined", { date: joined }),
    // An erased customer's personal fields show the dash (FR-35); a live one without a Zalo id shows nothing.
    page.zaloUserId === null ? (erased ? adminText("customer_zalo", { id: "\u2013" }) : null) : adminText("customer_zalo", { id: page.zaloUserId }),
  ].filter((f) => f !== null);
  const erasedOn = formatVnDateOf(page.erasedAt, systemClock);
  return (
    <header className="flex min-w-0 flex-col gap-3 md:flex-row md:items-start md:justify-between">
      <div className="flex min-w-0 flex-col gap-1.5">
        <h1 className="text-2xl leading-tight font-bold tracking-tight break-words md:text-[26px]">
          {erased
            ? erasedOn === null
              ? adminText("customer_erased")
              : adminText("erased_title", { date: erasedOn })
            : (page.customerName ?? adminText("customer_unnamed"))}
        </h1>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {page.customerCode !== null && <CodeChip code={page.customerCode} />}
          {page.status !== "ACTIVE" && <StatusBadge entity="customer" value={page.status} />}
          {page.flags.length > 0 && (
            <FlagBadges flags={page.flags} changedAt={page.bank?.changedAt ?? null} />
          )}
        </div>
        {facts.length > 0 && (
          <p className="text-[15px] break-words text-muted-foreground">{facts.join(" · ")}</p>
        )}
        {erased && <p data-erased className="text-meta break-words text-muted-foreground">{adminText("erased_note")}</p>}
      </div>
      {!erased && page.balance.payable > 0 && page.customerCode !== null && (
        <Link
          to="/payouts"
          search={{ q: page.customerCode }}
          className={buttonVariants({
            size: "lg",
            className: "h-10 w-full shrink-0 rounded-lg px-4 text-[15px] font-semibold md:w-auto coarse:h-11",
          })}
        >
          <QrCodeIcon aria-hidden />
          {adminText("customer_go_payout", { amount: formatMoney(page.balance.payable) ?? "" })}
        </Link>
      )}
    </header>
  );
}

function Loading() {
  return (
    <div role="status" aria-label={adminText("customer_loading")} className="flex flex-col gap-3">
      <Skeleton className="h-8 w-2/3" />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}

export interface CustomerPageProps {
  readonly customerKey: string;
  readonly tab: CustomerTab;
  readonly state: ListSearchState;
  readonly onChange: (
    tab: CustomerTab,
    state: ListSearchState,
    options?: { readonly replace?: boolean },
  ) => void;
}

export function CustomerPage({ customerKey, tab, state, onChange }: CustomerPageProps) {
  const query = useCustomerPage(customerKey);
  const back = (
    <Link
      to="/customers"
      className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-primary md:min-h-8"
    >
      <ChevronLeftIcon aria-hidden className="size-4" />
      {adminText("customer_back")}
    </Link>
  );
  if (query.data === undefined) {
    const error = query.error;
    return (
      <div className="flex min-w-0 flex-col gap-3">
        {back}
        {query.isError ? (
          <p
            role="alert"
            className="rounded-md bg-status-rejected-soft p-3 text-sm break-words text-status-rejected"
          >
            {error instanceof ApiError
              ? errorText(error.messageKey, error.code)
              : adminText("customer_failed")}
          </p>
        ) : (
          <Loading />
        )}
      </div>
    );
  }
  const page = query.data;
  return (
    <div data-customer={page.customerId} className="flex min-w-0 flex-col gap-4">
      {back}
      <Header page={page} />
      {/* Wireframe customer page: the facts in a 360 px column beside the lists from 1536 px (the lists keep every column), above them below. */}
      <div className="flex min-w-0 flex-col gap-4 2xl:[display:grid] 2xl:grid-cols-[360px_minmax(0,1fr)] 2xl:items-start 2xl:gap-5">
        <div className="grid min-w-0 grid-cols-1 items-start gap-4 md:grid-cols-2 2xl:flex 2xl:flex-col">
          <Balance page={page} />
          <BankCard page={page} />
          <Clawbacks page={page} />
          <DangerZone page={page} customerKey={customerKey} />
        </div>
        <CustomerLists
          customerKey={customerKey}
          counts={page.counts}
          tab={tab}
          state={state}
          onChange={onChange}
        />
      </div>
    </div>
  );
}
