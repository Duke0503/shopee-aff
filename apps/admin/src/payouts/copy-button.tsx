/**
 * A labelled copy button for one transfer fact (account number, amount, reference) in the payout
 * panel, 44 px tall on touch screens so the operator can copy into a banking app on the same
 * phone. The value may come from the server first (the account number, whose reveal is audited).
 *
 * The clipboard write starts synchronously inside the click, with a `ClipboardItem` whose content
 * is a promise, because iOS Safari refuses a write that starts after an awaited fetch; without
 * `ClipboardItem` it falls back to `writeText` once the value is known. Only a write that
 * succeeded shows as copied; a failed fetch or write shows the failure, and `onError` lets the
 * panel react (the account changed under the claim: reload the preview).
 */
import { Button, CheckIcon, COPIED_FOR_MS, CopyIcon } from "@cashback/ui";
import { useEffect, useRef, useState } from "react";

import { adminText } from "../labels";

export type CopyValue = () => Promise<string> | string;

/** Starts the clipboard write now; resolves once the text is on the clipboard. */
export function writeToClipboard(value: CopyValue): Promise<void> {
  const text = Promise.resolve().then(value);
  const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard;
  if (clipboard === undefined) return Promise.reject(new Error("clipboard unavailable"));
  if (typeof ClipboardItem !== "undefined" && typeof clipboard.write === "function") {
    const blob = text.then((t) => new Blob([t], { type: "text/plain" }));
    return clipboard.write([new ClipboardItem({ "text/plain": blob })]);
  }
  return text.then((t) => clipboard.writeText(t));
}

export interface CopyButtonProps {
  readonly label: string;
  readonly value: CopyValue;
  readonly onError?: (error: unknown) => void;
}

export function CopyButton({ label, value, onError }: CopyButtonProps) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const settle = (next: "copied" | "failed"): void => {
    setState(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), COPIED_FOR_MS);
  };

  const onCopy = (): void => {
    writeToClipboard(value).then(
      () => settle("copied"),
      (error: unknown) => {
        settle("failed");
        onError?.(error);
      },
    );
  };

  return (
    <Button type="button" variant="outline" size="sm" className="shrink-0 coarse:h-11" onClick={onCopy}>
      {state === "copied" ? <CheckIcon aria-hidden className="text-primary" /> : <CopyIcon aria-hidden />}
      <span>{label}</span>
      <span role="status" className="sr-only">
        {state === "copied" ? adminText("panel_copied") : state === "failed" ? adminText("panel_copy_failed") : ""}
      </span>
    </Button>
  );
}
