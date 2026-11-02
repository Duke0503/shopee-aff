/**
 * One order in full (Story 7.4, FR-13, pen.dev opJFP): the product with its status badge; the
 * money card line by line, every figure the server's (order value, the approved commission, the
 * fee and the withheld tax with their rates, then what the customer receives with the share); the
 * history, one date per step reached (recorded, approved, paid) and the payout that paid it with
 * its receipt; the order code as a copy chip. While the network has not decided, every figure is
 * an estimate and is said to be one (the "about" form and the estimate note). A cashback the split does not
 * explain (an old approval) shows only the commission and the stored figure with a note. A
 * rejected, cancelled or checked order shows the registry sentence instead of money and steps.
 */
import type { MyOrderDetail, MyOrderMoney } from "@cashback/contracts";
import { formatVnDateOf, formatVnTimeOf, systemClock } from "@cashback/core";
import { CodeChip, formatMoney, MoneyFigure, ProductThumb, ReceiptIcon, StatusBadge, cn } from "@cashback/ui";
import type { ReactNode } from "react";

import { webText, type WebKey } from "../labels";
import { FOCUS_RING } from "../shell/nav-items";
import { platformName, reasonText, stateSentence } from "./order-words";

const RATE = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 });
/** A rate in basis points as the customer reads it: 98 is "0,98%". */
export const rateText = (bps: number): string => `${RATE.format(bps / 100)}%`;

const dateTimeOf = (value: string | null): string | null => {
  const date = formatVnDateOf(value, systemClock);
  const time = formatVnTimeOf(value);
  return date === null || time === null ? null : `${date} ${time}`;
};

function Line({ label, children, strong = false }: { readonly label: string; readonly children: ReactNode; readonly strong?: boolean }) {
  return (
    <div className={cn("flex min-w-0 items-baseline justify-between gap-3", strong && "border-t border-border pt-3")}>
      <dt className={strong ? "text-[17px]" : "text-[15px] text-muted-foreground"}>{label}</dt>
      <dd className="shrink-0 text-right">{children}</dd>
    </div>
  );
}

const plain = (amount: number) => <span className="text-[15px] font-medium tabular-nums">{formatMoney(amount)}</span>;
const minus = (amount: number) => <span className="text-[15px] font-medium tabular-nums">{webText("money_deducted_amount", { amount: formatMoney(amount) ?? "" })}</span>;

function MoneyLines({ money }: { readonly money: MyOrderMoney }) {
  const share = rateText(money.shareBps);
  return (
    <>
      <Line label={webText(money.estimate ? "order_commission_estimate" : "order_commission")}>{plain(money.commission)}</Line>
      {money.explained && <Line label={webText("order_fee", { rate: rateText(money.feeBps) })}>{minus(money.fee)}</Line>}
      {money.explained && money.taxBps > 0 && <Line label={webText("order_tax", { rate: rateText(money.taxBps) })}>{minus(money.tax)}</Line>}
      <Line label={webText(money.estimate ? "order_you_get_estimate" : "order_you_get", { share })} strong>
        <MoneyFigure amount={money.cashback} estimate={money.estimate} size="md" className={cn("text-xl", money.estimate && "[&>span:last-child]:sr-only")} />
      </Line>
    </>
  );
}

function MoneyCard({ order }: { readonly order: MyOrderDetail }) {
  const { money } = order;
  return (
    <section aria-label={webText("order_amount_label")} data-order-money className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
      <dl className="flex flex-col gap-3">
        {order.orderValue !== null && <Line label={webText("order_value")}>{plain(order.orderValue)}</Line>}
        {money !== null && <MoneyLines money={money} />}
      </dl>
      {money === null && <p className="text-[15px] text-muted-foreground">{webText("order_no_money")}</p>}
      {money?.estimate === true && <p className="text-meta text-muted-foreground">{webText("order_estimate_note")}</p>}
      {money !== null && !money.explained && <p className="text-meta text-muted-foreground">{webText("order_unexplained_note")}</p>}
    </section>
  );
}

