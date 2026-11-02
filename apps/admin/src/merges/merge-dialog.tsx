/**
 * The merge dialog (wireframe "Gop khach dialog", FR-11, Story 4.19): two customer records of one
 * person side by side, the one kept on the left (green) and the one merged into it on the right,
 * each with its Zalo id, orders, what it is owed and its bank account (name and last four only).
 * Under them one line says what happens, or the command's own refusal (two different bank
 * accounts, a transfer under way) and the merge button stays off. The admin may swap which record
 * is kept. Opened from a proposal in Review or from a customer's danger zone, where the other
 * record is typed first. Apply re-plans on the server, so it refuses what a fresh preview would.
 */
import type { DeskMergePreview, DeskMergeSide } from "@cashback/contracts";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  ArrowLeftRightIcon,
  Button,
  CheckIcon,
  cn,
  formatCount,
  formatMoney,
  Input,
  Label,
  Skeleton,
} from "@cashback/ui";
import { useId, useState, type FormEvent } from "react";

import { ApiError } from "../api/api.queries";
import { adminText, errorText } from "../labels";
import { useApplyMerge, useMergePreview, type MergePair } from "./merges.queries";

const codeOf = (side: DeskMergeSide): string => side.customerCode ?? side.customerId;
const zaloText = (id: string): string => id.replace(/(\d{4})(?=\d)/g, "$1 ");

function failureText(error: unknown): string {
  if (!(error instanceof ApiError)) return errorText("error.internal", "internal");
  return errorText(error.messageKey, error.code, error.fields);
}

function Side({ side, kept }: { readonly side: DeskMergeSide; readonly kept: boolean }) {
  return (
    <section data-merge-side={kept ? "survivor" : "merged"} aria-label={adminText(kept ? "merge_keep" : "merge_into")} className={cn("flex min-w-0 flex-col gap-1 rounded-xl p-4", kept ? "bg-secondary" : "bg-muted")}>
      <p className={cn("text-meta font-semibold", kept ? "text-secondary-foreground" : "text-muted-foreground")}>{adminText(kept ? "merge_keep" : "merge_into")}</p>
      <p className="text-base leading-snug font-semibold break-words">{side.customerName === null ? codeOf(side) : `${codeOf(side)} \u00b7 ${side.customerName}`}</p>
      {side.zaloUserId !== null && <p className="text-meta break-words text-muted-foreground">{adminText("merge_zalo", { id: zaloText(side.zaloUserId) })}</p>}
      <p className="text-sm break-words tabular-nums">
        {adminText("merge_side_money", { orders: formatCount(side.orders), payable: formatMoney(side.balance.payable) ?? "" })} {"\u00b7"} {adminText("merge_side_links", { count: formatCount(side.linkRequests) })}
      </p>
      <p className="text-meta break-words text-muted-foreground">{side.bank === null ? adminText("merge_no_bank") : `${side.bank.bankName ?? ""} \u2022\u2022 ${side.bank.lastFour}`.trim()}</p>
    </section>
  );
}

function Outcome({ preview }: { readonly preview: DeskMergePreview }) {
  if (preview.refusal !== null) {
    return (
      <p data-merge-refusal role="alert" className="rounded-md bg-status-rejected-soft p-3 text-sm break-words text-status-rejected">
        {errorText(preview.refusal.messageKey, preview.refusal.code, preview.refusal.fields)}
      </p>
    );
  }
  const merged = codeOf(preview.merged);
  const survivor = codeOf(preview.survivor);
  const banks = preview.merged.bank === null && preview.survivor.bank === null;
  const line = preview.plan?.bankMoves === true ? "merge_bank_moves" : banks ? "merge_no_banks" : "merge_same_bank";
  return (
    <div data-merge-plan className="flex min-w-0 flex-col gap-1">
      <p className="flex min-w-0 items-start gap-2 text-sm break-words">
        <CheckIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />
        <span className="min-w-0">{adminText(line, { merged, survivor })}</span>
      </p>
      {preview.plan !== null && <p className="pl-6 text-meta text-muted-foreground tabular-nums">{adminText("merge_result", { survivor, payable: formatMoney(preview.plan.result.payable) ?? "" })}</p>}
    </div>
  );
}

