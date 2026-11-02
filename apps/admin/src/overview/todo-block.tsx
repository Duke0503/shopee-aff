/**
 * Block 1, what needs the operator now (dashboard-spec Block 1, Story 4.17 AC1): four tiles, each
 * opening the list that explains it with its filter in the URL (LC-4). The payout tile is the
 * Payouts tab "payable" itself: the same rows, so its count and total are that tab's.
 */
import type { Overview } from "@cashback/contracts";
import { BanknoteIcon, ClipboardCheckIcon, cn, formatCount, formatMoney, LandmarkIcon, Link2OffIcon, type LucideIcon } from "@cashback/ui";
import { Link } from "@tanstack/react-router";
import type { ComponentProps } from "react";

import { adminText } from "../labels";
import { Block } from "./overview-parts";

interface TileProps {
  readonly label: string;
  readonly value: string;
  /** The amount under the count, in money green, or in the rejected tone when it is money stuck. */
  readonly amount?: { readonly text: string; readonly stuck: boolean } | undefined;
  readonly definition: string;
  readonly icon: LucideIcon;
  readonly hot: boolean;
  readonly to: ComponentProps<typeof Link>["to"];
  readonly search: Record<string, string>;
  readonly name: string;
}

/** One tile (wireframe Overview tiles): the icon in a soft green circle, the label, the count, the amount; the definition is its tooltip. */
function Tile({ label, value, amount, definition, icon: Icon, hot, to, search, name }: TileProps) {
  return (
    <Link
      to={to}
      // The target list's own URL filters (LC-4); each list validates them with its search schema.
      search={search as never}
      data-todo={name}
      title={definition}
      className={cn(
        "flex h-full min-w-0 items-start gap-3.5 rounded-xl border bg-card p-5 transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        hot ? "border-border" : "border-border opacity-80",
      )}
    >
      <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-full bg-secondary text-primary">
        <Icon className="size-[18px]" />
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-meta text-muted-foreground">{label}</span>
        <span className={cn("text-xl leading-snug font-bold break-words", hot ? "text-foreground" : "text-muted-foreground")}>{value}</span>
        {amount !== undefined && <span className={cn("text-sm font-semibold tabular-nums", amount.stuck ? "text-destructive" : "text-money")}>{amount.text}</span>}
        <span className="sr-only">{definition}</span>
      </span>
    </Link>
  );
}

export function TodoBlock({ todo, today }: { readonly todo: Overview["todo"]; readonly today: string }) {
  return (
    <Block title={adminText("ov_todo_title")} basis={adminText("ov_now_basis")} plain>
      <div className="grid min-w-0 grid-cols-1 gap-3 min-[480px]:grid-cols-2 xl:grid-cols-4">
        <Tile
          name="payable"
          label={adminText("ov_todo_payable")}
          value={adminText("ov_todo_payable_value", { count: formatCount(todo.payable.customers) })}
          amount={{ text: formatMoney(todo.payable.amount) ?? "", stuck: false }}
          icon={BanknoteIcon}
          definition={adminText("ov_todo_payable_def")}
          hot={todo.payable.customers > 0}
          to="/payouts"
          search={{ "filter[queue]": "PAYABLE" }}
        />
        <Tile
          name="review"
          label={adminText("ov_todo_review")}
          value={adminText("ov_todo_review_value", { count: formatCount(todo.openReviewCases) })}
          icon={ClipboardCheckIcon}
          definition={adminText("ov_todo_review_def")}
          hot={todo.openReviewCases > 0}
          to="/review"
          search={{ "filter[status]": "OPEN" }}
        />
        <Tile
          name="failed-links"
          label={adminText("ov_todo_failed")}
          value={adminText("ov_todo_failed_value", { count: formatCount(todo.failedLinksToday) })}
          icon={Link2OffIcon}
          definition={adminText("ov_todo_failed_def")}
          hot={todo.failedLinksToday > 0}
          to="/links"
          search={{ "filter[status]": "FAILED", "filter[createdAt]": `${today}..${today}` }}
        />
        <Tile
          name="no-bank"
          label={adminText("ov_todo_nobank")}
          value={adminText("ov_todo_nobank_value", { count: formatCount(todo.owedWithoutBank.customers) })}
          amount={{ text: formatMoney(todo.owedWithoutBank.amount) ?? "", stuck: true }}
          icon={LandmarkIcon}
          definition={adminText("ov_todo_nobank_def")}
          hot={todo.owedWithoutBank.customers > 0}
          to="/payouts"
          search={{ "filter[queue]": "ACTION" }}
        />
      </div>
    </Block>
  );
}
