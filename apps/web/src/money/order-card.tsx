/**
 * One order line on My money (W2 order card, Story 7.4, UX-DR10): the status badge from the
 * registry and the amount (the estimate, marked so, while the network decides; the approved
 * cashback after), the product with its snapshot image (D56), then the three-step progress, or in
 * its place the sentence of a rejected, cancelled or checked order with the reason in words. The
 * last line holds the order code as a copy chip, the shop and one date with its kind
 * (`order_date_recorded`), never another kind of date (list-defects `MyOrders.tsx` date column).
 * The chevron (`order_history_show`) shows the order's recorded, approved and paid times. A bonus
 * is its own line, titled with its campaign. An order with an open clawback says what is deducted:
 * cancelled after payout (the server reads it as REVERSED: its badge, the registry sentence in
 * place of the progress) or paid less for after payout (still paid, `order_deducted_drop`).
 */
import type { MyOrderRow } from "@cashback/contracts";
import { formatVnDateOf, formatVnTimeOf, systemClock } from "@cashback/core";
import { ChevronDownIcon, CodeChip, formatMoney, MoneyFigure, ProductThumb, StatusBadge, cn } from "@cashback/ui";
import { useId, useState } from "react";

import { webText, type WebKey } from "../labels";
import { FOCUS_RING } from "../shell/nav-items";
import { platformName, stateSentence } from "./order-words";

const STEPS: readonly WebKey[] = ["order_step_recorded", "order_step_approved", "order_step_paid"];
const STEPS_DONE: Readonly<Record<string, number>> = { AWAITING_APPROVAL: 1, APPROVED: 2, PAID: 3 };

const dateOf = (value: string | null): string | null => formatVnDateOf(value, systemClock);
const dateTimeOf = (value: string | null): string | null => {
  const date = dateOf(value);
  const time = formatVnTimeOf(value);
  return date === null || time === null ? null : `${date} ${time}`;
};

function Progress({ done }: { readonly done: number }) {
  return (
    <ol aria-label={webText("order_progress")} className="grid grid-cols-3 gap-1.5">
      {STEPS.map((step, i) => {
        const reached = i < done;
        return (
          <li key={step} className="flex min-w-0 flex-col gap-1" aria-label={webText(reached ? "order_step_done" : "order_step_todo", { step: webText(step) })}>
            <span aria-hidden className={cn("h-1.5 rounded-full", reached ? "bg-primary" : "bg-muted")} />
            <span aria-hidden className={cn("truncate text-caption", reached ? "text-foreground" : "text-muted-foreground")}>
              {webText(step)}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function History({ row, id }: { readonly row: MyOrderRow; readonly id: string }) {
  const moments: readonly [WebKey, string | null][] = [
    ["order_history_recorded", row.recordedAt],
    ["order_history_approved", row.approvedAt],
    ["order_history_paid", row.paidAt],
  ];
  return (
    <dl id={id} className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-lg bg-muted/60 px-3 py-2 text-meta">
      {moments.map(([key, at]) => {
        const text = dateTimeOf(at);
        return text === null ? null : (
          <div key={key} className="contents">
            <dt className="text-muted-foreground">{webText(key)}</dt>
            <dd className="tabular-nums">{text}</dd>
          </div>
        );
      })}
    </dl>
  );
}

function Title({ row }: { readonly row: MyOrderRow }) {
  const product = row.productName ?? webText("order_product_missing");
  if (row.kind === "bonus") {
    return (
      <div className="min-w-0">
        <p className="line-clamp-2 text-[15px] leading-snug font-semibold break-words">{webText("order_bonus_title", { campaign: row.campaignName ?? "" })}</p>
        <p className="truncate text-meta text-muted-foreground">{product}</p>
      </div>
    );
  }
  return <p className="line-clamp-2 min-w-0 text-[15px] leading-snug font-medium break-words">{product}</p>;
}

export function OrderCard({ row }: { readonly row: MyOrderRow }) {
  const [open, setOpen] = useState(false);
  const historyId = useId();
  const sentence = stateSentence(row.status, row.rejectionReason);
  const done = STEPS_DONE[row.status];
  const recorded = dateOf(row.recordedAt);
  const meta = [platformName(row.platform), recorded === null ? null : webText("order_date_recorded", { date: recorded })].filter((part): part is string => part !== null).join(" · ");
  return (
    <article data-order-line={row.kind} className="flex min-w-0 flex-col gap-2.5 rounded-xl border border-border bg-card p-3 md:p-4">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <StatusBadge entity="order" value={row.status} />
        <span className="shrink-0 text-right" data-line-amount>
          <span className="sr-only">{webText("order_amount_label")} </span>
          <MoneyFigure amount={row.amount} estimate={row.estimate} size="md" />
        </span>
      </div>
      <div className="flex min-w-0 items-center gap-2.5">
        <ProductThumb src={row.productImageUrl} size={40} />
        <Title row={row} />
      </div>
      {done !== undefined && sentence === null ? <Progress done={done} /> : sentence !== null && <p className={cn("text-[15px]", row.status === "FROZEN" ? "text-status-attention" : "text-status-rejected")}>{sentence}</p>}
      {row.deducted !== null && <p className="rounded-md bg-status-attention-soft px-2.5 py-2 text-meta text-status-attention">{webText(row.status === "PAID" ? "order_deducted_drop" : "order_deducted", { amount: formatMoney(row.deducted) ?? "" })}</p>}
      <div className="flex min-w-0 items-center gap-2 text-meta text-muted-foreground">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
          <CodeChip code={row.orderId} className="shrink-0" />
          <span className="min-w-0">{meta}</span>
        </div>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={historyId}
          aria-label={webText(open ? "order_history_hide" : "order_history_show")}
          title={webText(open ? "order_history_hide" : "order_history_show")}
          onClick={() => setOpen(!open)}
          className={cn("-my-2.5 -mr-1.5 inline-flex size-11 shrink-0 items-center justify-center rounded-md text-primary hover:bg-muted", FOCUS_RING)}
        >
          <ChevronDownIcon aria-hidden className={cn("size-5 transition-transform motion-reduce:transition-none", open && "rotate-180")} />
        </button>
      </div>
      {open && <History row={row} id={historyId} />}
    </article>
  );
}
