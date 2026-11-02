/**
 * One payout on My money (Story 7.4, FR-18, D49): what was sent and when, the link to its public
 * receipt (/b/<token>, facts only), and the proof image, which only the signed-in owner gets: it
 * loads from the owner-only route when the customer asks for it, never before. A voided payout
 * stays listed and says it no longer counts as paid; a payout that only netted a clawback says no
 * money moved.
 */
import { myProofPath, type MyPayoutRow } from "@cashback/contracts";
import { formatVnDateOf, systemClock } from "@cashback/core";
import { ImageIcon, MoneyFigure, ReceiptIcon, StatusBadge, cn } from "@cashback/ui";
import { useState } from "react";

import { webText } from "../labels";
import { FOCUS_RING } from "../shell/nav-items";

const ACTION = cn("-mx-1.5 inline-flex h-11 items-center gap-1.5 rounded-md px-1.5 text-[15px] font-medium text-primary hover:bg-muted", FOCUS_RING);

export function PayoutCard({ row }: { readonly row: MyPayoutRow }) {
  const [proof, setProof] = useState(false);
  const date = formatVnDateOf(row.recordedAt, systemClock) ?? "";
  const voided = row.status === "VOIDED";
  return (
    <article data-payout={row.payoutId} className="flex min-w-0 flex-col gap-2 rounded-xl border border-border bg-card p-3 md:p-4">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <StatusBadge entity="payout" value={row.status} />
        <MoneyFigure amount={row.amount} size="md" className={cn(voided && "text-muted-foreground line-through")} />
      </div>
      <p className="text-meta text-muted-foreground">{webText("payout_date", { date })}</p>
      {voided && <p className="text-meta text-status-rejected">{webText("payout_voided_note")}</p>}
      {!voided && row.amount === 0 && <p className="text-meta text-muted-foreground">{webText("payout_netting_note")}</p>}
      <div className="flex flex-wrap gap-x-4">
        {row.receiptToken !== null && (
          <a href={`/b/${encodeURIComponent(row.receiptToken)}`} className={ACTION}>
            <ReceiptIcon aria-hidden className="size-4" />
            {webText("payout_receipt")}
          </a>
        )}
        {row.hasProof && (
          <button type="button" aria-expanded={proof} onClick={() => setProof(!proof)} className={ACTION}>
            <ImageIcon aria-hidden className="size-4" />
            {webText(proof ? "payout_proof_hide" : "payout_proof_show")}
          </button>
        )}
      </div>
      {proof && <img src={myProofPath(row.payoutId)} alt={webText("payout_proof_alt", { date })} loading="lazy" decoding="async" className="max-h-[70dvh] w-full rounded-lg border border-border object-contain" />}
    </article>
  );
}
