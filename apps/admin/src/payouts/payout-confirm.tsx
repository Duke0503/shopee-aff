/**
 * The confirm step of the payout panel (W4, EXPERIENCE.md payout panel and M-3, UX-DR6, Stories
 * 4.8 and 4.11). One button states what is being recorded, `panel_confirm` with the amount or, for
 * a netting-only payout, `panel_confirm_netting`; it is the single confirmation, with no second
 * dialog. When the server says the set changed, the panel shows `error.payout.amount_changed` with the
 * new and the previous amount above the fresh preview, and the button stays disabled until the
 * new figures are acknowledged. Once recorded, the panel shows what the server recorded, then the
 * proof upload and, for an admin, the void action (recorded-actions.tsx, Stories 4.9 and 4.10).
 */
import type { PayoutConfirmResponse, PayoutPreview } from "@cashback/contracts";
import { Button, CheckIcon, formatMoney } from "@cashback/ui";

import { adminText, errorText } from "../labels";
import { RecordedActions } from "./recorded-actions";

export interface ConfirmActionProps {
  readonly preview: PayoutPreview;
  readonly pending: boolean;
  /** The new figures after a change are not acknowledged yet. */
  readonly locked: boolean;
  /** An error the last confirm answered, other than "amount changed". */
  readonly error: { readonly messageKey: string; readonly code: string } | null;
  readonly onConfirm: () => void;
}

export function ConfirmAction({ preview, pending, locked, error, onConfirm }: ConfirmActionProps) {
  const netting = preview.amount === 0;
  const label = netting ? adminText("panel_confirm_netting") : adminText("panel_confirm", { amount: formatMoney(preview.amount) ?? "" });
  return (
    <div data-confirm="" className="sticky bottom-0 -mx-6 -mb-6 mt-auto flex min-w-0 flex-col gap-3 bg-popover px-6 pt-4 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
      {error !== null && (
        <p role="alert" className="rounded-md bg-status-rejected-soft p-3 text-sm break-words text-status-rejected">
          {errorText(error.messageKey, error.code)}
        </p>
      )}
      <Button type="button" size="lg" className="h-12 w-full rounded-xl text-base font-semibold whitespace-normal" disabled={pending || locked} aria-busy={pending} onClick={onConfirm}>
        {pending ? adminText("panel_confirming") : label}
      </Button>
      <p className="text-meta break-words text-muted-foreground">{adminText(netting ? "panel_confirm_netting_hint" : "panel_confirm_hint")}</p>
    </div>
  );
}

export function ChangedNotice({ previous, current, acked, onAck }: { readonly previous: number; readonly current: number; readonly acked: boolean; readonly onAck: () => void }) {
  return (
    <div role="alert" data-changed="" className="flex min-w-0 flex-col gap-1.5 rounded-xl bg-warning-soft p-4 text-warning">
      <p className="min-w-0 text-base font-bold break-words">{errorText("error.payout.amount_changed", "conflict")}</p>
      <p className="text-sm break-words">{adminText("panel_changed_detail", { amount: formatMoney(current) ?? "", previous: formatMoney(previous) ?? "" })}</p>
      {!acked && (
        <Button type="button" variant="outline" className="h-11 self-start bg-background" onClick={onAck}>
          {adminText("panel_changed_ack")}
        </Button>
      )}
    </div>
  );
}

export function RecordedNotice({ result, proof, onDone }: { readonly result: PayoutConfirmResponse; readonly proof: File | null; readonly onDone: () => void }) {
  const text = result.nettingOnly ? adminText("panel_recorded_netting", { amount: formatMoney(result.netted) ?? "" }) : adminText("panel_recorded", { amount: formatMoney(result.amount) ?? "" });
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div role="status" data-recorded="" className="flex min-w-0 flex-col gap-1 rounded-xl bg-money-soft p-4 text-secondary-foreground">
        <p className="flex min-w-0 items-start gap-2 text-sm font-semibold">
          <CheckIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
          <span className="min-w-0 break-words">{text}</span>
        </p>
        <p className="text-sm break-words">{adminText("panel_recorded_items", { count: result.orderCount + result.awardCount })}</p>
        {result.replay && <p className="text-sm break-words">{adminText("panel_recorded_replay")}</p>}
      </div>
      <RecordedActions result={result} proof={proof} />
      <Button type="button" size="lg" className="h-12 w-full rounded-xl text-base font-semibold" onClick={onDone}>
        {adminText("panel_done")}
      </Button>
    </div>
  );
}
