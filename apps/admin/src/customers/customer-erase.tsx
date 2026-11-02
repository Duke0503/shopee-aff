/**
 * The danger zone of a customer's page (W5, FR-35, NFR-6, D13, D26, Story 4.16): erasing the
 * customer's personal data at their request. The dialog says what goes and what stays. While the
 * customer is owed money (payable or waiting, from the page's `getBalances`), an employee can only
 * read why it is refused; an admin may force it with a reason. The server checks all of it again
 * and its refusal is shown as it says. An erased customer's page shows the zone switched off. An
 * admin also finds the merge with another record here (merges/merge-dialog.tsx).
 */
import type { CustomerPage } from "@cashback/contracts";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  formatMoney,
  Label,
  Textarea,
} from "@cashback/ui";
import { useId, useState } from "react";

import { ApiError } from "../api/api.queries";
import { adminText, errorText } from "../labels";
import { MergeDialog } from "../merges/merge-dialog";
import { useStaff } from "../session/staff-context";
import { useEraseCustomer } from "./customers.queries";

function failureText(error: unknown): string {
  if (!(error instanceof ApiError)) return errorText("error.internal", "internal");
  const owed = error.fields;
  const money = (key: string): string => formatMoney(Number(owed[key] ?? 0)) ?? "";
  return errorText(error.messageKey, error.code, { payable: money("payable"), waiting: money("waiting") });
}

function EraseDialog({ page, customerKey, open, onOpenChange }: { readonly page: CustomerPage; readonly customerKey: string; readonly open: boolean; readonly onOpenChange: (open: boolean) => void }) {
  const admin = useStaff().role === "ADMIN";
  const erase = useEraseCustomer(customerKey);
  const [reason, setReason] = useState("");
  const id = useId();
  const owed = page.balance.payable > 0 || page.balance.waiting > 0;
  const blocked = owed && !admin;
  const blank = reason.trim() === "";
  const submit = (): void => erase.mutate(owed ? { force: true, reason: reason.trim() } : { force: false }, { onSuccess: () => onOpenChange(false) });
  return (
    <AlertDialog open={open} onOpenChange={(next) => (erase.isPending ? undefined : onOpenChange(next))}>
      <AlertDialogContent data-erase-dialog="">
        <AlertDialogHeader>
          <AlertDialogTitle>{adminText("erase_dialog_title", { code: page.customerCode ?? page.customerId })}</AlertDialogTitle>
          <AlertDialogDescription>{adminText("erase_dialog_body")}</AlertDialogDescription>
        </AlertDialogHeader>
        <p className="rounded-md bg-muted p-3 text-meta break-words text-muted-foreground">{adminText("erase_lead")}</p>
        {owed && (
          <p data-erase-owed role="alert" className="rounded-md bg-status-attention-soft p-3 text-sm break-words text-status-attention">
            {adminText("erase_owed", { payable: formatMoney(page.balance.payable) ?? "", waiting: formatMoney(page.balance.waiting) ?? "" })} {blocked && adminText("erase_owed_employee")}
          </p>
        )}
        {owed && admin && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-reason`}>{adminText("erase_reason")}</Label>
            <Textarea id={`${id}-reason`} value={reason} maxLength={500} required aria-describedby={`${id}-hint`} onChange={(event) => setReason(event.target.value)} />
            <p id={`${id}-hint`} className="text-meta text-muted-foreground">{adminText("erase_reason_hint")}</p>
          </div>
        )}
        {erase.isError && (
          <p role="alert" className="rounded-md bg-status-rejected-soft p-3 text-sm break-words text-status-rejected">
            {failureText(erase.error)}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel asChild>
            <Button type="button" variant="outline" className="h-11 md:h-9" disabled={erase.isPending}>
              {adminText("erase_keep")}
            </Button>
          </AlertDialogCancel>
          <Button type="button" className="h-11 bg-destructive text-destructive-foreground hover:bg-destructive/90 md:h-9" disabled={blocked || (owed && blank) || erase.isPending} aria-busy={erase.isPending} onClick={submit}>
            {erase.isPending ? adminText("erase_confirming") : adminText(owed ? "erase_force" : "erase_confirm")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function DangerItem({ title, lead, disabled = false, onClick }: { readonly title: string; readonly lead: string; readonly disabled?: boolean; readonly onClick: () => void }) {
  const id = useId();
  return (
    <button
      type="button"
      aria-label={title}
      aria-describedby={id}
      disabled={disabled}
      onClick={onClick}
      className="-mx-2 flex min-h-11 min-w-0 flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left outline-none hover:bg-destructive/5 focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent"
    >
      <span className="text-[15px] leading-snug font-semibold break-words text-foreground">{title}</span>
      <span id={id} className="text-meta break-words text-muted-foreground">{lead}</span>
    </button>
  );
}

/**
 * The danger zone (wireframe customer page): merging with another record (admin only, the merge
 * dialog) and erasing the personal data, each a row with what it is for.
 */
export function DangerZone({ page, customerKey }: { readonly page: CustomerPage; readonly customerKey: string }) {
  const [open, setOpen] = useState(false);
  const [merging, setMerging] = useState(false);
  const admin = useStaff().role === "ADMIN";
  const erased = page.status === "ERASED";
  const owed = page.balance.payable > 0;
  return (
    <section data-danger-zone aria-label={adminText("danger_title")} className="flex min-w-0 flex-col gap-2 rounded-xl border border-destructive/30 bg-card p-4 md:px-4 md:py-5">
      <h2 className="text-sm font-semibold text-destructive">{adminText("danger_title")}</h2>
      <div className="flex min-w-0 flex-col gap-1">
        {admin && !erased && <DangerItem title={adminText("danger_merge")} lead={adminText("danger_merge_lead")} onClick={() => setMerging(true)} />}
        <DangerItem
          title={adminText("erase_button")}
          lead={erased ? adminText("erased_actions_off") : owed ? adminText("danger_erase_lead", { amount: formatMoney(page.balance.payable) ?? "" }) : adminText("danger_erase_lead_free")}
          disabled={erased}
          onClick={() => setOpen(true)}
        />
      </div>
      {!erased && <EraseDialog page={page} customerKey={customerKey} open={open} onOpenChange={setOpen} />}
      {!erased && admin && merging && <MergeDialog open onOpenChange={setMerging} survivor={page.customerId} merged={null} />}
    </section>
  );
}
