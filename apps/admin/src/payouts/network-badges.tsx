/**
 * The facts of a network payout batch as small badges and figures (Story 4.21): what the match
 * did (matched order by order, over and nothing settled, waiting for the network, or historic: before the
 * cutover, totals only), whether the batch withheld the tax, what happened to each order, a period as
 * `09/2026`, and the unattributed gross, plain unless the operator's orders exceed the batch. Every badge has its
 * words; colour is never the only signal. Nothing is computed: the figures are the server's.
 */
import type { SettlementMatchKind, SettlementOrderOutcome } from "@cashback/contracts";
import { cn, formatMoney, MissingValue, moneyAriaLabel } from "@cashback/ui";

import { adminText, type AdminKey } from "../labels";

const MATCH: Readonly<Record<SettlementMatchKind, { readonly key: AdminKey; readonly tone: string }>> = {
  MATCHED: { key: "match_matched", tone: "bg-status-done-soft text-status-done" },
  MISMATCH: { key: "match_mismatch", tone: "bg-status-attention-soft text-status-attention" },
  PENDING: { key: "match_pending", tone: "bg-status-waiting-soft text-status-waiting" },
  HISTORIC: { key: "match_historic", tone: "bg-status-neutral-soft text-status-neutral" },
};

const OUTCOME: Readonly<Record<SettlementOrderOutcome, { readonly key: AdminKey; readonly tone: string }>> = {
  SETTLED: { key: "outcome_settled", tone: "bg-status-done-soft text-status-done" },
  CANDIDATE: { key: "outcome_candidate", tone: "bg-status-waiting-soft text-status-waiting" },
  CONFLICT: { key: "outcome_conflict", tone: "bg-status-attention-soft text-status-attention" },
  NOT_APPROVED: { key: "outcome_not_approved", tone: "bg-status-attention-soft text-status-attention" },
  UNKNOWN: { key: "outcome_unknown", tone: "bg-status-attention-soft text-status-attention" },
};

const BADGE = "inline-flex min-h-[22px] max-w-full items-center rounded-sm px-1.5 py-0.5 text-caption leading-tight font-medium whitespace-normal";

export function MatchBadge({ match }: { readonly match: SettlementMatchKind }) {
  return (
    <span data-match={match} className={cn(BADGE, MATCH[match].tone)}>
      <span className="min-w-0 break-words">{adminText(MATCH[match].key)}</span>
    </span>
  );
}

export function OutcomeBadge({ outcome }: { readonly outcome: SettlementOrderOutcome }) {
  return (
    <span data-outcome={outcome} className={cn(BADGE, OUTCOME[outcome].tone)}>
      <span className="min-w-0 break-words">{adminText(OUTCOME[outcome].key)}</span>
    </span>
  );
}

/** `2026-09` as `09/2026`. */
export function periodText(period: string | null): string | null {
  if (period === null) return null;
  const [year = "", month = ""] = period.split("-");
  return adminText("settings_period", { month, year });
}

export function Period({ period }: { readonly period: string | null }) {
  const text = periodText(period);
  return text === null ? <MissingValue /> : <span className="whitespace-nowrap tabular-nums">{text}</span>;
}

/**
 * The gross a batch paid for orders of no customer (guest or unknown): a plain figure when 0 or
 * more, an attention figure with its sign when the operator's orders exceed the batch.
 */
export function Unattributed({ amount, className }: { readonly amount: number | null; readonly className?: string }) {
  const text = amount === null ? null : formatMoney(amount);
  if (amount === null || text === null) return <MissingValue className={className} />;
  return (
    <span data-unattributed={amount < 0 ? "over" : "rest"} aria-label={moneyAriaLabel(amount) ?? text} className={cn("font-semibold whitespace-nowrap tabular-nums", amount < 0 ? "text-status-attention" : "text-foreground", className)}>
      {text}
    </span>
  );
}

const WITHHELD: Readonly<Record<"yes" | "no" | "unknown", { readonly key: AdminKey; readonly tone: string }>> = {
  yes: { key: "withheld_yes", tone: "bg-status-neutral-soft text-status-neutral" },
  no: { key: "withheld_no", tone: "bg-status-approved-soft text-status-approved" },
  unknown: { key: "withheld_unknown", tone: "bg-status-attention-soft text-status-attention" },
};

/** Whether the batch withheld the tax, as read from what it paid. */
export function WithheldBadge({ withheld }: { readonly withheld: boolean | null }) {
  const spec = WITHHELD[withheld === null ? "unknown" : withheld ? "yes" : "no"];
  return (
    <span data-withheld={String(withheld)} className={cn(BADGE, spec.tone)}>
      <span className="min-w-0 break-words">{adminText(spec.key)}</span>
    </span>
  );
}
