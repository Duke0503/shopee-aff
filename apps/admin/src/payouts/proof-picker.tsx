/**
 * The proof drop zone of the payout panel (W4, DESIGN.md payout panel: dashed {colors.input}
 * border, {rounded.xl}; EXPERIENCE.md "optional proof image: paste, drop or camera on phone";
 * Story 4.9). One JPEG or PNG may be chosen: pasted while the panel is open, dropped on the zone,
 * or picked with the file button, which offers the camera on a phone. Anything else is refused
 * here with the server's own wording, and so is a file over the 8 MB upload limit; the server
 * judges the bytes again. The picture is shown
 * small so staff can see it is the right screenshot; nothing is uploaded until the payout is
 * recorded.
 */
import { Button, ImageUpIcon, XIcon } from "@cashback/ui";
import { useEffect, useId, useRef, useState, type DragEvent } from "react";

import { adminText, errorText } from "../labels";
import { proofFileRefusal } from "./payout-record.queries";

export interface ProofPickerProps {
  readonly file: File | null;
  readonly onChange: (file: File | null) => void;
  readonly disabled?: boolean;
  /** A line under the zone, such as "saved right after confirm". */
  readonly hint?: string;
}

/** A local picture of the chosen file; none where the browser cannot make one. */
function usePreviewUrl(file: File | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (file === null || typeof URL.createObjectURL !== "function") {
      setUrl(null);
      return;
    }
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);
  return url;
}

/** A pasted image while the picker is shown and enabled. */
function usePastedFile(disabled: boolean, take: (file: File) => void): void {
  useEffect(() => {
    if (disabled) return;
    const onPaste = (event: ClipboardEvent): void => {
      const pasted = [...(event.clipboardData?.files ?? [])][0];
      if (pasted !== undefined) take(pasted);
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  });
}

function Chosen({ file, disabled, onRemove }: { readonly file: File; readonly disabled: boolean; readonly onRemove: () => void }) {
  const preview = usePreviewUrl(file);
  return (
    <div className="flex min-w-0 items-center gap-3">
      {preview !== null && <img src={preview} alt="" className="size-14 shrink-0 rounded-md border border-border object-cover" />}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-caption text-muted-foreground">{adminText("proof_selected")}</span>
        <span className="truncate text-sm font-medium" title={file.name}>
          {file.name}
        </span>
      </span>
      <Button type="button" variant="ghost" size="icon" className="coarse:size-11" disabled={disabled} aria-label={adminText("proof_remove")} onClick={onRemove}>
        <XIcon aria-hidden />
      </Button>
    </div>
  );
}

export function ProofPicker({ file, onChange, disabled = false, hint }: ProofPickerProps) {
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  const [refused, setRefused] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const take = (candidate: File | null | undefined): void => {
    if (candidate === null || candidate === undefined) return;
    const refusal = proofFileRefusal(candidate);
    setRefused(refusal);
    if (refusal === null) onChange(candidate);
  };
  usePastedFile(disabled, take);
  const drop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    setOver(false);
    if (!disabled) take(event.dataTransfer.files[0]);
  };
  const dragOver = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    setOver(true);
  };
  return (
    <section data-proof="" className="flex min-w-0 flex-col gap-2" aria-labelledby={`${id}-label`}>
      <p id={`${id}-label`} className="flex flex-wrap items-baseline gap-x-2 text-sm font-semibold">
        {adminText("proof_label")}
        <span className="text-caption font-normal text-muted-foreground">{adminText("proof_optional")}</span>
      </p>
      <div onDragOver={dragOver} onDragLeave={() => setOver(false)} onDrop={drop} className={`flex min-w-0 flex-col gap-3 rounded-xl border border-dashed p-3 ${over ? "border-primary bg-secondary" : "border-input bg-background"}`}>
        {file === null ? (
          <div className="flex min-w-0 flex-col items-start gap-2">
            <p className="text-meta break-words text-muted-foreground">{adminText("proof_hint")}</p>
            <Button type="button" variant="outline" className="h-11 bg-background md:h-9" disabled={disabled} onClick={() => input.current?.click()}>
              <ImageUpIcon aria-hidden />
              {adminText("proof_choose")}
            </Button>
          </div>
        ) : (
          <Chosen file={file} disabled={disabled} onRemove={() => onChange(null)} />
        )}
        <input ref={input} type="file" accept="image/jpeg,image/png" className="sr-only" tabIndex={-1} aria-hidden onChange={(event) => {
            take(event.target.files?.[0]);
            // Cleared after reading, so the same file can be picked again after it is removed.
            event.target.value = "";
          }}
        />
      </div>
      {refused !== null && (
        <p role="alert" className="text-meta break-words text-status-rejected">
          {errorText(refused, "invalid_request")}
        </p>
      )}
      {hint !== undefined && file !== null && <p className="text-caption text-muted-foreground">{hint}</p>}
    </section>
  );
}
