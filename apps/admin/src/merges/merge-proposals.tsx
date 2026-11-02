/**
 * The "merge proposals" tab of Review (wireframe Review desktop, FR-11, FR-36, Story 6.11): pairs
 * of records that may be one person after the bot's Zalo account changed, the newer record first,
 * with why the pair is proposed. Nothing merges by itself: "Xem gop" opens the merge dialog with
 * the older record kept. A table from the tablet up, one card per pair on a phone.
 */
import type { CustomerMergeProposals } from "@cashback/contracts";
import { Button, CodeChip, Skeleton, useLayout } from "@cashback/ui";
import { useState } from "react";

import { adminText } from "../labels";
import { MergeDialog } from "./merge-dialog";
import { useMergeProposals } from "./merges.queries";

type Proposal = CustomerMergeProposals["proposals"][number];

const codeOf = (side: Proposal["merged"]): string => side.customerCode ?? side.customerId;
const keyOf = (p: Proposal): string => `${p.merged.customerId}>${p.survivor.customerId}`;

function reasonText(p: Proposal): string {
  return p.reason === "code_claimed" ? adminText("merge_reason_code_claimed", { code: codeOf(p.survivor) }) : adminText("merge_reason_same_name");
}

function OpenButton({ p, onOpen, wide = false }: { readonly p: Proposal; readonly onOpen: (p: Proposal) => void; readonly wide?: boolean }) {
  return (
    <Button type="button" variant="outline" size={wide ? "lg" : "sm"} className={wide ? "w-full coarse:h-11" : "coarse:h-11"} aria-label={adminText("merge_open_aria", { merged: codeOf(p.merged), survivor: codeOf(p.survivor) })} onClick={() => onOpen(p)}>
      {adminText("merge_open")}
    </Button>
  );
}

const TH = "h-10 px-4 text-left text-meta font-semibold text-muted-foreground";

function ProposalTable({ proposals, onOpen }: { readonly proposals: readonly Proposal[]; readonly onOpen: (p: Proposal) => void }) {
  return (
    <div className="min-w-0 overflow-hidden rounded-xl border border-border bg-card">
      <table className="w-full table-fixed text-sm">
        <thead className="bg-muted/60">
          <tr>
            <th scope="col" className={`${TH} w-[148px]`}>{adminText("col_merge_new")}</th>
            <th scope="col" className={`${TH} w-[148px]`}>{adminText("col_merge_old")}</th>
            <th scope="col" className={TH}>{adminText("col_merge_name")}</th>
            <th scope="col" className={TH}>{adminText("col_merge_reason")}</th>
            <th scope="col" className={`${TH} w-[120px]`}><span className="sr-only">{adminText("merge_open")}</span></th>
          </tr>
        </thead>
        <tbody>
          {proposals.map((p) => (
            <tr key={keyOf(p)} data-merge-proposal={p.reason} className="border-t border-border">
              <td className="px-4 py-3"><CodeChip code={codeOf(p.merged)} /></td>
              <td className="px-4 py-3"><CodeChip code={codeOf(p.survivor)} /></td>
              <td className="px-4 py-3 break-words">{p.merged.customerName ?? p.survivor.customerName ?? ""}</td>
              <td className="px-4 py-3 break-words">{reasonText(p)}</td>
              <td className="px-4 py-3 text-right"><OpenButton p={p} onOpen={onOpen} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ProposalCards({ proposals, onOpen }: { readonly proposals: readonly Proposal[]; readonly onOpen: (p: Proposal) => void }) {
  return (
    <ul className="flex min-w-0 flex-col gap-3">
      {proposals.map((p) => (
        <li key={keyOf(p)} data-merge-proposal={p.reason} className="flex min-w-0 flex-col gap-2 rounded-xl border border-border bg-card p-3">
          <p className="text-[15px] leading-snug font-semibold break-words">{p.merged.customerName ?? p.survivor.customerName ?? reasonText(p)}</p>
          <p className="flex min-w-0 flex-wrap items-center gap-2 text-meta text-muted-foreground">
            <CodeChip code={codeOf(p.merged)} />
            <span aria-hidden>{"\u2192"}</span>
            <CodeChip code={codeOf(p.survivor)} />
          </p>
          <p className="text-meta break-words text-muted-foreground">{reasonText(p)}</p>
          <OpenButton p={p} onOpen={onOpen} wide />
        </li>
      ))}
    </ul>
  );
}

export function MergeProposals() {
  const query = useMergeProposals(true);
  const phone = useLayout() === "phone";
  const [opened, setOpened] = useState<Proposal | null>(null);
  if (query.data === undefined) {
    if (query.isError) return <p role="alert" className="rounded-md bg-status-rejected-soft p-3 text-sm text-status-rejected">{adminText("merges_failed")}</p>;
    return (
      <div role="status" aria-label={adminText("merges_loading")} className="flex flex-col gap-2">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    );
  }
  const proposals = query.data.proposals;
  return (
    <section data-merge-proposals aria-label={adminText("review_tab_merges")} className="flex min-w-0 flex-col gap-3">
      <p className="text-meta text-muted-foreground">{adminText("merges_lead")}</p>
      {proposals.length === 0 ? (
        <p className="rounded-xl border border-border bg-card px-4 py-6 text-center text-[15px] text-muted-foreground">{adminText("merges_empty")}</p>
      ) : phone ? (
        <ProposalCards proposals={proposals} onOpen={setOpened} />
      ) : (
        <ProposalTable proposals={proposals} onOpen={setOpened} />
      )}
      {opened !== null && <MergeDialog key={keyOf(opened)} open onOpenChange={(open) => (open ? undefined : setOpened(null))} survivor={opened.survivor.customerId} merged={opened.merged.customerId} />}
    </section>
  );
}

/** How many proposals the tab holds, for its pill; undefined while unknown. */
export function useProposalCount(enabled: boolean): number | undefined {
  return useMergeProposals(enabled).data?.proposals.length;
}
