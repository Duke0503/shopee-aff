/**
 * My money (Story 7.1 shell; the balance and orders come with Stories 7.3 and 7.4). Signed in
 * only. Until then it names the customer's code as a copyable chip and points to /sodu.
 */
import { CodeChip } from "@cashback/ui";

import { webText } from "../labels";
import { CommandHint } from "../shell/command-hint";
import { PageTitle } from "../shell/page-title";
import { SignedIn } from "./signed-in";

export function MyMoneyPage() {
  return (
    <SignedIn>
      {(customerCode) => (
        <div className="mx-auto flex max-w-[640px] flex-col gap-5 px-4 pt-6 md:px-6 md:pt-10">
          <PageTitle>{webText("my_money_title")}</PageTitle>
          <section className="flex flex-col gap-3 rounded-xl border border-border bg-card p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-meta text-muted-foreground">{webText("my_money_code")}</span>
              <CodeChip code={customerCode} />
            </div>
            <CommandHint className="text-[15px]" template={webText("my_money_pending")} command={webText("command_balance")} />
          </section>
        </div>
      )}
    </SignedIn>
  );
}
