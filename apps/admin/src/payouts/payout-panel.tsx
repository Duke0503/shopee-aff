/**
 * The payout panel (W4, EXPERIENCE.md payout panel and payout claim, UX-DR6): a 480 px right sheet
 * on tablet and desktop, a full-height drawer from the bottom on a phone. Opening it claims the
 * customer for this staff member (one POST, no body) and shows the server's preview; another staff
 * member's claim shows the `panel_taken` line and nothing else. The preview is the claim's
 * snapshot: it is never refetched while the panel is open, and the list behind it pauses its
 * refresh (LC-11). Closing the panel releases the claim, also when the claim's answer arrives
 * only after the panel was closed. When the server says the account changed under the claim, the
 * panel asks for a fresh preview.
 *
 * Confirm (Story 4.8) sends the claim id and the preview's snapshot hash. When the server answers
 * that the amount changed, the panel opens the customer again for the new preview and keeps the
 * confirm disabled until the new figures are acknowledged (M-3). A recorded payout replaces the
 * preview with what the server recorded; its claim is CONFIRMED, so closing releases nothing.
 * The proof image is chosen above the confirm button and uploaded once the payout is recorded
 * (Story 4.9); closing the panel forgets a proof not yet sent.
 */
import type { PayoutConfirmResponse, PayoutQueueRow } from "@cashback/contracts";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, Skeleton, useLayout } from "@cashback/ui";
import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError } from "../api/api.queries";
import { adminText, errorText } from "../labels";
import { ChangedNotice, ConfirmAction, RecordedNotice } from "./payout-confirm";
import { PayoutPreview } from "./payout-preview";
import { ProofPicker } from "./proof-picker";
import { useConfirmPayout, useOpenPayout, useReleasePayout } from "./payouts.queries";

export interface PayoutPanelProps {
  /** The row the panel was opened from; null when closed. */
  readonly row: PayoutQueueRow | null;
  readonly onClose: () => void;
}

interface Changed {
  readonly previous: number;
  readonly acked: boolean;
}

interface BodyProps {
  readonly open: ReturnType<typeof useOpenPayout>;
  readonly confirm: ReturnType<typeof useConfirmPayout>;
  readonly changed: Changed | null;
  readonly onAck: () => void;
  readonly onStale: () => void;
  readonly onConfirm: () => void;
  readonly onDone: () => void;
  readonly proof: File | null;
  readonly onProof: (file: File | null) => void;
}

const isAmountChanged = (error: unknown): boolean => error instanceof ApiError && error.messageKey === "error.payout.amount_changed";

function PanelBody({ open, confirm, changed, onAck, onStale, onConfirm, onDone, proof, onProof }: BodyProps) {
  if (confirm.data !== undefined) return <RecordedNotice result={confirm.data} proof={confirm.data.nettingOnly ? null : proof} onDone={onDone} />;
  if (open.isError) {
    const error = open.error;
    const text = error instanceof ApiError ? errorText(error.messageKey, error.code) : errorText("error.internal", "internal");
    return (
      <p role="alert" className="rounded-md bg-status-rejected-soft p-3 text-sm break-words text-status-rejected">
        {text}
      </p>
    );
  }
  const data = open.data;
  if (data === undefined) {
    return (
      <div role="status" aria-label={adminText("panel_loading")} className="flex flex-col gap-3">
        <Skeleton className="mx-auto aspect-square w-full max-w-[254px]" />
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="h-6 w-1/2" />
      </div>
    );
  }
  if (data.outcome === "taken") {
    return (
      <p role="alert" className="rounded-md bg-status-waiting-soft p-3 text-sm font-medium break-words text-status-waiting">
        {adminText("panel_taken", { name: data.staffName })}
      </p>
    );
  }
  const failure = confirm.error instanceof ApiError ? confirm.error : confirm.isError ? { messageKey: "error.internal", code: "internal" } : null;
  return (
    <PayoutPreview
      preview={data}
      onStale={onStale}
      notice={changed === null ? undefined : <ChangedNotice previous={changed.previous} current={data.amount} acked={changed.acked} onAck={onAck} />}
      footer={
        <>
          {data.amount > 0 && <ProofPicker file={proof} onChange={onProof} disabled={confirm.isPending} hint={adminText("proof_after_confirm")} />}
          <ConfirmAction preview={data} pending={confirm.isPending} locked={changed !== null && !changed.acked} error={failure} onConfirm={onConfirm} />
        </>
      }
    />
  );
}

