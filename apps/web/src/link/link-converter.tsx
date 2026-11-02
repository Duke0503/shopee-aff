/**
 * The link converter on Home (W1, pen.dev DPZAp, BEOJK, EXPERIENCE.md link converter, FR-2, FR-3,
 * UJ-4; Story 7.6): one tall link field with the paste button inside, the full-width submit button
 * with its arrow, and one quiet line under it. Signed in, the line says the link carries the
 * customer's own code. Signed out, the "enter DP code" link (home_code_toggle) opens the optional code field: an unknown code is
 * said under it (error.web_link.customer_unknown), never a guest link; without a code the result
 * is a guest link with its warning. Lazada is named as not supported on that line; a Lazada link
 * gets the server's polite refusal under the field.
 *
 * Once a link is sent the page narrows to that one task (pen.dev KF7d9, R0mtJ): the link as a
 * one-line box (press it to send another), then the creating state, the result, the busy hand-off
 * or, for an unknown code, the code field again. The answer scrolls into view once on phone.
 */
import { CUSTOMER_CODE_INPUT, type WebLinkQueued } from "@cashback/contracts";
import { Button, cn, CodeChip } from "@cashback/ui";
import { lazy, Suspense, useEffect, useRef, useState, type FormEvent } from "react";

import { ApiError } from "../api/api.queries";
import { errorText, webText } from "../labels";
import { FOCUS_RING } from "../shell/nav-items";
import { ArrowRightIcon } from "../shell/site-icons";
import { UrlField, UrlSummary } from "./link-fields";
import { LINK_SLOW_AFTER_MS, useLinkResult, useQueueLink } from "./link.queries";

// What follows a sent link loads with the first send, not with Home (Story 7.1 AC3 first-load budget).
const CodeField = lazy(() => import("./code-field").then((m) => ({ default: m.CodeField })));
const Creating = lazy(() => import("./link-result").then((m) => ({ default: m.Creating })));
const HandOff = lazy(() => import("./link-result").then((m) => ({ default: m.HandOff })));
const LinkResult = lazy(() => import("./link-result").then((m) => ({ default: m.LinkResult })));

type Errors = { url?: string; customerCode?: string };

function checkFields(url: string, code: string): Errors {
  const errors: Errors = {};
  if (url.trim() === "") errors.url = webText("link_url_required");
  if (code.trim() !== "" && !CUSTOMER_CODE_INPUT.test(code)) errors.customerCode = errorText("error.customer_code_format", "invalid_request");
  return errors;
}

/** A refusal said under its field: an unknown code under the code, anything about the link under the link. */
function refusalErrors(error: unknown): Errors {
  if (!(error instanceof ApiError)) return { url: errorText("error.network", "network") };
  if (error.code === "rate_limited") return {};
  const codeKey = error.fields["customerCode"];
  if (codeKey !== undefined) return { customerCode: errorText(codeKey, error.code) };
  return { url: errorText(error.messageKey, error.code) };
}

const isBusy = (error: unknown): boolean => error instanceof ApiError && error.code === "rate_limited";

function useSlow(ticket: string | null): boolean {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    setSlow(false);
    if (ticket === null) return;
    const timer = setTimeout(() => setSlow(true), LINK_SLOW_AFTER_MS);
    return () => clearTimeout(timer);
  }, [ticket]);
  return slow;
}

function Result({ queued }: { readonly queued: WebLinkQueued }) {
  const result = useLinkResult(queued.ticket);
  const slow = useSlow(queued.ticket);
  const data = result.data;
  if (data?.state === "failed" || (data === undefined && result.isError)) return <HandOff titleKey="link_failed_title" textKey="link_failed" />;
  if (data === undefined || data.state === "creating") return <Creating slow={slow} guest={queued.guest} />;
  return <LinkResult result={data} />;
}

function SubmitButton({ pending }: { readonly pending: boolean }) {
  return (
    <Button type="submit" className="h-12 w-full rounded-xl text-base font-semibold" disabled={pending}>
      {webText("link_submit")}
      <ArrowRightIcon aria-hidden className="size-5" />
    </Button>
  );
}

