/**
 * Staff sign-in on the admin host (Story 4.2, deferred to this shell): name and password, both
 * with visible labels, paste allowed, the password shown on request. A refused sign-in never says
 * which part was wrong; a name waiting out its delay says until when. The mascot keeps its live
 * job here: shy while the password is hidden, peeking when shown, waiting after an error.
 */
import { Button, EyeIcon, EyeOffIcon, Input, Label } from "@cashback/ui";
import { formatVnTimeOf } from "@cashback/core";
import { useState, type FormEvent } from "react";

import { ApiError } from "../api/api.queries";
import { adminText, errorText } from "../labels";
import { useSignIn } from "../session/session.queries";
import { BrandMark } from "../shell/brand-mark";

const MASCOT = (name: string): string => `${import.meta.env.BASE_URL}mascot-${name}.webp`;

export function signInError(error: unknown): string {
  if (!(error instanceof ApiError)) return errorText("error.network", "network");
  const time = formatVnTimeOf(error.fields["retryAt"]);
  if (error.code === "rate_limited" && time === null) return errorText("error.rate_limited", error.code);
  return errorText(error.messageKey, error.code, time === null ? undefined : { time });
}

/** The form; once the server accepts, the session query holds the staff member and the route moves on. */
export function SignInPage() {
  const signIn = useSignIn();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [shown, setShown] = useState(false);
  const [missing, setMissing] = useState(false);

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (username.trim() === "" || password === "") return setMissing(true);
    setMissing(false);
    signIn.mutate({ username: username.trim(), password });
  };
  const message = missing ? adminText("sign_in_required") : signIn.isError ? signInError(signIn.error) : null;
  const mascot = message !== null ? "waiting" : shown ? "peeking" : "shy";

  return (
    <main className="flex min-h-dvh items-start justify-center bg-background px-4 pt-[max(48px,env(safe-area-inset-top))] pb-12 md:items-center md:pt-12">
      <div className="w-full max-w-sm rounded-xl border border-border bg-card p-6">
        <div className="mb-5 flex items-center gap-2.5">
          <BrandMark className="size-[30px]" />
          <p className="text-[15px] font-semibold">{adminText("brand_name")}</p>
        </div>
        <img src={MASCOT(mascot)} alt="" width={96} height={96} className="mb-3 size-24 object-contain" data-mascot={mascot} />
        <h1 className="text-[22px] leading-tight font-bold">{adminText("sign_in_title")}</h1>
        <p className="mt-1 mb-5 text-meta text-muted-foreground">{adminText("sign_in_lead")}</p>
        <form noValidate onSubmit={submit} className="flex flex-col gap-4" aria-describedby={message === null ? undefined : "sign-in-error"}>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="username">{adminText("sign_in_username")}</Label>
            <Input id="username" name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} value={username} onChange={(e) => setUsername(e.target.value)} aria-invalid={message !== null} aria-describedby={message === null ? undefined : "sign-in-error"} className="h-11 text-base" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="password">{adminText("sign_in_password")}</Label>
            <div className="relative">
              <Input id="password" name="password" type={shown ? "text" : "password"} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} aria-invalid={message !== null} aria-describedby={message === null ? undefined : "sign-in-error"} className="h-11 pr-12 text-base" />
              <Button type="button" variant="ghost" className="absolute top-0 right-0 size-11" aria-pressed={shown} aria-label={adminText(shown ? "sign_in_hide_password" : "sign_in_show_password")} onClick={() => setShown((s) => !s)}>
                {shown ? <EyeOffIcon aria-hidden /> : <EyeIcon aria-hidden />}
              </Button>
            </div>
          </div>
          {message !== null && (
            <p id="sign-in-error" role="alert" className="text-sm font-medium text-destructive">
              {message}
            </p>
          )}
          <Button type="submit" className="h-11 w-full text-[15px]" disabled={signIn.isPending}>
            {adminText(signIn.isPending ? "sign_in_submitting" : "sign_in_submit")}
          </Button>
        </form>
      </div>
    </main>
  );
}
