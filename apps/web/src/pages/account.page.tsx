/**
 * Account (Story 7.3 placeholder; the bank form and password come with Story 7.5). Signed in only.
 * My money's bank card points here; until the form exists it says how to save or change the
 * account in the Zalo private chat, with the command as a copy chip and the Zalo button.
 */
import { webText } from "../labels";
import { CommandHint } from "../shell/command-hint";
import { PageTitle } from "../shell/page-title";
import { ZaloButton } from "../shell/zalo-button";
import { SignedIn } from "./signed-in";

export function AccountPage() {
  return (
    <SignedIn>
      {() => (
        <div className="mx-auto flex max-w-[640px] flex-col gap-5 px-4 pt-6 md:px-6 md:pt-10">
          <PageTitle>{webText("account_page_title")}</PageTitle>
          <section className="flex flex-col gap-3 rounded-xl border border-border bg-card p-5">
            <CommandHint className="text-[15px] text-foreground" template={webText("account_pending")} command={webText("command_bank")} />
            <p className="font-mono text-meta break-words text-muted-foreground">{webText("account_example")}</p>
            <ZaloButton labelKey="account_zalo" className="w-full md:w-fit" />
          </section>
        </div>
      )}
    </SignedIn>
  );
}
