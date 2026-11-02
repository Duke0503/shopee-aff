/**
 * The converter's fields as the pen.dev Home draws them (W1, Story 7.6): one tall link field with
 * the link icon inside on the left and the paste button (link_paste) inside on the right (where the
 * browser allows the clipboard); and, once a link is sent, the
 * link shown as a quiet one-line box that takes the customer back to the form when pressed.
 * Labels stay for screen readers; an error is said under its field with the alert icon.
 */
import { WEB_LINK_URL_MAX } from "@cashback/contracts";
import { ClipboardPasteIcon, cn, LinkIcon } from "@cashback/ui";
import { useSyncExternalStore } from "react";

import { webText } from "../labels";
import { FOCUS_RING } from "../shell/nav-items";
import { CircleAlertIcon } from "../shell/site-icons";

const FIELD_BOX = "flex h-14 min-w-0 items-center gap-2.5 rounded-xl border border-input bg-card pr-1.5 pl-4 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50";
const WIDE = "(min-width: 768px)";
const subscribeWide = (change: () => void): (() => void) => {
  const query = window.matchMedia?.(WIDE);
  query?.addEventListener("change", change);
  return () => query?.removeEventListener("change", change);
};
/** The longer placeholder from tablet up; read here so Home does not load the shared layout hook's chunk. */
const useWide = (): boolean => useSyncExternalStore(subscribeWide, () => window.matchMedia?.(WIDE).matches ?? false, () => false);
const canPaste = (): boolean => typeof navigator !== "undefined" && typeof navigator.clipboard?.readText === "function";

export function FieldError({ id, text }: { readonly id: string; readonly text: string }) {
  return (
    <p id={id} role="alert" className="flex items-start gap-1.5 text-meta font-medium text-destructive">
      <CircleAlertIcon aria-hidden className="mt-px size-4 shrink-0" />
      {text}
    </p>
  );
}

export function UrlField({ value, onChange, error }: { readonly value: string; readonly onChange: (v: string) => void; readonly error: string | undefined }) {
  const wide = useWide();
  const paste = async (): Promise<void> => {
    try {
      onChange((await navigator.clipboard.readText()).trim());
    } catch {
      // The browser refused the clipboard; the customer pastes by hand.
    }
  };
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor="link-url" className="sr-only">
        {webText("link_url_label")}
      </label>
      <div className={cn(FIELD_BOX, error !== undefined && "border-destructive")}>
        <LinkIcon aria-hidden className="size-5 shrink-0 text-muted-foreground" />
        <input
          id="link-url"
          type="url"
          inputMode="url"
          autoComplete="off"
          maxLength={WEB_LINK_URL_MAX}
          value={value}
          placeholder={webText(wide ? "link_url_placeholder" : "link_url_placeholder_short")}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={error !== undefined}
          aria-describedby={`${error === undefined ? "" : "link-url-error "}link-url-hint`}
          className="h-full min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground md:text-[17px]"
        />
        {canPaste() && (
          <button type="button" className={cn("inline-flex h-11 shrink-0 items-center gap-1.5 rounded-lg bg-muted px-3 text-[15px] font-semibold hover:bg-border", FOCUS_RING)} onClick={() => void paste()}>
            <ClipboardPasteIcon aria-hidden className="size-4" />
            {webText("link_paste")}
          </button>
        )}
      </div>
      {error !== undefined && <FieldError id="link-url-error" text={error} />}
    </div>
  );
}

/** The link already sent, on one line; pressing it goes back to the form to send another. */
export function UrlSummary({ url, onChange }: { readonly url: string; readonly onChange: () => void }) {
  return (
    <button type="button" data-link-summary onClick={onChange} aria-label={`${webText("link_change")}: ${url}`} className={cn("flex h-12 w-full min-w-0 items-center gap-2.5 rounded-xl border border-border bg-card px-4 text-left hover:bg-muted/60", FOCUS_RING)}>
      <LinkIcon aria-hidden className="size-5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 truncate text-[15px]">{url.replace(/^https?:\/\/(www\.)?/, "")}</span>
    </button>
  );
}
