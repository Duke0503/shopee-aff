/**
 * My money (W2, Stories 7.3 and 7.4, UJ-2): signed in only. One task: see where the money is.
 * The balance card, then the bank card (the one thing to fix when money waits for an account),
 * then the order lines or payouts. The card and the lists are separate reads: a failing list
 * keeps the balance, a failing balance keeps the list, and each says so with its own retry.
 * Phone and tablet: one 640 px column (pen.dev ktmGZ, jW4fD, YtS6u). Desktop: the title across the
 * top, the money column on the left stays in view beside the list.
 */
import { Button, CodeChip, RefreshCwIcon, Skeleton, type ChangeOptions } from "@cashback/ui";
import { useEffect, useMemo, useRef } from "react";

import { webText } from "../labels";
import { BalanceCard } from "../money/balance-card";
import { BankCard } from "../money/bank-card";
import { MoneyLists } from "../money/money-lists";
import { moneySearch, viewOf } from "../money/money-search";
import { useMyMoney } from "../money/money.queries";
import { PageTitle } from "../shell/page-title";
import { SignedIn } from "./signed-in";

export interface MyMoneyPageProps {
  readonly search: Record<string, string>;
  readonly onSearch: (next: Record<string, string>, options?: ChangeOptions) => void;
}

function Lead({ code }: { readonly code: string }) {
  const [before = "", after = ""] = webText("my_money_lead", { code: "\u0000" }).split("\u0000");
  return (
    <p className="text-[15px] text-muted-foreground md:text-base">
      {before}
      <CodeChip code={code} className="mx-0.5 align-middle" />
      {after}
    </p>
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
    <div className="mx-auto flex max-w-[640px] flex-col gap-5 px-4 pt-6 md:px-6 md:pt-10 xl:max-w-[1024px] xl:gap-8 xl:px-8 xl:pt-16">
      <div className="flex flex-col gap-1.5">
        <PageTitle>{webText("my_money_title")}</PageTitle>
        <Lead code={code} />
      </div>
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