/** The confirm step's state: the confirm call, and the "amount changed" notice until it is acknowledged. */
function useConfirmStep(open: ReturnType<typeof useOpenPayout>, reload: () => void) {
  const confirm = useConfirmPayout();
  const [changed, setChanged] = useState<Changed | null>(null);
  const { reset } = confirm;
  const clear = useCallback((): void => {
    reset();
    setChanged(null);
  }, [reset]);
  const submit = (): void => {
    const data = open.data;
    if (data === undefined || data.outcome !== "claimed") return;
    confirm.mutate(
      { claimId: data.claimId, snapshotHash: data.snapshotHash },
      {
        onError: (error) => {
          if (!isAmountChanged(error)) return;
          setChanged({ previous: data.amount, acked: false });
          reset();
          reload();
        },
      },
    );
  };
  const ack = (): void => setChanged((c) => (c === null ? c : { ...c, acked: true }));
  return { confirm, changed, submit, ack, clear };
}

export function PayoutPanel({ row, onClose }: PayoutPanelProps) {
  const phone = useLayout() === "phone";
  const opened = useRef<string | null>(null);
  const open = useOpenPayout(useCallback((customerId: string) => opened.current === customerId, []));
  const release = useReleasePayout();
  const { mutate, reset } = open;
  const reload = (): void => {
    if (row === null) return;
    reset();
    mutate(row.customerId);
  };
  const step = useConfirmStep(open, reload);
  const { clear } = step;
  const [proof, setProof] = useState<File | null>(null);

  useEffect(() => {
    if (row === null || opened.current === row.customerId) return;
    opened.current = row.customerId;
    reset();
    clear();
    setProof(null);
    mutate(row.customerId);
  }, [row, mutate, reset, clear]);

  const close = (): void => {
    const data = open.data;
    const recorded: PayoutConfirmResponse | undefined = step.confirm.data;
    if (data !== undefined && data.outcome === "claimed" && recorded === undefined) release.mutate(data.claimId);
    opened.current = null;
    reset();
    clear();
    setProof(null);
    onClose();
  };

  const name = row?.customerName ?? row?.customerCode ?? row?.customerId ?? "";
  const shown = open.data;
  // The preview decides, not the list row: the server's amount of 0 is what makes a payout netting only.
  const netting = shown !== undefined && shown.outcome === "claimed" && shown.amount === 0;
  return (
    <Sheet open={row !== null} onOpenChange={(next) => (next ? undefined : close())}>
      <SheetContent
        side={phone ? "bottom" : "right"}
        className={
          phone
            ? "h-dvh max-h-dvh gap-0 overflow-y-auto rounded-none data-[side=bottom]:h-dvh"
            : "gap-0 overflow-y-auto data-[side=right]:w-full data-[side=right]:max-w-[480px] data-[side=right]:sm:max-w-[480px]"
        }
      >
        <SheetHeader className="border-b border-border pr-12">
          <SheetTitle className="text-lg font-semibold break-words">{adminText(netting ? "panel_title_netting" : "panel_title", { name })}</SheetTitle>
          <SheetDescription>{row?.customerCode ?? ""}</SheetDescription>
        </SheetHeader>
        <div data-panel={phone ? "drawer" : "sheet"} className="min-w-0 p-4">
          <PanelBody open={open} confirm={step.confirm} changed={step.changed} onAck={step.ack} onStale={reload} onConfirm={step.submit} onDone={close} proof={proof} onProof={setProof} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
