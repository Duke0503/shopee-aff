/**
 * Guide (W2, pen.dev a2PNz phone and W7Y4C desktop, Story 7.7, FR-20, FR-13, NFR-7, D11): open to
 * everyone. One reading column with no cards: the chat commands of Stories 6.7 and 6.8 as copy
 * chips on hairlines, the soft green "how much you get" box with the server's example amounts
 * (the step-by-step split folds open under it), and when cashback is not paid as a dashed list.
 * Written fresh from the label file: no payout date, no automatic transfer, no minimum amount is
 * promised. 680 px wide on desktop; it reflows down to 360 px.
 */
import { CodeChip } from "@cashback/ui";

import { MoneyExample } from "../guide/money-example";
import { webText, type WebKey } from "../labels";
import { PageTitle } from "../shell/page-title";
import { MinusIcon } from "../shell/page-icons";

/** The chat commands in the order the pen.dev guide lists them, /help last: each with its chip and what it does. */
export const GUIDE_COMMANDS: readonly { readonly command: WebKey; readonly text: WebKey }[] = [
  { command: "command_id", text: "guide_command_id" },
  { command: "command_password", text: "guide_command_password" },
  { command: "command_balance", text: "guide_command_balance" },
  { command: "command_orders", text: "guide_command_orders" },
  { command: "command_bank", text: "guide_command_bank" },
  { command: "command_help", text: "guide_command_help" },
];

const NOT_PAID: readonly WebKey[] = ["guide_none_guest", "guide_none_zalo_browser", "guide_none_rejected", "guide_none_other_code"];

const SECTION_TITLE = "text-lg leading-snug font-semibold md:text-xl";

export function GuidePage() {
  return (
    <div className="mx-auto flex max-w-[680px] min-w-0 flex-col gap-7 px-4 pt-6 md:px-6 md:pt-10 xl:px-0 xl:pt-14">
      <PageTitle lead={webText("guide_lead")}>{webText("guide_title")}</PageTitle>
      <section aria-labelledby="guide-commands" className="flex flex-col gap-2">
        <h2 id="guide-commands" className={SECTION_TITLE}>
          {webText("guide_commands_title")}
        </h2>
        <ul className="flex flex-col divide-y divide-border border-b border-border" data-guide-commands>
          {GUIDE_COMMANDS.map(({ command, text }) => (
            <li key={command} className="grid grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-x-4 py-3">
              <CodeChip code={webText(command)} className="h-7 w-24 justify-between border-0 bg-muted font-semibold" />
              <span className="min-w-0 text-[15px]">{webText(text)}</span>
            </li>
          ))}
        </ul>
      </section>
      <section aria-labelledby="guide-split" className="flex flex-col gap-2 rounded-xl bg-money-soft p-4 md:p-5">
        <h2 id="guide-split" className="text-[17px] font-semibold">
          {webText("guide_share_title")}
        </h2>
        <MoneyExample />
      </section>
      <section aria-labelledby="guide-not-paid" className="flex flex-col gap-2">
        <h2 id="guide-not-paid" className={SECTION_TITLE}>
          {webText("guide_none_title")}
        </h2>
        <ul className="flex flex-col gap-2 text-[15px]">
          {NOT_PAID.map((key) => (
            <li key={key} className="flex gap-3">
              <MinusIcon aria-hidden className="mt-1 size-4 shrink-0 text-muted-foreground" />
              {webText(key)}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
