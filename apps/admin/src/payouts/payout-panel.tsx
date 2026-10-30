/**
 * The payout panel (W4, EXPERIENCE.md payout panel and payout claim, UX-DR6): a 480 px right sheet
 * on tablet and desktop, a full-height drawer from the bottom on a phone. Opening it claims the
 * customer for this staff member (one POST, no body) and shows the server's preview; another staff
 * member's claim shows the `panel_taken` line and nothing else. The preview is the claim's
 * snapshot: it is never refetched while the panel is open, and the list behind it pauses its
 * refresh (LC-11). Closing the panel releases the claim, also when the claim's answer arrives
 * only after the panel was closed. When the server says the account changed under the claim, the
 * panel asks for a fresh preview. Confirming the transfer is Story 4.8.
 */
import type { PayoutQueueRow } from "@cashback/contracts";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, Skeleton, useLayout } from "@cashback/ui";
import { useCallback, useEffect, useRef } from "react";

import { ApiError } from "../api/api.queries";
import { adminText, errorText } from "../labels";
import { PayoutPreview } from "./payout-preview";
import { useOpenPayout, useReleasePayout } from "./payouts.queries";

export interface PayoutPanelProps {
  /** The row the panel was opened from; null when closed. */
  readonly row: PayoutQueueRow | null;
  readonly onClose: () => void;
}

function PanelBody({ open, onStale }: { readonly open: ReturnType<typeof useOpenPayout>; readonly onStale: () => void }) {
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
  return <PayoutPreview preview={data} onStale={onStale} />;
}

export function PayoutPanel({ row, onClose }: PayoutPanelProps) {
  const phone = useLayout() === "phone";
  const opened = useRef<string | null>(null);
  const open = useOpenPayout(useCallback((customerId: string) => opened.current === customerId, []));
  const release = useReleasePayout();
  const { mutate, reset } = open;

  useEffect(() => {
    if (row === null || opened.current === row.customerId) return;
    opened.current = row.customerId;
    reset();
    mutate(row.customerId);
  }, [row, mutate, reset]);

  const reload = (): void => {
    if (row === null) return;
    reset();
    mutate(row.customerId);
  };

  const close = (): void => {
    const data = open.data;
    if (data !== undefined && data.outcome === "claimed") release.mutate(data.claimId);
    opened.current = null;
    reset();
    onClose();
  };

  const name = row?.customerName ?? row?.customerCode ?? row?.customerId ?? "";
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
          <SheetTitle className="text-lg font-semibold break-words">{adminText("panel_title", { name })}</SheetTitle>
          <SheetDescription>{row?.customerCode ?? ""}</SheetDescription>
        </SheetHeader>
        <div data-panel={phone ? "drawer" : "sheet"} className="min-w-0 p-4">
          <PanelBody open={open} onStale={reload} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