function OtherCustomer({ onPick }: { readonly onPick: (key: string) => void }) {
  const id = useId();
  const [value, setValue] = useState("");
  const key = value.trim();
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (/^[A-Za-z0-9]{1,64}$/.test(key)) onPick(key);
  };
  return (
    <form onSubmit={submit} className="flex min-w-0 flex-col gap-1.5">
      <Label htmlFor={id}>{adminText("merge_other_label")}</Label>
      <div className="flex min-w-0 gap-2">
        <Input id={id} value={value} autoComplete="off" spellCheck={false} aria-describedby={`${id}-hint`} className="h-11 min-w-0 flex-1 md:h-9" onChange={(event) => setValue(event.target.value)} />
        <Button type="submit" variant="outline" className="h-11 shrink-0 md:h-9" disabled={!/^[A-Za-z0-9]{1,64}$/.test(key)}>
          {adminText("merge_other_check")}
        </Button>
      </div>
      <p id={`${id}-hint`} className="text-meta text-muted-foreground">{adminText("merge_other_hint")}</p>
    </form>
  );
}

function PreviewBody({ waiting, preview }: { readonly waiting: boolean; readonly preview: ReturnType<typeof useMergePreview> }) {
  const data = preview.data;
  if (preview.isError) {
    return (
      <p role="alert" className="rounded-md bg-status-rejected-soft p-3 text-sm break-words text-status-rejected">
        {failureText(preview.error)}
      </p>
    );
  }
  if (data === undefined) {
    if (!waiting) return null;
    return (
      <div role="status" aria-label={adminText("merge_previewing")} className="grid gap-3 sm:grid-cols-2">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }
  return (
    <>
      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        <Side side={data.survivor} kept />
        <Side side={data.merged} kept={false} />
      </div>
      <Outcome preview={data} />
    </>
  );
}

export interface MergeDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** The record kept, and the one merged into it; null until the admin names it (from a customer's page). */
  readonly survivor: string;
  readonly merged: string | null;
  readonly onMerged?: (pair: MergePair) => void;
}

export function MergeDialog({ open, onOpenChange, survivor: initialSurvivor, merged: initialMerged, onMerged }: MergeDialogProps) {
  const [picked, setPicked] = useState<string | null>(initialMerged);
  const [swapped, setSwapped] = useState(false);
  const apply = useApplyMerge();
  const pair: MergePair | null = picked === null ? null : swapped ? { merged: initialSurvivor, survivor: picked } : { merged: picked, survivor: initialSurvivor };
  const preview = useMergePreview(open ? pair : null);
  const data = preview.data;
  const ready = data !== undefined && data.refusal === null && data.plan !== null;
  const close = (next: boolean): void => {
    if (apply.isPending) return;
    onOpenChange(next);
  };
  const confirm = (): void => {
    if (pair === null) return;
    apply.mutate(pair, { onSuccess: () => { onOpenChange(false); onMerged?.(pair); } });
  };
  return (
    <AlertDialog open={open} onOpenChange={close}>
      <AlertDialogContent data-merge-dialog="" className="max-w-[720px] gap-5">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-xl">{adminText("merge_title")}</AlertDialogTitle>
          <AlertDialogDescription className="sr-only">{adminText("merges_lead")}</AlertDialogDescription>
        </AlertDialogHeader>
        {initialMerged === null && <OtherCustomer onPick={(key) => { setPicked(key); setSwapped(false); }} />}
        <PreviewBody waiting={pair !== null} preview={preview} />
        {apply.isError && (
          <p role="alert" className="rounded-md bg-status-rejected-soft p-3 text-sm break-words text-status-rejected">
            {failureText(apply.error)}
          </p>
        )}
        <AlertDialogFooter className="items-stretch sm:items-center">
          {pair !== null && (
            <Button type="button" variant="ghost" className="h-11 sm:mr-auto md:h-9" disabled={apply.isPending} onClick={() => setSwapped((s) => !s)}>
              <ArrowLeftRightIcon aria-hidden />
              {adminText("merge_swap")}
            </Button>
          )}
          <AlertDialogCancel asChild>
            <Button type="button" variant="outline" className="h-11 md:h-10" disabled={apply.isPending}>
              {adminText("merge_cancel")}
            </Button>
          </AlertDialogCancel>
          <Button type="button" className="h-11 px-4 font-semibold md:h-10" disabled={!ready || apply.isPending} aria-busy={apply.isPending} onClick={confirm}>
            {apply.isPending ? adminText("merge_merging") : adminText("merge_confirm", { survivor: data === undefined ? "" : codeOf(data.survivor) })}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
