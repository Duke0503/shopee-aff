/**
 * One order line on My money (pen.dev ktmGZ rows, Story 7.4, UX-DR10): the product
 * picture on the left; the product name with the amount on the right (money green, the estimate
 * in its lighter "about" form while the network decides, a dash when it counts nowhere); the
 * status badge from the registry; one quiet line with the shop and one date with its kind
 * (`order_date_recorded`, list-defects `MyOrders.tsx`). A rejected, cancelled or checked order adds
 * the registry sentence with the reason in words. A bonus is its own line, titled with its
 * campaign. An order with an open clawback says what is deducted. Rows sit on hairlines, not cards.
 *
 * The chevron (`order_history_show`) opens the order's history as the pen.dev opJFP
 * draws it: the three steps on a dotted line, each reached one with its time, then the order code
 * as a copy chip. A rejected, cancelled or checked order has no steps: its sentence says it.
 */
import type { MyOrderRow } from "@cashback/contracts";
import { formatVnDateOf, formatVnTimeOf, systemClock } from "@cashback/core";
import { ChevronDownIcon, CodeChip, formatMoney, MoneyFigure, ProductThumb, StatusBadge, cn } from "@cashback/ui";
import { useId, useState } from "react";

import { webText, type WebKey } from "../labels";
import { FOCUS_RING } from "../shell/nav-items";
import { platformName, stateSentence } from "./order-words";

const STEPS: readonly (readonly [WebKey, keyof MyOrderRow])[] = [
  ["order_step_recorded", "recordedAt"],
  ["order_step_approved", "approvedAt"],
  ["order_step_paid", "paidAt"],
];
const STEPS_DONE: Readonly<Record<string, number>> = { AWAITING_APPROVAL: 1, APPROVED: 2, PAID: 3 };

const dateOf = (value: string | null): string | null => formatVnDateOf(value, systemClock);
const dateTimeOf = (value: string | null): string | null => {
  const date = dateOf(value);
  const time = formatVnTimeOf(value);
  return date === null || time === null ? null : `${date} ${time}`;
};

function Steps({ row, done }: { readonly row: MyOrderRow; readonly done: number }) {
  return (
    <ol aria-label={webText("order_progress")} className="flex flex-col">
      {STEPS.map(([step, field], i) => {
        const reached = i < done;
        const at = dateTimeOf(row[field] as string | null);
        return (
          <li key={step} className="flex gap-3 border-b border-border py-2.5 last:border-b-0" aria-label={webText(reached ? "order_step_done" : "order_step_todo", { step: webText(step) })}>
            <span aria-hidden className={cn("mt-1 size-3.5 shrink-0 rounded-full border-2", reached ? "border-primary bg-primary" : "border-input bg-card")} />
            <span aria-hidden className="flex min-w-0 flex-col">
              <span className={cn("text-[15px] font-semibold", !reached && "text-muted-foreground")}>{webText(step)}</span>
              <span className="text-meta text-muted-foreground tabular-nums">{reached ? at : step === "order_step_paid" ? webText("order_history_paid_todo") : null}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function History({ row, id, done }: { readonly row: MyOrderRow; readonly id: string; readonly done: number | undefined }) {
  const network = platformName(row.platform) ?? "";
  return (
    <div id={id} className="flex flex-col gap-2 pl-[60px]">
      {done !== undefined && <Steps row={row} done={done} />}
      <p className="flex flex-wrap items-center gap-2 text-meta text-muted-foreground">
        {webText("order_code_label", { platform: network })}
        <CodeChip code={row.orderId} />
      </p>
    </div>
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
  return <p className="line-clamp-2 min-w-0 text-[15px] leading-snug font-semibold break-words">{product}</p>;
}

function Amount({ row }: { readonly row: MyOrderRow }) {
  return (
    <span className="shrink-0 text-right" data-line-amount>
      <span className="sr-only">{webText("order_amount_label")} </span>
      <MoneyFigure amount={row.amount} estimate={row.estimate} size="sm" className={cn("text-[15px]", row.estimate && "[&>span:last-child]:sr-only")} />
    </span>
  );
}

export function OrderCard({ row }: { readonly row: MyOrderRow }) {
  const [open, setOpen] = useState(false);
  const historyId = useId();
  const sentence = stateSentence(row.status, row.rejectionReason);
  const done = sentence === null ? STEPS_DONE[row.status] : undefined;
  const recorded = dateOf(row.recordedAt);
  const meta = [platformName(row.platform), recorded === null ? null : webText("order_date_recorded", { date: recorded })].filter((part): part is string => part !== null).join(" · ");
  return (
    <article data-order-line={row.kind} className="flex min-w-0 flex-col gap-2 border-b border-border pt-1 pb-3">
      <div className="flex min-w-0 items-start gap-3">
        <ProductThumb src={row.productImageUrl} size={40} className="size-12 rounded-lg" />
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex min-w-0 items-start justify-between gap-3">
            <Title row={row} />
            <Amount row={row} />
          </div>
          <div className="flex min-w-0 items-center gap-2">
            <div className="flex min-w-0 flex-1 flex-col items-start gap-1 md:flex-row md:items-center md:gap-2">
              <StatusBadge entity="order" value={row.status} />
              <span className="min-w-0 text-meta text-muted-foreground">{meta}</span>
            </div>
            <button
              type="button"
              aria-expanded={open}
              aria-controls={historyId}
              aria-label={webText(open ? "order_history_hide" : "order_history_show")}
              title={webText(open ? "order_history_hide" : "order_history_show")}
              onClick={() => setOpen(!open)}
              className={cn("-my-2 -mr-2 inline-flex size-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted", FOCUS_RING)}
            >
              <ChevronDownIcon aria-hidden className={cn("size-5 transition-transform motion-reduce:transition-none", open && "rotate-180")} />
            </button>
          </div>
          {sentence !== null && <p className={cn("text-meta", row.status === "FROZEN" ? "text-status-attention" : "text-status-rejected")}>{sentence}</p>}
          {row.deducted !== null && <p className="rounded-md bg-status-attention-soft px-2.5 py-2 text-meta text-status-attention">{webText(row.status === "PAID" ? "order_deducted_drop" : "order_deducted", { amount: formatMoney(row.deducted) ?? "" })}</p>}
        </div>
      </div>
      {open && <History row={row} id={historyId} done={done} />}
    </article>
  );
}
