/**
 * The bank account on Account (W2, UX-DR9, FR-10, M-7; Story 7.5): the saved account (bank, the
 * last four digits only, holder) with "change" and "erase"; while a website change waits for the
 * customer's confirmation in the Zalo private chat, the attention box ("waiting for your
 * confirmation on Zalo", bank_held) with the confirm command as a copy chip and the Zalo button; without an account, the form
 * itself. A save says the last four digits it saved; erase asks once (AlertDialog).
 */
import type { BankAccountSaved, MyMoney } from "@cashback/contracts";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  LandmarkIcon,
  Trash2Icon,
} from "@cashback/ui";
import { useState } from "react";

import { formErrorOf } from "../api/field-errors";
import { webText } from "../labels";
import { CommandHint } from "../shell/command-hint";
import { ZaloButton } from "../shell/zalo-button";
import { useEraseBank } from "./account.queries";
import { BankForm } from "./bank-form";

type Bank = NonNullable<MyMoney["bank"]>;

function EraseDialog({ bank, open, onOpenChange, onErased }: { readonly bank: Bank; readonly open: boolean; readonly onOpenChange: (open: boolean) => void; readonly onErased: () => void }) {
  const erase = useEraseBank();
  const failed = erase.isError ? formErrorOf(erase.error, []) : null;
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="w-[calc(100%-2rem)] max-w-[480px]">
        <AlertDialogHeader>
          <AlertDialogTitle>{webText("bank_erase_title", { bank: bank.bankName ?? webText("bank_unnamed"), lastFour: bank.lastFour })}</AlertDialogTitle>
          <AlertDialogDescription className="text-[15px]">{webText("bank_erase_body")}</AlertDialogDescription>
        </AlertDialogHeader>
        {failed !== null && (
          <p role="alert" className="text-[15px] font-medium text-destructive">
            {failed}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel className="h-11 text-[15px]">{webText("bank_erase_keep")}</AlertDialogCancel>
          <Button type="button" variant="destructive" className="h-11 text-[15px]" disabled={erase.isPending} onClick={() => erase.mutate(undefined, { onSuccess: onErased })}>
            {webText("bank_erase_confirm")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function HeldBox({ lastFour }: { readonly lastFour: string }) {
  return (
    <div data-bank-held className="flex flex-col gap-3 rounded-lg bg-status-attention-soft p-3 text-status-attention">
      <p className="text-[15px] font-semibold">{webText("bank_held")}</p>
      <CommandHint className="text-[15px] text-foreground" template={webText("bank_held_body")} command={webText("command_bank_confirm", { lastFour })} />
      <ZaloButton labelKey="account_zalo" className="w-full md:w-fit" />
    </div>
  );
}

function SavedBank({ bank, onChange, onErase }: { readonly bank: Bank; readonly onChange: () => void; readonly onErase: () => void }) {
  return (
    <div className="flex flex-col gap-4" data-bank={bank.held ? "held" : "saved"}>
      <div className="flex items-start gap-3">
        <span aria-hidden className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-primary">
          <LandmarkIcon className="size-5" />
        </span>
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="flex flex-wrap items-baseline gap-x-2 text-[17px] font-semibold">
            <span className="min-w-0 break-words">{bank.bankName ?? webText("bank_unnamed")}</span>
            <span className="font-mono whitespace-nowrap tabular-nums">{webText("bank_masked", { lastFour: bank.lastFour })}</span>
          </p>
          {bank.holderName !== null && <p className="truncate text-[15px] text-muted-foreground">{bank.holderName}</p>}
        </div>
      </div>
      {bank.held && <HeldBox lastFour={bank.lastFour} />}
      <div className="flex gap-2">
        <Button type="button" variant="outline" className="h-11 flex-1 text-[15px] md:flex-none md:px-5" onClick={onChange}>
          {webText("account_bank_change")}
        </Button>
        <Button type="button" variant="ghost" className="h-11 px-4 text-[15px] text-destructive hover:text-destructive" onClick={onErase}>
          <Trash2Icon aria-hidden />
          {webText("account_bank_erase")}
        </Button>
      </div>
    </div>
  );
}

function savedText(saved: BankAccountSaved): string {
  return webText(saved.result === "unchanged" ? "account_bank_unchanged" : "account_bank_saved", { lastFour: saved.bank.lastFour });
}

export function BankSection({ bank }: { readonly bank: MyMoney["bank"] }) {
  const [editing, setEditing] = useState(false);
  const [erasing, setErasing] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const showForm = bank === null || editing;
  const title = bank === null ? "account_bank_add_title" : editing ? "account_bank_change_title" : "account_bank_title";
  return (
    <section aria-labelledby="bank-section-title" className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4 md:p-6">
      <div className="flex flex-col gap-1">
        <h2 id="bank-section-title" className="text-[19px] leading-snug font-semibold">
          {webText(title)}
        </h2>
        <p className="text-[15px] text-muted-foreground">{webText("account_bank_lead")}</p>
      </div>
      {done !== null && (
        <p role="status" data-bank-done className="rounded-lg bg-primary/8 px-3 py-2.5 text-[15px] font-medium text-primary">
          {done}
        </p>
      )}
      {showForm ? (
        <BankForm
          onSaved={(saved) => {
            setDone(savedText(saved));
            setEditing(false);
          }}
          {...(bank === null ? {} : { onCancel: () => setEditing(false) })}
        />
      ) : (
        <SavedBank
          bank={bank}
          onChange={() => {
            setDone(null);
            setEditing(true);
          }}
          onErase={() => setErasing(true)}
        />
      )}
      {bank !== null && (
        <EraseDialog
          bank={bank}
          open={erasing}
          onOpenChange={setErasing}
          onErased={() => {
            setErasing(false);
            setEditing(false);
            setDone(webText("account_bank_erased"));
          }}
        />
      )}
    </section>
  );
}
