/**
 * Block 1, what needs the operator now (dashboard-spec Block 1, Story 4.17 AC1): four tiles, each
 * opening the list that explains it with its filter in the URL (LC-4). The payout tile is the
 * Payouts tab "payable" itself: the same rows, so its count and total are that tab's.
 */
import type { Overview } from "@cashback/contracts";
import { cn, formatCount, formatMoney } from "@cashback/ui";
import { Link } from "@tanstack/react-router";
import type { ComponentProps } from "react";

import { adminText } from "../labels";
import { Block } from "./overview-parts";

interface TileProps {
  readonly label: string;
  readonly value: string;
  readonly definition: string;
  readonly hot: boolean;
  readonly to: ComponentProps<typeof Link>["to"];
  readonly search: Record<string, string>;
  readonly name: string;
}

function Tile({ label, value, definition, hot, to, search, name }: TileProps) {
  return (
    <Link
      to={to}
      // The target list's own URL filters (LC-4); each list validates them with its search schema.
      search={search as never}
      data-todo={name}
      className={cn(
        "flex h-full min-w-0 flex-col gap-1 rounded-xl border bg-card p-4 transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        hot ? "border-status-attention/50" : "border-border",
      )}
    >
      <span className="text-sm font-medium text-muted-foreground">{label}</span>
      <span className={cn("text-lg leading-snug font-semibold break-words", hot ? "text-foreground" : "text-muted-foreground")}>{value}</span>
      <span className="mt-auto text-meta text-muted-foreground">{definition}</span>
    </Link>
  );
}

export function TodoBlock({ todo, today }: { readonly todo: Overview["todo"]; readonly today: string }) {
  return (
    <Block title={adminText("ov_todo_title")} basis={adminText("ov_now_basis")}>
      <div className="grid min-w-0 grid-cols-1 gap-3 min-[480px]:grid-cols-2 xl:grid-cols-4">
        <Tile
          name="payable"
          label={adminText("ov_todo_payable")}
          value={adminText("ov_todo_payable_value", { count: formatCount(todo.payable.customers), amount: formatMoney(todo.payable.amount) ?? "" })}
          definition={adminText("ov_todo_payable_def")}
          hot={todo.payable.customers > 0}
          to="/payouts"
          search={{ "filter[queue]": "PAYABLE" }}
        />
        <Tile
          name="review"
          label={adminText("ov_todo_review")}
          value={adminText("ov_todo_review_value", { count: formatCount(todo.openReviewCases) })}
          definition={adminText("ov_todo_review_def")}
          hot={todo.openReviewCases > 0}
          to="/review"
          search={{ "filter[status]": "OPEN" }}
        />
        <Tile
          name="failed-links"
          label={adminText("ov_todo_failed")}
          value={adminText("ov_todo_failed_value", { count: formatCount(todo.failedLinksToday) })}
          definition={adminText("ov_todo_failed_def")}
          hot={todo.failedLinksToday > 0}
          to="/links"
          search={{ "filter[status]": "FAILED", "filter[createdAt]": `${today}..${today}` }}
        />
        <Tile
          name="no-bank"
          label={adminText("ov_todo_nobank")}
          value={adminText("ov_todo_nobank_value", { count: formatCount(todo.owedWithoutBank.customers), amount: formatMoney(todo.owedWithoutBank.amount) ?? "" })}
          definition={adminText("ov_todo_nobank_def")}
          hot={todo.owedWithoutBank.customers > 0}
          to="/payouts"
          search={{ "filter[queue]": "ACTION" }}
        />
      </div>
    </Block>
  );
}