const STEPS: readonly (readonly [WebKey, "recordedAt" | "approvedAt" | "paidAt"])[] = [
  ["order_step_recorded", "recordedAt"],
  ["order_step_approved", "approvedAt"],
  ["order_step_paid", "paidAt"],
];
const STEPS_DONE: Readonly<Record<string, number>> = { AWAITING_APPROVAL: 1, APPROVED: 2, PAID: 3 };

function PaidIn({ order }: { readonly order: MyOrderDetail }) {
  const payout = order.payout;
  if (payout === null) return null;
  const date = formatVnDateOf(payout.recordedAt, systemClock);
  return (
    <span className="flex flex-wrap items-center gap-x-3 text-meta text-muted-foreground">
      {date !== null && <span>{webText("order_paid_in", { date })}</span>}
      {payout.receiptToken !== null && (
        <a href={`/b/${encodeURIComponent(payout.receiptToken)}`} className={cn("-my-3 inline-flex min-h-11 items-center gap-1 rounded-md font-medium text-primary hover:underline", FOCUS_RING)}>
          <ReceiptIcon aria-hidden className="size-4" />
          {webText("payout_receipt")}
        </a>
      )}
    </span>
  );
}

function Steps({ order, done }: { readonly order: MyOrderDetail; readonly done: number }) {
  return (
    <ol aria-label={webText("order_progress")} className="flex flex-col">
      {STEPS.map(([step, field], i) => {
        const reached = i < done;
        return (
          <li key={step} data-step={reached ? "done" : "todo"} className="flex gap-3 border-b border-border py-3 last:border-b-0">
            <span aria-hidden className={cn("mt-1 size-3.5 shrink-0 rounded-full border-2", reached ? "border-primary bg-primary" : "border-input bg-card")} />
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="sr-only">{webText(reached ? "order_step_done" : "order_step_todo", { step: webText(step) })}</span>
              <span aria-hidden className={cn("text-[15px] font-semibold", !reached && "text-muted-foreground")}>
                {webText(step)}
              </span>
              {reached && <span className="text-meta text-muted-foreground tabular-nums">{dateTimeOf(order[field])}</span>}
              {!reached && step === "order_step_paid" && <span className="text-meta text-muted-foreground">{webText("order_history_paid_todo")}</span>}
              {reached && step === "order_step_paid" && <PaidIn order={order} />}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function History({ order }: { readonly order: MyOrderDetail }) {
  const sentence = order.status === "REJECTED" ? reasonText(order.rejectionReason) : stateSentence(order.status, order.rejectionReason);
  const done = STEPS_DONE[order.status];
  return (
    <section aria-labelledby="order-history-title" className="flex flex-col gap-1">
      <h2 id="order-history-title" className="text-lg font-semibold">
        {webText("order_history_title")}
      </h2>
      {done !== undefined ? <Steps order={order} done={done} /> : <p className={cn("rounded-md px-3 py-2.5 text-[15px]", order.status === "FROZEN" ? "bg-status-attention-soft text-status-attention" : "bg-status-rejected-soft text-status-rejected")}>{sentence}</p>}
    </section>
  );
}

export function OrderDetail({ order }: { readonly order: MyOrderDetail }) {
  const network = platformName(order.platform) ?? "";
  return (
    <article data-order-detail className="flex min-w-0 flex-col gap-5">
      <div className="flex min-w-0 items-start gap-3.5">
        <ProductThumb src={order.productImageUrl} size={40} className="size-[72px] rounded-lg" />
        <div className="flex min-w-0 flex-col items-start gap-2">
          <h1 className="line-clamp-3 text-xl leading-snug font-semibold break-words">{order.productName ?? webText("order_product_missing")}</h1>
          <StatusBadge entity="order" value={order.status} />
        </div>
      </div>
      <MoneyCard order={order} />
      {order.deducted !== null && <p className="rounded-md bg-status-attention-soft px-3 py-2.5 text-[15px] text-status-attention">{webText(order.status === "PAID" ? "order_deducted_drop" : "order_deducted", { amount: formatMoney(order.deducted) ?? "" })}</p>}
      <History order={order} />
      <p className="flex flex-wrap items-center gap-2 border-t border-border pt-4 text-meta text-muted-foreground">
        {webText("order_code_label", { platform: network })}
        <CodeChip code={order.orderId} />
      </p>
    </article>
  );
}
