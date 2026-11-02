/**
 * W2 sign-in form (Story 7.2): the customer code and the password from /matkhau, both with
 * visible labels and a hint naming the chat command as a copyable chip; paste is allowed and the
 * password can be shown. A missing or malformed field is said under that field; a refusal never
 * says which part was wrong and is tied to both fields; a code waiting out its delay says when it
 * may try again (AC6). The mascot keeps its live job: shy while the password is hidden, peeking
 * when shown, waiting after an error.
 */
import { CUSTOMER_CODE_INPUT } from "@cashback/contracts";
import { formatVnTimeOf } from "@cashback/core";
import { Button, cn, EyeIcon, EyeOffIcon, Input, Label } from "@cashback/ui";
import { useEffect, useState, type FormEvent } from "react";

import { ApiError } from "../api/api.queries";
import { errorText, webText } from "../labels";
import { useSignIn } from "../session/session.queries";
import { CommandHint } from "../shell/command-hint";
import { FIELD_ICON, ICON_FIELD } from "../shell/field-styles";
import { LockIcon } from "../shell/page-icons";
import { CircleAlertIcon, UserIcon } from "../shell/site-icons";

type Field = "customerCode" | "password";
export type FieldErrors = Partial<Record<Field, string>>;

/** The form-level line for a refused sign-in, or null when the server tied its answer to fields. */
export function signInError(error: unknown): string | null {
  if (!(error instanceof ApiError)) return errorText("error.network", "network");
  if (error.fields["customerCode"] !== undefined || error.fields["password"] !== undefined) return null;
  const time = formatVnTimeOf(error.fields["retryAt"] ?? null);
  if (error.code === "rate_limited") return time === null ? errorText("error.rate_limited", error.code) : errorText(error.messageKey, error.code, { time });
  return errorText(error.messageKey, error.code);
}

function retryTime(error: unknown): string | null {
  return error instanceof ApiError && error.code === "rate_limited" ? formatVnTimeOf(error.fields["retryAt"]) : null;
}

export function checkFields(customerCode: string, password: string): FieldErrors {
  const errors: FieldErrors = {};
  if (customerCode.trim() === "") errors.customerCode = webText("sign_in_code_required");
  else if (!CUSTOMER_CODE_INPUT.test(customerCode)) errors.customerCode = errorText("error.customer_code_format", "invalid_request");
  if (password === "") errors.password = errorText("error.password_required", "invalid_request");
  return errors;
}

const serverFieldErrors = (error: unknown): FieldErrors => {
  if (!(error instanceof ApiError)) return {};
  const out: FieldErrors = {};
  for (const field of ["customerCode", "password"] as const) {
    const key = error.fields[field];
    if (key !== undefined) out[field] = errorText(key, error.code);
  }
  return out;
};

const describedBy = (...ids: (string | false)[]): string => ids.filter((id): id is string => id !== false).join(" ");

interface FieldProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly error: string | undefined;
  /** True while a refusal tied to both fields shows under the form. */
  readonly refused: boolean;
}

function CodeField({ value, onChange, error, refused }: FieldProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="customer-code" className="text-[15px] font-semibold">
        {webText("sign_in_code")}
      </Label>
      <div className="relative">
        <UserIcon aria-hidden className={FIELD_ICON} />
        <Input
          id="customer-code"
          name="username"
          autoComplete="username"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={error !== undefined || refused}
          aria-describedby={describedBy(error !== undefined && "customer-code-error", refused && "sign-in-error", "customer-code-hint")}
          className={cn(ICON_FIELD, "font-medium tracking-wide uppercase")}
        />
      </div>
      {error !== undefined && (
        <p id="customer-code-error" className="text-meta font-medium text-destructive">
          {error}
        </p>
      )}
      <CommandHint id="customer-code-hint" template={webText("sign_in_code_hint")} command={webText("command_id")} />
    </div>
  );
}

function PasswordField({ value, onChange, error, refused, shown, onShown }: FieldProps & { readonly shown: boolean; readonly onShown: () => void }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="password" className="text-[15px] font-semibold">
        {webText("sign_in_password")}
      </Label>
      <div className="relative">
        <LockIcon aria-hidden className={FIELD_ICON} />
        <Input
          id="password"
          name="password"
          type={shown ? "text" : "password"}
          autoComplete="current-password"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={error !== undefined || refused}
          aria-describedby={describedBy(error !== undefined && "password-error", refused && "sign-in-error", "password-hint")}
          className={cn(ICON_FIELD, "pr-12")}
        />
        <Button type="button" variant="ghost" className="absolute top-0.5 right-0.5 size-11 text-muted-foreground" aria-pressed={shown} aria-label={webText(shown ? "sign_in_hide_password" : "sign_in_show_password")} onClick={onShown}>
          {shown ? <EyeIcon aria-hidden className="size-5" /> : <EyeOffIcon aria-hidden className="size-5" />}
        </Button>
      </div>
      {error !== undefined && (
        <p id="password-error" className="text-meta font-medium text-destructive">
          {error}
        </p>
      )}
      <CommandHint id="password-hint" template={webText("sign_in_password_hint")} command={webText("command_password")} />
    </div>
  );
}

export type Mascot = "shy" | "peeking" | "waiting";

export function SignInForm({ onMascot }: { readonly onMascot?: (name: Mascot) => void }) {
  const signIn = useSignIn();
  const [customerCode, setCustomerCode] = useState("");
  const [password, setPassword] = useState("");
  const [shown, setShown] = useState(false);
  const [local, setLocal] = useState<FieldErrors>({});

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const errors = checkFields(customerCode, password);
    setLocal(errors);
    if (Object.keys(errors).length > 0) return;
    signIn.mutate({ customerCode: customerCode.trim(), password });
  };
  const fields: FieldErrors = { ...(signIn.isError ? serverFieldErrors(signIn.error) : {}), ...local };
  const formError = Object.keys(local).length === 0 && signIn.isError ? signInError(signIn.error) : null;
  const mascot: Mascot = formError !== null || Object.keys(fields).length > 0 ? "waiting" : shown ? "peeking" : "shy";
  useEffect(() => onMascot?.(mascot), [mascot, onMascot]);

  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-4" data-waiting={signIn.isError ? (retryTime(signIn.error) ?? undefined) : undefined}>
      <CodeField value={customerCode} onChange={setCustomerCode} error={fields.customerCode} refused={formError !== null} />
      <PasswordField value={password} onChange={setPassword} error={fields.password} refused={formError !== null} shown={shown} onShown={() => setShown((s) => !s)} />
      {formError !== null && (
        <p id="sign-in-error" role="alert" className="flex items-start gap-2.5 rounded-xl bg-status-rejected-soft px-4 py-3 text-[15px] text-destructive">
          <CircleAlertIcon aria-hidden className="mt-0.5 size-5 shrink-0" />
          {formError}
        </p>
      )}
      <Button type="submit" className="mt-1 h-12 w-full rounded-xl text-base font-semibold" disabled={signIn.isPending}>
        {webText(signIn.isPending ? "sign_in_submitting" : "sign_in_submit")}
      </Button>
    </form>
  );
}
