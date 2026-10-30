/**
 * The tabs of Payouts (EXPERIENCE.md IA): payable now and needs action are the two queues of one
 * list (its `filter[queue]`), history is the payout history (Story 4.12) and network payouts are
 * what the networks paid (Story 4.21), each its own address so a link opens the right tab. On the
 * queue page the two queue tabs switch the filter in place and show their totals; elsewhere they
 * are plain links back to the queue.
 */
import type { PayoutQueue, PayoutQueueCounts } from "@cashback/contracts";
import { cn, formatCount } from "@cashback/ui";
import { Link } from "@tanstack/react-router";

import { adminText, type AdminKey } from "../labels";

export type PayoutTab = PayoutQueue | "HISTORY" | "NETWORK";

interface TabSpec {
  readonly tab: PayoutTab;
  readonly label: AdminKey;
  readonly to: "/payouts" | "/payouts/history" | "/payouts/network";
  readonly search?: Record<string, string>;
}

const TABS: readonly TabSpec[] = [
  { tab: "PAYABLE", label: "payouts_tab_payable", to: "/payouts" },
  { tab: "ACTION", label: "payouts_tab_action", to: "/payouts", search: { "filter[queue]": "ACTION" } },
  { tab: "HISTORY", label: "payouts_tab_history", to: "/payouts/history" },
  { tab: "NETWORK", label: "payouts_tab_network", to: "/payouts/network" },
];

// Four tabs fit a phone as two rows of two; from the small breakpoint they sit in one row.
const TAB_CLASS = "-mb-px inline-flex min-h-11 min-w-0 items-center justify-center gap-2 border-b-2 px-3 text-sm font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50 sm:shrink-0 sm:justify-start";
const tone = (selected: boolean): string => (selected ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground");

function Count({ count }: { readonly count: number | undefined }) {
  if (count === undefined) return null;
  return (
    <span className="rounded-full bg-muted px-1.5 text-caption tabular-nums" aria-label={adminText("payouts_tab_count", { count: formatCount(count) })}>
      {formatCount(count)}
    </span>
  );
}

export interface PayoutTabsProps {
  readonly current: PayoutTab;
  /** The queue page: its two tabs switch the filter in place and show the totals the list sent. */
  readonly queue?: { readonly counts: PayoutQueueCounts | undefined; readonly onSelect: (queue: PayoutQueue) => void };
}

export function PayoutTabs({ current, queue }: PayoutTabsProps) {
  return (
    <div role="tablist" aria-label={adminText("payouts_tabs")} className="grid min-w-0 grid-cols-2 gap-x-1 border-b border-border sm:flex sm:gap-1">
      {TABS.map((spec) => {
        const selected = spec.tab === current;
        const label = <span>{adminText(spec.label)}</span>;
        if (queue !== undefined && (spec.tab === "PAYABLE" || spec.tab === "ACTION")) {
          const tab = spec.tab;
          return (
            <button key={tab} type="button" role="tab" aria-selected={selected} onClick={() => queue.onSelect(tab)} className={cn(TAB_CLASS, tone(selected))}>
              {label}
              <Count count={queue.counts?.[tab === "PAYABLE" ? "payable" : "action"]} />
            </button>
          );
        }
        return (
          <Link key={spec.tab} to={spec.to} search={spec.search ?? {}} role="tab" aria-selected={selected} className={cn(TAB_CLASS, tone(selected))}>
            {label}
          </Link>
        );
      })}
    </div>
  );
}
