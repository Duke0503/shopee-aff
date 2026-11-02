/**
 * The bank form (W2 Account, UX-DR9, EXPERIENCE.md bank account form, FR-10; Story 7.5): the bank
 * from the VietQR picker, the account number with spaces and dashes removed as typed (4 to 30
 * letters and digits), the holder upper-cased when the field is left, and the consent box with its
 * purpose, required. The note says before saving that the account waits for a confirmation in
 * Zalo. Each broken rule is said under its field, by the page first and by the server again.
 */
import { BANK_HOLDER_INPUT_MAX, BANK_NUMBER_INPUT_MAX, type BankAccountSaved, type BankChoice } from "@cashback/contracts";
import { Button, CheckIcon, cn, Input, Label } from "@cashback/ui";
import { useState, type FormEvent } from "react";

import { formErrorOf, serverFieldErrors } from "../api/field-errors";
import { errorText, webText } from "../labels";
import { useSaveBank } from "./account.queries";
import { BankPicker } from "./bank-picker";

const FIELDS = ["bankBin", "accountNumber", "holderName", "consent"] as const;
type Field = (typeof FIELDS)[number];
type Errors = Partial<Record<Field, string>>;

/** The number as it is stored: no spaces or dashes, letters upper case. */
export const normaliseNumber = (typed: string): string => typed.replace(/[\s-]/g, "").toUpperCase();
const NUMBER_RULE = /^[A-Z0-9]{4,30}$/;

function checkForm(bank: BankChoice | null, number: string, holder: string, consent: boolean): Errors {
  const errors: Errors = {};
  if (bank === null) errors.bankBin = webText("bank_bank_required");
  if (number === "") errors.accountNumber = webText("bank_number_required");
  else if (!NUMBER_RULE.test(number)) errors.accountNumber = errorText("error.bank.number_rule", "invalid_request");
  if (holder.trim() === "") errors.holderName = webText("bank_holder_required");
  if (!consent) errors.consent = errorText("error.bank.consent_required", "invalid_request");
  return errors;
}

function FieldError({ id, text }: { readonly id: string; readonly text: string | undefined }) {
  if (text === undefined) return null;
  return (
    <p id={id} className="text-meta font-medium text-destructive">
      {text}
    </p>
  );
}

interface TextFieldProps {
  readonly id: string;
  readonly label: string;
  readonly hint: string;
  readonly value: string;
  readonly error: string | undefined;
  readonly onChange: (value: string) => void;
  readonly onBlur?: () => void;
  readonly maxLength: number;
  readonly mono?: boolean;
}

function TextField({ id, label, hint, value, error, onChange, onBlur, maxLength, mono = false }: TextFieldProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id} className="text-[15px]">
        {label}
      </Label>
      <Input
        id={id}
        value={value}
        maxLength={maxLength}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="characters"
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        aria-invalid={error !== undefined}
        aria-describedby={`${error === undefined ? "" : `${id}-error `}${id}-hint`}
        className={`h-11 text-base md:text-base ${mono ? "font-mono tracking-wide" : ""}`}
      />
      <FieldError id={`${id}-error`} text={error} />
      <p id={`${id}-hint`} className={error === undefined ? "text-meta text-muted-foreground" : "sr-only"}>
        {hint}
      </p>
    </div>
  );
}

function ConsentBox({ checked, onChange, error }: { readonly checked: boolean; readonly onChange: (checked: boolean) => void; readonly error: string | undefined }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor="bank-consent" className="flex min-h-11 cursor-pointer items-start gap-1 text-[15px]">
        {/* The real box is 44 px and transparent over the drawn 20 px one, so the tap target meets the rule. */}
        <span className="relative -mt-2.5 -ml-3 flex size-11 shrink-0 items-center justify-center">
          <input
            id="bank-consent"
            type="checkbox"
            checked={checked}
            onChange={(e) => onChange(e.target.checked)}
            aria-invalid={error !== undefined}
            aria-describedby={error === undefined ? undefined : "bank-consent-error"}
            className="peer absolute inset-0 size-11 cursor-pointer opacity-0"
          />
          <span aria-hidden className={cn("flex size-5 items-center justify-center rounded-[5px] border-2 peer-focus-visible:ring-3 peer-focus-visible:ring-ring/50", checked ? "border-primary bg-primary text-primary-foreground" : error !== undefined ? "border-destructive bg-card" : "border-input bg-card")}>
            {checked && <CheckIcon className="size-3.5" strokeWidth={3} />}
          </span>
        </span>
        <span>{webText("bank_consent")}</span>
      </label>
      <FieldError id="bank-consent-error" text={error} />
    </div>
  );
}

export function BankForm({ onSaved, onCancel }: { readonly onSaved: (saved: BankAccountSaved) => void; readonly onCancel?: () => void }) {
  const save = useSaveBank();
  const [bank, setBank] = useState<BankChoice | null>(null);
  const [number, setNumber] = useState("");
  const [holder, setHolder] = useState("");
  const [consent, setConsent] = useState(false);
  const [local, setLocal] = useState<Errors>({});

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const errors = checkForm(bank, number, holder, consent);
    setLocal(errors);
    if (Object.keys(errors).length > 0 || bank === null) return;
    save.mutate({ bankBin: bank.bin, accountNumber: number, holderName: holder.trim().toUpperCase(), consent }, { onSuccess: onSaved });
  };
  const errors: Errors = { ...(save.isError ? serverFieldErrors(save.error, FIELDS) : {}), ...local };
  const formError = Object.keys(local).length === 0 && save.isError ? formErrorOf(save.error, FIELDS) : null;

  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-5" data-bank-form>
      <BankPicker value={bank} onChange={setBank} error={errors.bankBin} />
      <TextField id="bank-number" label={webText("bank_field_number")} hint={webText("bank_number_hint")} value={number} error={errors.accountNumber} onChange={(v) => setNumber(normaliseNumber(v))} maxLength={BANK_NUMBER_INPUT_MAX} mono />
      <TextField id="bank-holder" label={webText("bank_field_holder")} hint={webText("bank_holder_hint")} value={holder} error={errors.holderName} onChange={setHolder} onBlur={() => setHolder((h) => h.trim().replace(/\s+/g, " ").toUpperCase())} maxLength={BANK_HOLDER_INPUT_MAX} />
      <ConsentBox checked={consent} onChange={setConsent} error={errors.consent} />
      <p className="rounded-lg bg-muted px-3 py-2.5 text-meta">{webText("bank_save_note")}</p>
      {formError !== null && (
        <p role="alert" className="rounded-lg bg-destructive/8 px-3 py-2.5 text-[15px] font-medium text-destructive">
          {formError}
        </p>
      )}
      <div className="flex flex-col gap-2 md:flex-row">
        <Button type="submit" className="h-11 w-full text-[15px] md:w-fit md:px-6" disabled={save.isPending}>
          {webText(save.isPending ? "bank_saving" : "bank_save")}
        </Button>
        {onCancel !== undefined && (
          <Button type="button" variant="ghost" className="h-11 w-full text-[15px] md:w-fit" onClick={onCancel}>
            {webText("bank_cancel")}
          </Button>
        )}
      </div>
    </form>
  );
}
