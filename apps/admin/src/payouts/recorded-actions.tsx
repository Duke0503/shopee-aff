/**
 * What follows a recorded payout in the panel (Stories 4.9 and 4.10). The proof chosen before
 * confirm is uploaded once, right after the payout is recorded, and its state is shown: saving,
 * saved with a small picture from the staff-only proof URL, or refused with the server's reason
 * and a retry. Without a proof, staff may still add one here. A netting-only payout moved no money
 * and takes none. Voiding a payout recorded by mistake is done from the payout history
 * (payout-history.page.tsx, Story 4.12), where every payout and its void state are listed.
 */
import type { PayoutConfirmResponse } from "@cashback/contracts";
import { Button } from "@cashback/ui";
import { useEffect, useRef, useState } from "react";

import { ApiError } from "../api/api.queries";
import { adminText, errorText } from "../labels";
import { proofUrl, useUploadProof } from "./payout-record.queries";
import { ProofPicker } from "./proof-picker";

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

export function RecordedActions({ result, proof }: { readonly result: PayoutConfirmResponse; readonly proof: File | null }) {
  if (result.nettingOnly) return null;
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <ProofUpload payoutId={result.payoutId} initial={proof} />
    </div>
  );
}
