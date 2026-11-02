/**
 * Account (W2, Story 7.5, UJ-3, FR-10, FR-9): signed in only. One main task, the bank account the
 * money goes to (add, change, erase, and the wait for the Zalo confirmation); the password below
 * it, closed behind one button. The bank state is My money's own read, so both pages always name
 * the same account. One 640 px column at every width.
 */
import { Button, CodeChip, RefreshCwIcon, Skeleton } from "@cashback/ui";

import { BankSection } from "../account/bank-section";
import { PasswordSection } from "../account/password-form";
import { webText } from "../labels";
import { useMyMoney } from "../money/money.queries";
import { PageTitle } from "../shell/page-title";
import { SignedIn } from "./signed-in";

function Bank() {
  const money = useMyMoney();
  if (money.data !== undefined) return <BankSection bank={money.data.bank} />;
  if (money.isPending) return <Skeleton aria-label={webText("loading")} className="h-56 w-full rounded-xl" />;
  return (
    <div role="alert" className="flex flex-col items-start gap-3 rounded-xl border border-border bg-card p-4">
      <p className="text-[15px]">{webText("money_error")}</p>
      <Button type="button" variant="outline" className="h-11 px-4 text-[15px]" disabled={money.isFetching} onClick={() => void money.refetch()}>
        <RefreshCwIcon aria-hidden />
        {webText("retry")}
      </Button>
    </div>
  );
}

export function AccountPage() {
  return (
    <SignedIn>
      {(code) => (
        <div className="mx-auto flex max-w-[640px] flex-col gap-5 px-4 pt-6 md:px-6 md:pt-10">
          <div className="flex flex-col gap-2">
            <PageTitle>{webText("account_page_title")}</PageTitle>
            <p className="flex flex-wrap items-center gap-2 text-[15px] text-muted-foreground">
              {webText("account_code")}
              <CodeChip code={code} />
            </p>
          </div>
          <Bank />
          <PasswordSection customerCode={code} />
        </div>
      )}
    </SignedIn>
  );
}