const TOGGLE = cn("relative font-semibold text-primary underline-offset-4 after:absolute after:inset-x-0 after:-top-3.5 after:-bottom-3.5 after:content-[''] hover:underline", FOCUS_RING);

function FormLine({ customerCode, codeOpen, onOpenCode }: { readonly customerCode: string | null; readonly codeOpen: boolean; readonly onOpenCode: () => void }) {
  const hint = (
    <span id="link-url-hint" className="whitespace-nowrap">
      {webText("link_url_hint")}
    </span>
  );
  if (customerCode !== null) {
    return (
      <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-meta text-muted-foreground" data-link-own-code>
        {webText("link_for_code")}
        <CodeChip code={customerCode} />
        <span aria-hidden>{"·"}</span>
        {hint}
      </p>
    );
  }
  return (
    <p className="text-meta text-muted-foreground">
      {!codeOpen && (
        <>
          {webText("home_code_prompt")}{" "}
          <button type="button" className={TOGGLE} onClick={onOpenCode} aria-expanded={false} aria-controls="link-code">
            {webText("home_code_toggle")}
          </button>{" "}
          <span aria-hidden>{"·"}</span>{" "}
        </>
      )}
      {hint}
    </p>
  );
}

export function LinkConverter({ customerCode, onFocusChange }: { readonly customerCode: string | null; readonly onFocusChange?: (focused: boolean) => void }) {
  const queue = useQueueLink();
  const [url, setUrl] = useState("");
  const [code, setCode] = useState("");
  const [codeOpen, setCodeOpen] = useState(false);
  const [local, setLocal] = useState<Errors>({});
  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const errors = checkFields(url, customerCode === null ? code : "");
    setLocal(errors);
    if (Object.keys(errors).length > 0) return;
    queue.mutate({ url: url.trim(), ...(customerCode === null && code.trim() !== "" ? { customerCode: code.trim() } : {}) });
  };
  const errors: Errors = { ...(queue.isError ? refusalErrors(queue.error) : {}), ...local };
  const busy = queue.isError && isBusy(queue.error);
  const codeRefused = queue.isError && errors.customerCode !== undefined;
  const focused = queue.isPending || queue.isSuccess || busy || codeRefused;
  useEffect(() => onFocusChange?.(focused), [focused, onFocusChange]);
  // On a phone the answer appears below the fold: it is brought into view once, when it starts.
  const answer = useRef<HTMLDivElement>(null);
  const shown = queue.isSuccess ? queue.data.ticket : busy ? "busy" : null;
  useEffect(() => {
    if (shown !== null) answer.current?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  }, [shown]);
  const showCode = customerCode === null && (codeOpen || code !== "" || errors.customerCode !== undefined);

  if (focused && !codeRefused) {
    return (
      <div className="flex flex-col gap-5">
        <UrlSummary url={url.trim()} onChange={() => queue.reset()} />
        <div ref={answer} className="scroll-mb-24">
          <Suspense fallback={<div aria-busy="true" className="h-40" />}>
          {queue.isPending && <Creating slow={false} guest={customerCode === null && code.trim() === ""} />}
          {busy && <HandOff titleKey="link_busy_title" textKey="link_busy" />}
          {queue.isSuccess && <Result key={queue.data.ticket} queued={queue.data} />}
          </Suspense>
        </div>
      </div>
    );
  }
  return (
    <form noValidate onSubmit={submit} data-link-form className="flex flex-col gap-3">
      {codeRefused ? <UrlSummary url={url.trim()} onChange={() => queue.reset()} /> : <UrlField value={url} onChange={setUrl} error={errors.url} />}
      {showCode && (
        <Suspense fallback={<div className="h-28" />}>
          <CodeField value={code} onChange={setCode} error={errors.customerCode} />
        </Suspense>
      )}
      <SubmitButton pending={queue.isPending} />
      <FormLine customerCode={customerCode} codeOpen={showCode} onOpenCode={() => setCodeOpen(true)} />
    </form>
  );
}
