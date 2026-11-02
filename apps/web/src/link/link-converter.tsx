/**
 * The link converter on Home (W1, EXPERIENCE.md link converter, FR-2, FR-3, UJ-4; Story 7.6): one
 * URL field with a paste button where the browser allows it, and the submit button (link_submit).
 * Signed in, the link carries the customer's own code (said under the field). Signed out, an
 * optional code field: an unknown code is said under it (error.web_link.customer_unknown), never
 * a guest link; without a code the result is a guest link with its warning. The supported
 * networks are named under the URL field; a Lazada link gets the server's polite refusal there.
 * Website busy is the Zalo hand-off panel in place of the result, with no retry button.
 */
import { CUSTOMER_CODE_INPUT, WEB_LINK_URL_MAX, type WebLinkQueued } from "@cashback/contracts";
import { Button, ClipboardPasteIcon, CodeChip, Input, Label } from "@cashback/ui";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { ApiError } from "../api/api.queries";
import { errorText, webText } from "../labels";
import { CommandHint } from "../shell/command-hint";
import { Creating, HandOff, LinkResult } from "./link-result";
import { LINK_SLOW_AFTER_MS, useLinkResult, useQueueLink } from "./link.queries";

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
const canPaste = (): boolean => typeof navigator !== "undefined" && typeof navigator.clipboard?.readText === "function";

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
  if (data?.state === "failed" || (data === undefined && result.isError)) return <HandOff textKey="link_failed" />;
  if (data === undefined || data.state === "creating") return <Creating slow={slow} guest={queued.guest} />;
  return <LinkResult result={data} />;
}

function UrlField({ value, onChange, error }: { readonly value: string; readonly onChange: (v: string) => void; readonly error: string | undefined }) {
  const paste = async (): Promise<void> => {
    try {
      onChange((await navigator.clipboard.readText()).trim());
    } catch {
      // The browser refused the clipboard; the customer pastes by hand.
    }
  };
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="link-url" className="text-[15px]">
        {webText("link_url_label")}
      </Label>
      <div className="flex gap-2">
        <Input id="link-url" type="url" inputMode="url" autoComplete="off" maxLength={WEB_LINK_URL_MAX} value={value} onChange={(e) => onChange(e.target.value)} aria-invalid={error !== undefined} aria-describedby={`${error === undefined ? "" : "link-url-error "}link-url-hint`} className="h-11 min-w-0 flex-1 text-base md:text-base" />
        {canPaste() && (
          <Button type="button" variant="outline" className="h-11 shrink-0 px-3 text-[15px]" onClick={() => void paste()}>
            <ClipboardPasteIcon aria-hidden />
            {webText("link_paste")}
          </Button>
        )}
      </div>
      {error !== undefined && (
        <p id="link-url-error" role="alert" className="text-meta font-medium text-destructive">
          {error}
        </p>
      )}
      <p id="link-url-hint" className="text-meta text-muted-foreground">
        {webText("link_url_hint")}
      </p>
    </div>
  );
}

function CodeField({ value, onChange, error }: { readonly value: string; readonly onChange: (v: string) => void; readonly error: string | undefined }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="link-code" className="text-[15px]">
        {webText("link_code_label")}
      </Label>
      <Input id="link-code" autoComplete="off" autoCapitalize="characters" autoCorrect="off" spellCheck={false} maxLength={32} value={value} onChange={(e) => onChange(e.target.value)} aria-invalid={error !== undefined} aria-describedby={`${error === undefined ? "" : "link-code-error "}link-code-hint`} className="h-11 font-mono text-base tracking-wide uppercase md:w-56 md:text-base" />
      {error !== undefined && (
        <p id="link-code-error" role="alert" className="text-meta font-medium text-destructive">
          {error}
        </p>
      )}
      <CommandHint id="link-code-hint" template={webText("link_code_hint")} command={webText("command_id")} />
    </div>
  );
}

export function LinkConverter({ customerCode }: { readonly customerCode: string | null }) {
  const queue = useQueueLink();
  const [url, setUrl] = useState("");
  const [code, setCode] = useState("");
  const [local, setLocal] = useState<Errors>({});
  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const errors = checkFields(url, customerCode === null ? code : "");
    setLocal(errors);
    if (Object.keys(errors).length > 0) return;
    queue.mutate({ url: url.trim(), ...(customerCode === null && code.trim() !== "" ? { customerCode: code.trim() } : {}) });
  };
  const errors: Errors = { ...(queue.isError ? refusalErrors(queue.error) : {}), ...local };
  // On a phone the answer appears below the fold: it is brought into view once, when it starts.
  const answer = useRef<HTMLDivElement>(null);
  const shown = queue.isSuccess ? queue.data.ticket : queue.isError && isBusy(queue.error) ? "busy" : null;
  useEffect(() => {
    if (shown !== null) answer.current?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  }, [shown]);
  return (
    <div className="flex flex-col gap-4">
      <form noValidate onSubmit={submit} data-link-form className="flex flex-col gap-4">
        <UrlField value={url} onChange={setUrl} error={errors.url} />
        {customerCode === null ? (
          <CodeField value={code} onChange={setCode} error={errors.customerCode} />
        ) : (
          <p className="flex flex-wrap items-center gap-2 text-[15px] text-muted-foreground" data-link-own-code>
            {webText("link_for_code")}
            <CodeChip code={customerCode} />
          </p>
        )}
        <Button type="submit" className="h-11 w-full text-[15px] md:w-fit md:px-6" disabled={queue.isPending}>
          {webText(queue.isPending ? "link_creating" : "link_submit")}
        </Button>
      </form>
      <div ref={answer} className="scroll-mb-24 empty:hidden">
        {queue.isError && isBusy(queue.error) && <HandOff textKey="link_busy" />}
        {queue.isSuccess && <Result key={queue.data.ticket} queued={queue.data} />}
      </div>
    </div>
  );
}
