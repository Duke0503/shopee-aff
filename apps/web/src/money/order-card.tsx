/**
 * One order line on My money (pen.dev ktmGZ, jW4fD, YtS6u rows, Story 7.4, UX-DR10): the product
 * picture on the left; the product name with the amount on the right (money green, the estimate in
 * its lighter "about" form while the network decides, 0 in quiet grey when the line counts
 * nowhere); the status badge from the registry (its own line on a phone, beside the meta line
 * wider); one quiet line with the shop and one date with its kind, the date of the step the order
 * reached (recorded, approved, paid; list-defects `MyOrders.tsx`), or a rejected order's reason in
 * words in its place. A cancelled-after-approval or checked order adds the registry sentence; an
 * order with an open clawback says what is deducted. A bonus is its own line, titled with its
 * campaign. The whole line opens the order in full (pen.dev opJFP); rows sit on hairlines.
 */
import { CUSTOMER_PATHS, type MyOrderRow } from "@cashback/contracts";
import { formatVnDateOf, systemClock } from "@cashback/core";
import { formatMoney, MoneyFigure, ProductThumb, StatusBadge, cn } from "@cashback/ui";
import { Link } from "@tanstack/react-router";

import { webText, type WebKey } from "../labels";
import { FOCUS_RING } from "../shell/nav-items";
import { platformName, reasonText, stateSentence } from "./order-words";

const dateOf = (value: string | null): string | null => formatVnDateOf(value, systemClock);

/** The one date a line shows: the step the order reached, with its kind. */
function dateWords(row: MyOrderRow): string | null {
  const step: readonly [WebKey, string | null] =
    row.status === "PAID" ? ["order_date_paid", row.paidAt] : row.status === "APPROVED" ? ["order_date_approved", row.approvedAt ?? row.recordedAt] : ["order_date_recorded", row.recordedAt];
  const date = dateOf(step[1]);
  return date === null ? null : webText(step[0], { date });
}

/** The quiet line: the shop, then the date, or a rejected order's reason in its place. */
export function metaLine(row: MyOrderRow): string {
  const second = row.status === "REJECTED" ? reasonText(row.rejectionReason) : dateWords(row);
  return [platformName(row.platform), second].filter((part): part is string => part !== null).join(" · ");
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
      {row.amount === null ? (
        <MoneyFigure amount={0} size="sm" className="text-[15px] text-muted-foreground" />
      ) : (
        <MoneyFigure amount={row.amount} estimate={row.estimate} size="sm" className={cn("text-[15px]", row.estimate && "font-normal [&>span:last-child]:sr-only")} />
      )}
    </span>
  );
}

export function OrderCard({ row }: { readonly row: MyOrderRow }) {
  const sentence = row.status === "REJECTED" ? null : stateSentence(row.status, row.rejectionReason);
  return (
    <Link
      to={CUSTOMER_PATHS.orderDetail}
      search={{ ma: row.orderId }}
      data-order-line={row.kind}
      className={cn("flex min-w-0 items-start gap-3 border-b border-border pt-3 pb-3.5 hover:bg-muted/50", FOCUS_RING)}
    >
      <ProductThumb src={row.productImageUrl} size={40} className="size-12 rounded-lg" />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex min-w-0 items-start justify-between gap-3">
          <Title row={row} />
          <Amount row={row} />
        </div>
        <div className="flex min-w-0 flex-col items-start gap-1.5 md:flex-row md:items-center md:gap-2">
          <StatusBadge entity="order" value={row.status} />
          <span className="min-w-0 text-meta text-muted-foreground">{metaLine(row)}</span>
        </div>
        {sentence !== null && <p className={cn("text-meta", row.status === "FROZEN" ? "text-status-attention" : "text-status-rejected")}>{sentence}</p>}
        {row.deducted !== null && <p className="rounded-md bg-status-attention-soft px-2.5 py-2 text-meta text-status-attention">{webText(row.status === "PAID" ? "order_deducted_drop" : "order_deducted", { amount: formatMoney(row.deducted) ?? "" })}</p>}
      </div>
    </Link>
  );
}
