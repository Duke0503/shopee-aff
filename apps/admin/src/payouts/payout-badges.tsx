/**
 * The Payouts row's facts as badges (EXPERIENCE.md flag badge, DESIGN.md flag-badge): each flag
 * as a square attention tag with its own words, the bank-change flag with its change time on hover
 * and for screen readers, and the settlement fact (D27) as its own small badge, never folded into
 * a status or an amount. Colour is never the only signal: every badge has its text.
 */
import { PAYOUT_FLAGS, SETTLEMENT_FACTS, type PayoutFlag, type PayoutQueueRow } from "@cashback/contracts";
import { formatVnDateTime, parseInstant, systemClock } from "@cashback/core";
import { cn, MissingValue } from "@cashback/ui";

import { adminText, type AdminKey } from "../labels";

const FLAG_KEYS: Readonly<Record<PayoutFlag, AdminKey>> = {
  NO_BANK: "flag_no_bank",
  BANK_HELD: "flag_bank_held",
  BANK_CHANGED: "flag_bank_changed",
  SHARED_BANK: "flag_shared_bank",
  NETTING_ONLY: "flag_netting_only",
  ERASED: "flag_erased",
};

export const flagsOf = (text: string): PayoutFlag[] => PAYOUT_FLAGS.filter((flag) => text.split(",").includes(flag));

function changedTitle(changedAt: string | null): string | undefined {
  if (changedAt === null) return undefined;
  return adminText("flag_bank_changed_at", { time: formatVnDateTime(parseInstant(changedAt), systemClock) });
}

export function FlagBadge({ flag, changedAt = null }: { readonly flag: PayoutFlag; readonly changedAt?: string | null }) {
  const title = flag === "BANK_CHANGED" ? changedTitle(changedAt) : undefined;
  return (
    <span
      data-flag={flag}
      title={title}
      className={cn(
        "inline-flex min-h-[22px] max-w-full items-center rounded-sm px-1.5 py-0.5 text-caption leading-tight font-medium",
        flag === "NETTING_ONLY" ? "bg-status-neutral-soft text-status-neutral" : "bg-status-attention-soft text-status-attention",
      )}
    >
      <span className="min-w-0 break-words">{adminText(FLAG_KEYS[flag])}</span>
      {title !== undefined && <span className="sr-only">, {title}</span>}
    </span>
  );
}

export function FlagBadges({ flags, changedAt }: { readonly flags: readonly PayoutFlag[]; readonly changedAt: string | null }) {
  if (flags.length === 0) return <MissingValue />;
  return (
    <span className="flex min-w-0 flex-wrap gap-1 whitespace-normal">
      {flags.map((flag) => (
        <FlagBadge key={flag} flag={flag} changedAt={changedAt} />
      ))}
    </span>
  );
}

const SETTLEMENT_TONE: Readonly<Record<(typeof SETTLEMENT_FACTS)[number], string>> = {
  SETTLED: "bg-status-done-soft text-status-done",
  PARTLY_SETTLED: "bg-status-waiting-soft text-status-waiting",
  UNSETTLED: "bg-status-neutral-soft text-status-neutral",
};

export function SettlementBadge({ row }: { readonly row: Pick<PayoutQueueRow, "settlement" | "settledCount" | "orderCount"> }) {
  if (row.settlement === null) return <MissingValue />;
  const text =
    row.settlement === "SETTLED" ? adminText("settlement_settled") : row.settlement === "PARTLY_SETTLED" ? adminText("settlement_partly", { settled: row.settledCount, total: row.orderCount }) : adminText("settlement_unsettled");
  return (
    <span data-settlement={row.settlement} className={cn("inline-flex h-[22px] max-w-full items-center rounded-full px-2 text-caption font-medium whitespace-nowrap", SETTLEMENT_TONE[row.settlement])}>
      <span className="truncate">{text}</span>
    </span>
  );
}

/** "•• 6789": only the last four digits, everywhere but the panel's audited copy button. */
export function MaskedAccount({ lastFour }: { readonly lastFour: string | null }) {
  if (lastFour === null || lastFour === "") return <MissingValue />;
  return <span className="font-mono text-meta whitespace-nowrap tabular-nums">{adminText("payout_masked_account", { lastFour })}</span>;
}
