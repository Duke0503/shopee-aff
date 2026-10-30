/**
 * What follows a recorded payout in the panel (Stories 4.9 and 4.10). The proof chosen before
 * confirm is uploaded once, right after the payout is recorded, and its state is shown: saving,
 * saved with a small picture from the staff-only proof URL, or refused with the server's reason
 * and a retry. Without a proof, staff may still add one here. A netting-only payout moved no money
 * and takes none. An admin also gets "void" for a payout recorded by mistake; the dialog is the
 * server's preview (void-dialog.tsx), and once voided the panel says so instead and takes no
 * more proof (the server refuses one for a voided payout).
 */
import type { PayoutConfirmResponse } from "@cashback/contracts";
import { Button, CheckIcon, Undo2Icon } from "@cashback/ui";
import { useEffect, useRef, useState } from "react";

import { ApiError } from "../api/api.queries";
import { adminText, errorText } from "../labels";
import { useStaff } from "../session/staff-context";
import { proofUrl, useUploadProof } from "./payout-record.queries";
import { ProofPicker } from "./proof-picker";
import { VoidDialog } from "./void-dialog";

function ProofUpload({ payoutId, initial }: { readonly payoutId: number; readonly initial: File | null }) {
  const upload = useUploadProof();
  const [file, setFile] = useState<File | null>(initial);
  const sent = useRef(false);
  const { mutate } = upload;
  useEffect(() => {
    if (sent.current || initial === null) return;
    sent.current = true;
    mutate({ payoutId, file: initial });
  }, [initial, payoutId, mutate]);

  if (upload.isSuccess) {
    return (
      <p role="status" data-proof-state="saved" className="flex min-w-0 items-center gap-3 text-sm">
        <img src={proofUrl(payoutId)} alt={adminText("proof_image_alt", { payout: payoutId })} className="size-14 shrink-0 rounded-md border border-border bg-muted object-cover" />
        <span className="min-w-0 break-words">{adminText("proof_saved")}</span>
      </p>
    );
  }
  if (upload.isPending) {
    return (
      <p role="status" data-proof-state="saving" className="text-sm text-muted-foreground">
        {adminText("proof_uploading")}
      </p>
    );
  }
  const reason = upload.error instanceof ApiError ? errorText(upload.error.messageKey, upload.error.code) : upload.isError ? errorText("error.internal", "internal") : null;
  return (
    <div className="flex min-w-0 flex-col gap-2">
      {reason !== null && (
        <p role="alert" data-proof-state="failed" className="rounded-md bg-status-rejected-soft p-3 text-sm break-words text-status-rejected">
          {adminText("proof_failed")} {reason}
        </p>
      )}
      <ProofPicker file={file} onChange={setFile} />
      {file !== null && (
        <Button type="button" variant="outline" className="h-11 self-start md:h-9" onClick={() => mutate({ payoutId, file })}>
          {adminText(reason === null ? "proof_add" : "proof_retry")}
        </Button>
      )}
    </div>
  );
}

type Voided = "done" | "already" | null;

function VoidAction({ result, voided, onVoided }: { readonly result: PayoutConfirmResponse; readonly voided: Voided; readonly onVoided: (voided: Voided) => void }) {
  const [open, setOpen] = useState(false);
  if (voided !== null) {
    return (
      <p role="status" data-voided="" className="flex min-w-0 items-start gap-2 rounded-md bg-status-rejected-soft p-3 text-sm text-status-rejected">
        <CheckIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
        <span className="min-w-0 break-words">{adminText(voided === "done" ? "void_done" : "void_already")}</span>
      </p>
    );
  }
  return (
    <>
      <Button type="button" variant="destructive" className="h-11 self-start md:h-9" onClick={() => setOpen(true)}>
        <Undo2Icon aria-hidden />
        {adminText("void_open")}
      </Button>
      <VoidDialog
        payoutId={result.payoutId}
        amount={result.amount}
        open={open}
        onOpenChange={setOpen}
        onVoided={(replay) => {
          setOpen(false);
          onVoided(replay ? "already" : "done");
        }}
      />
    </>
  );
}

export function RecordedActions({ result, proof }: { readonly result: PayoutConfirmResponse; readonly proof: File | null }) {
  const admin = useStaff().role === "ADMIN";
  const [voided, setVoided] = useState<Voided>(null);
  return (
    <div className="flex min-w-0 flex-col gap-3">
      {!result.nettingOnly && voided === null && <ProofUpload payoutId={result.payoutId} initial={proof} />}
      {admin && <VoidAction result={result} voided={voided} onVoided={setVoided} />}
    </div>
  );
}
