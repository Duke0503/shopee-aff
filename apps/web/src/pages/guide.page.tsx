/**
 * Guide (W2, Story 7.7, FR-20, FR-13, NFR-7, D11): open to everyone. The steps, how cashback is
 * split with the server's example amounts, the chat commands of Stories 6.7 and 6.8 as copy chips,
 * and when cashback is not paid. Written fresh from the label file: no payout date, no automatic
 * transfer, no minimum amount is promised. One 640 px column that reflows down to 360 px.
 */
import { CodeChip } from "@cashback/ui";
import type { ReactNode } from "react";

import { MoneyExample } from "../guide/money-example";
import { webText, type WebKey } from "../labels";
import { PageTitle } from "../shell/page-title";

const STEPS: readonly WebKey[] = ["guide_step_link", "guide_step_buy", "guide_step_approve", "guide_step_pay"];

/** The chat commands in the order of /help: each with its chip and what it does. */
export const GUIDE_COMMANDS: readonly { readonly command: WebKey; readonly text: WebKey }[] = [
  { command: "command_id", text: "guide_command_id" },
  { command: "command_balance", text: "guide_command_balance" },
  { command: "command_orders", text: "guide_command_orders" },
  { command: "command_bank", text: "guide_command_bank" },
  { command: "command_password", text: "guide_command_password" },
  { command: "command_help", text: "guide_command_help" },
];

const NOT_PAID: readonly WebKey[] = ["guide_none_zalo_browser", "guide_none_guest", "guide_none_rejected", "guide_none_not_in_program", "guide_none_after_payout"];

function Section({ id, title, children }: { readonly id: string; readonly title: WebKey; readonly children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 md:p-6">
      <h2 id={id} className="text-[19px] leading-snug font-semibold">
        {webText(title)}
      </h2>
      {children}
    </section>
  );
}

export function GuidePage() {
  return (
    <div className="mx-auto flex max-w-[640px] min-w-0 flex-col gap-5 px-4 pt-6 md:px-6 md:pt-10">
      <PageTitle lead={webText("guide_lead")}>{webText("guide_title")}</PageTitle>
      <Section id="guide-steps" title="guide_steps_title">
        <ol className="flex flex-col gap-3">
          {STEPS.map((key, i) => (
            <li key={key} className="flex gap-3 text-[15px]">
              <span aria-hidden className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary tabular-nums">
                {i + 1}
              </span>
              <span className="min-w-0 pt-0.5">{webText(key)}</span>
            </li>
          ))}
        </ol>
      </Section>
      <Section id="guide-split" title="guide_split_title">
        <MoneyExample />
      </Section>
      <Section id="guide-commands" title="guide_commands_title">
        <p className="text-[15px] text-muted-foreground">{webText("guide_commands_lead")}</p>
        <ul className="flex flex-col divide-y divide-border" data-guide-commands>
          {GUIDE_COMMANDS.map(({ command, text }) => (
            <li key={command} className="grid grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-x-3 py-2.5">
              <CodeChip code={webText(command)} className="w-fit" />
              <span className="min-w-0 text-[15px]">{webText(text)}</span>
            </li>
          ))}
        </ul>
      </Section>
      <Section id="guide-not-paid" title="guide_none_title">
        <ul className="flex list-disc flex-col gap-2 pl-5 text-[15px] marker:text-muted-foreground">
          {NOT_PAID.map((key) => (
            <li key={key}>{webText(key)}</li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
