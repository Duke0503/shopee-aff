/**
 * Changing the password on Account (FR-9, FR-10, INV-8; Story 7.5): closed behind one button, so
 * the bank account stays the page's main task. The current password and a new one of at least 8
 * characters that is not the customer code; both can be shown, paste is allowed. A rule broken is
 * said under its field, by the page first and the server again; a wrong current password counts
 * like a wrong sign-in, and a code waiting out its delay says until when. Other signed-in phones
 * are signed out; this one stays.
 */
import { MIN_CUSTOMER_PASSWORD } from "@cashback/contracts";
import { formatVnTimeOf } from "@cashback/core";
import { Button, cn, EyeIcon, EyeOffIcon, Input, KeyRoundIcon, Label } from "@cashback/ui";
import { useState, type FormEvent, type ReactNode } from "react";

import { ApiError } from "../api/api.queries";
import { formErrorOf, serverFieldErrors } from "../api/field-errors";
import { errorText, webText } from "../labels";
import { CommandHint } from "../shell/command-hint";
import { FIELD_ICON, ICON_FIELD } from "../shell/field-styles";
import { LockIcon } from "../shell/page-icons";
import { useChangePassword } from "./account.queries";

const FIELDS = ["currentPassword", "newPassword"] as const;
type Field = (typeof FIELDS)[number];
type Errors = Partial<Record<Field, string>>;

export function checkPasswords(current: string, next: string, customerCode: string): Errors {
  const errors: Errors = {};
  if (current === "") errors.currentPassword = webText("password_current_required");
  if (next.length < MIN_CUSTOMER_PASSWORD) errors.newPassword = errorText("error.password.too_short", "invalid_request");
  else if (next.trim().toUpperCase() === customerCode.toUpperCase()) errors.newPassword = errorText("error.password.is_code", "invalid_request");
  return errors;
}

function refusal(error: unknown): string | null {
  if (error instanceof ApiError && error.code === "rate_limited") {
    const time = formatVnTimeOf(error.fields["retryAt"]);
    return time === null ? errorText("error.rate_limited", error.code) : errorText(error.messageKey, error.code, { time });
  }
  return formErrorOf(error, FIELDS);
}

interface SecretProps {
  readonly id: Field;
  readonly label: string;
  readonly autoComplete: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly error: string | undefined;
  readonly shown: boolean;
  readonly onShown: () => void;
  readonly hint?: ReactNode;
}

function SecretField({ id, label, autoComplete, value, onChange, error, shown, onShown, hint }: SecretProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id} className="text-[15px] font-semibold">
        {label}
      </Label>
      <div className="relative">
        <LockIcon aria-hidden className={FIELD_ICON} />
        <Input id={id} type={shown ? "text" : "password"} autoComplete={autoComplete} value={value} onChange={(e) => onChange(e.target.value)} aria-invalid={error !== undefined} aria-describedby={error === undefined ? undefined : `${id}-error`} className={cn(ICON_FIELD, "pr-12")} />
        <Button type="button" variant="ghost" className="absolute top-0.5 right-0.5 size-11 text-muted-foreground" aria-pressed={shown} aria-label={webText(shown ? "sign_in_hide_password" : "sign_in_show_password")} onClick={onShown}>
          {shown ? <EyeOffIcon aria-hidden className="size-5" /> : <EyeIcon aria-hidden className="size-5" />}
        </Button>
      </div>
      {error !== undefined && (
        <p id={`${id}-error`} className="text-meta font-medium text-destructive">
          {error}
        </p>
      )}
      {hint}
    </div>
  );
}

function PasswordFields({ customerCode, onDone }: { readonly customerCode: string; readonly onDone: () => void }) {
  const change = useChangePassword();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [shown, setShown] = useState(false);
  const [local, setLocal] = useState<Errors>({});
  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const errors = checkPasswords(current, next, customerCode);
    setLocal(errors);
    if (Object.keys(errors).length === 0) change.mutate({ currentPassword: current, newPassword: next }, { onSuccess: onDone });
  };
  const errors: Errors = { ...(change.isError ? serverFieldErrors(change.error, FIELDS) : {}), ...local };
  const formError = Object.keys(local).length === 0 && change.isError ? refusal(change.error) : null;
  const toggle = (): void => setShown((s) => !s);
  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-5" data-password-form>
      <SecretField
        id="currentPassword"
        label={webText("password_current")}
        autoComplete="current-password"
        value={current}
        onChange={setCurrent}
        error={errors.currentPassword}
        shown={shown}
        onShown={toggle}
        hint={<CommandHint template={webText("password_current_hint")} command={webText("command_password")} />}
      />
      <SecretField id="newPassword" label={webText("password_new")} autoComplete="new-password" value={next} onChange={setNext} error={errors.newPassword} shown={shown} onShown={toggle} />
      {formError !== null && (
        <p role="alert" className="rounded-lg bg-destructive/8 px-3 py-2.5 text-[15px] font-medium text-destructive">
          {formError}
        </p>
      )}
      <Button type="submit" className="h-12 w-full rounded-xl text-base font-semibold" disabled={change.isPending}>
        {webText(change.isPending ? "password_submitting" : "password_submit")}
      </Button>
    </form>
  );
}

export function PasswordSection({ customerCode }: { readonly customerCode: string }) {
  const [open, setOpen] = useState(false);
  const [changed, setChanged] = useState(false);
  return (
    <section aria-labelledby="password-title" className="flex flex-col gap-3 border-t border-border pt-6">
      <div className="flex flex-col gap-1">
        <h2 id="password-title" className="text-[17px] leading-snug font-semibold">
          {webText("password_title")}
        </h2>
        <p className="text-meta text-muted-foreground md:text-sm">{webText("password_lead")}</p>
      </div>
      {changed && (
        <p role="status" data-password-done className="rounded-lg bg-primary/8 px-3 py-2.5 text-[15px] font-medium text-primary">
          {webText("password_changed")}
        </p>
      )}
      {open ? (
        <PasswordFields
          customerCode={customerCode}
          onDone={() => {
            setOpen(false);
            setChanged(true);
          }}
        />
      ) : (
        <Button type="button" variant="outline" className="h-11 w-fit rounded-lg bg-card px-4 text-[15px] font-semibold" onClick={() => setOpen(true)}>
          <KeyRoundIcon aria-hidden />
          {webText("password_open")}
        </Button>
      )}
    </section>
  );
}
