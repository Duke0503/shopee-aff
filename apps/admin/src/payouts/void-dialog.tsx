/**
 * The void dialog (W4, EXPERIENCE.md "Void payout", M-3, UX-DR7; Story 4.10): admin only, one
 * AlertDialog. It opens on the server's own preview: each covered order with its cashback and the
 * state it returns to (approved, or reversed when the report showed a cancel, D41), each bonus
 * with its next state, the netting given back and the clawback closed, and whether the customer
 * gets a correction message. A reason is required before the destructive button works. Nothing
 * is computed here; after the void every desk query refreshes (LC-10).
 */
import type { PayoutVoidPreview } from "@cashback/contracts";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  CodeChip,
  formatMoney,
  Label,
  MoneyFigure,
  Skeleton,
  StatusBadge,
  Textarea,
} from "@cashback/ui";
import { useId, useState, type ReactNode } from "react";

import { ApiError } from "../api/api.queries";
import { adminText, errorText } from "../labels";
import { useVoidPayout, useVoidPreview } from "./payout-record.queries";

export interface VoidDialogProps {
  readonly payoutId: number;
  readonly amount: number;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onVoided: (replay: boolean) => void;
}

function Row({ code, amount, state }: { readonly code: ReactNode; readonly amount: ReactNode; readonly state: ReactNode }) {
  return (
    <li className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 py-2 sm:grid-cols-[minmax(0,1fr)_auto_8.5rem]">
      <span className="min-w-0">{code}</span>
      <span className="text-right">{amount}</span>
      <span className="col-span-2 sm:col-span-1 sm:justify-self-end">{state}</span>
    </li>
  );
}

function Lines({ preview }: { readonly preview: PayoutVoidPreview }) {
  return (
    <section className="min-w-0">
      <h3 className="text-sm font-semibold">{adminText("void_orders")}</h3>
      <ul data-void-lines="" className="divide-y divide-border">
        {preview.orders.map((o) => (
          <Row key={o.orderId} code={<CodeChip code={o.orderId} />} amount={<MoneyFigure amount={o.cashback} />} state={<StatusBadge entity="order" value={o.to} />} />
        ))}
        {preview.awards.map((a) => (
          <Row key={`award-${a.awardId}`} code={<span className="text-sm break-words">{adminText("void_bonus", { order: a.orderId })}</span>} amount={<MoneyFigure amount={a.amount} />} state={<StatusBadge entity="campaignAward" value={a.to} />} />
        ))}
      </ul>
      {(preview.nettingReversed > 0 || preview.clawbacksClosed > 0 || preview.refunded > 0) && (
        <dl className="mt-1 divide-y divide-border border-t border-border">
          {preview.nettingReversed > 0 && <Fact label={adminText("void_netting")} amount={preview.nettingReversed} />}
          {preview.clawbacksClosed > 0 && <Fact label={adminText("void_clawback")} amount={preview.clawbacksClosed} />}
          {preview.refunded > 0 && <Fact label={adminText("void_refund")} amount={preview.refunded} />}
        </dl>
      )}
    </section>
  );
}

function Fact({ label, amount }: { readonly label: string; readonly amount: number }) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-3 py-2">
      <dt className="text-meta text-muted-foreground">{label}</dt>
      <dd className="text-sm font-semibold tabular-nums">{formatMoney(amount)}</dd>
    </div>
  );
}

function ReasonField({ value, onChange }: { readonly value: string; readonly onChange: (value: string) => void }) {
  const id = useId();
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label htmlFor={`${id}-reason`}>{adminText("void_reason")}</Label>
      <Textarea id={`${id}-reason`} value={value} maxLength={500} required aria-describedby={`${id}-hint`} onChange={(event) => onChange(event.target.value)} />
      <p id={`${id}-hint`} className="text-caption text-muted-foreground">
        {adminText("void_reason_hint")}
      </p>
    </div>
  );
}

function failureText(error: unknown): string {
  return error instanceof ApiError ? errorText(error.messageKey, error.code) : errorText("error.internal", "internal");
}

export function VoidDialog({ payoutId, amount, open, onOpenChange, onVoided }: VoidDialogProps) {
  const preview = useVoidPreview(payoutId, open);
  const voiding = useVoidPayout();
  const [reason, setReason] = useState("");
  const data = preview.data;
  const blank = reason.trim() === "";
  const submit = (): void => {
    if (blank) return;
    voiding.mutate({ payoutId, reason: reason.trim() }, { onSuccess: (result) => onVoided(result.replay) });
  };
  return (
    <AlertDialog open={open} onOpenChange={(next) => (voiding.isPending ? undefined : onOpenChange(next))}>
      <AlertDialogContent data-void-dialog="">
        <AlertDialogHeader>
          <AlertDialogTitle>{adminText("void_title", { amount: formatMoney(amount) ?? "" })}</AlertDialogTitle>
          <AlertDialogDescription>{adminText("void_body")}</AlertDialogDescription>
        </AlertDialogHeader>
        {preview.isError && (
          <p role="alert" className="rounded-md bg-status-rejected-soft p-3 text-sm break-words text-status-rejected">
            {failureText(preview.error)}
          </p>
        )}
        {data === undefined && !preview.isError && (
          <div role="status" aria-label={adminText("void_loading")} className="flex flex-col gap-2">
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-6 w-2/3" />
          </div>
        )}
        {data !== undefined && (
          <>
            <Lines preview={data} />
            <p className="rounded-md bg-muted p-3 text-meta break-words text-muted-foreground">{adminText(data.told ? "void_told" : "void_not_told")}</p>
            <ReasonField value={reason} onChange={setReason} />
          </>
        )}
        {voiding.isError && (
          <p role="alert" className="rounded-md bg-status-rejected-soft p-3 text-sm break-words text-status-rejected">
            {failureText(voiding.error)}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel asChild>
            <Button type="button" variant="outline" className="h-11 md:h-9" disabled={voiding.isPending}>
              {adminText("void_keep")}
            </Button>
          </AlertDialogCancel>
          <Button type="button" className="h-11 bg-destructive text-destructive-foreground hover:bg-destructive/90 md:h-9" disabled={data === undefined || data.status !== "RECORDED" || blank || voiding.isPending} aria-busy={voiding.isPending} onClick={submit}>
            {voiding.isPending ? adminText("void_confirming") : adminText("void_confirm")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
