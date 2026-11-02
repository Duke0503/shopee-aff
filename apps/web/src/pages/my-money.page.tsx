/**
 * My money (W2, Stories 7.3 and 7.4, UJ-2): signed in only. One task: see where the money is.
 * It greets the customer by the stored display name, with the code and the month they joined
 * under it (pen.dev ktmGZ), then the balance card, the bank card (the one thing to fix when money
 * waits for an account), then the order lines or payouts. The card and the lists are separate reads: a failing list
 * keeps the balance, a failing balance keeps the list, and each says so with its own retry.
 * Phone and tablet: one 640 px column (pen.dev ktmGZ, jW4fD, YtS6u). Desktop: the title across the
 * top, the money column on the left stays in view beside the list.
 */
import type { MyMoney } from "@cashback/contracts";
import { vnDateOf, type Instant } from "@cashback/core";
import { Button, RefreshCwIcon, Skeleton, type ChangeOptions } from "@cashback/ui";
import { useEffect, useMemo, useRef } from "react";

import { webText } from "../labels";
import { BalanceCard } from "../money/balance-card";
import { BankCard } from "../money/bank-card";
import { MoneyLists } from "../money/money-lists";
import { moneySearch, viewOf } from "../money/money-search";
import { useMyMoney } from "../money/money.queries";
import { useDocumentTitle } from "../shell/use-document-title";
import { SignedIn } from "./signed-in";

export interface MyMoneyPageProps {
  readonly search: Record<string, string>;
  readonly onSearch: (next: Record<string, string>, options?: ChangeOptions) => void;
}

/** "09/2026": the Vietnam month the customer joined. */
const monthOf = (instant: string): string => {
  const [year = "", month = ""] = vnDateOf(instant as Instant).split("-");
  return `${month}/${year}`;
};

/** The greeting by name, and the code with the month the customer joined; the code alone while the money loads or with no join time. */
function Greeting({ code, money }: { readonly code: string; readonly money: MyMoney | undefined }) {
  useDocumentTitle(webText("my_money_title"));
  const name = money?.customer.displayName ?? null;
  const joinedAt = money?.customer.joinedAt ?? null;
  return (
    <div className="flex min-w-0 flex-col gap-1.5" data-greeting>
      <h1 className="text-[28px] leading-tight font-bold tracking-[-0.015em] break-words md:text-[32px]">{name === null ? webText("my_money_greeting_anonymous") : webText("my_money_greeting", { name })}</h1>
      <p className="text-[15px] text-muted-foreground md:text-base">{joinedAt === null ? code : webText("my_money_joined", { code, month: monthOf(joinedAt) })}</p>
    </div>
  );
}

function MoneyColumn({ money }: { readonly money: ReturnType<typeof useMyMoney> }) {
  if (money.data !== undefined) {
    return (
      <>
        <BalanceCard money={money.data} />
        <BankCard money={money.data} />
      </>
    );
  }
  if (money.isPending) {
    return (
      <div aria-busy="true" aria-label={webText("loading")} className="flex flex-col gap-3">
        <Skeleton className="h-52 w-full rounded-xl" />
        <Skeleton className="h-20 w-full rounded-xl" />
      </div>
    );
  }
  return (
    <div role="alert" data-money-error className="flex flex-col items-start gap-3 rounded-xl border border-border bg-card p-4">
      <p className="text-[15px]">{webText("money_error")}</p>
      <Button type="button" variant="outline" className="h-11 px-4 text-[15px]" disabled={money.isFetching} onClick={() => void money.refetch()}>
        <RefreshCwIcon aria-hidden />
        {webText("retry")}
      </Button>
    </div>
  );
}

/** The same parameters whatever their order. */
const keyOf = (params: Readonly<Record<string, string>>): string => JSON.stringify(Object.entries(params).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));

/**
 * The URL in its one form (LC-4): a hand-edited or stale address is corrected in place, once per
 * address (a replace that has not landed yet is not sent again).
 */
function useCanonicalSearch(raw: Record<string, string>, onSearch: MyMoneyPageProps["onSearch"]): Record<string, string> {
  const search = useMemo(() => moneySearch(raw), [raw]);
  const wanted = keyOf(search);
  const differs = wanted !== keyOf(raw);
  const navigate = useRef(onSearch);
  navigate.current = onSearch;
  const replaced = useRef<string | null>(null);
  useEffect(() => {
    if (!differs || replaced.current === wanted) return;
    replaced.current = wanted;
    navigate.current(search, { replace: true });
  }, [differs, wanted, search]);
  return search;
}

function MyMoney({ code, search: raw, onSearch }: MyMoneyPageProps & { readonly code: string }) {
  const money = useMyMoney();
  const search = useCanonicalSearch(raw, onSearch);
  return (
    <div className="mx-auto flex max-w-[640px] flex-col gap-5 px-4 pt-6 md:px-6 md:pt-10 xl:max-w-[1184px] xl:gap-8 xl:px-8 xl:pt-16">
      <Greeting code={code} money={money.data} />
      <div className="flex flex-col gap-5 xl:grid xl:grid-cols-[400px_minmax(0,1fr)] xl:items-start xl:gap-x-10">
        <div className="flex flex-col gap-4 xl:sticky xl:top-20">
          <MoneyColumn money={money} />
        </div>
        <div className="min-w-0">
          <MoneyLists view={viewOf(search["view"])} search={search} money={money.data} onSearch={onSearch} />
        </div>
      </div>
    </div>
  );
}

export function MyMoneyPage(props: MyMoneyPageProps) {
  return <SignedIn>{(code) => <MyMoney code={code} {...props} />}</SignedIn>;
}
