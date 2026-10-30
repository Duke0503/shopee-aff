/**
 * Payout history (W4 history tab, `payouts_tab_history`, FR-17, FR-34, FR-37, Story 4.12): every payout, voided ones
 * included, on DataList with its state in the URL. One value per column: customer code and name
 * apart, the amount that left the bank, the payout status (voided is its badge), the day paid,
 * the staff member who recorded it, the void day, and the receipt link. The summary is what the
 * filtered set still counts as paid, voided payouts left out, and says so. Void is here: an admin
 * gets the action on a recorded row and the server's void dialog; an employee never sees it.
 */
import type { ListSearchState, PayoutHistoryRow } from "@cashback/contracts";
import { formatVnDateOf, systemClock } from "@cashback/core";
import { Button, CodeChip, DataList, DateFilter, formatCount, MoneyFigure, StatusBadge, Undo2Icon, type ListColumn } from "@cashback/ui";
import { useMemo, useState } from "react";

import { adminText } from "../labels";
import { useStaff } from "../session/staff-context";
import { PageHeader } from "../shell/page-header";
import { PAYOUT_HISTORY_SEARCH, receiptPath, usePayoutHistory } from "./payout-history.queries";
import { PayoutTabs } from "./payout-tabs";
import { VoidDialog } from "./void-dialog";

const nameOf = (row: PayoutHistoryRow): string => row.customerName ?? row.customerCode ?? row.customerId;

function ReceiptLink({ row }: { readonly row: PayoutHistoryRow }) {
  if (row.receiptToken === null) return <span className="text-meta text-muted-foreground">{adminText("history_netting")}</span>;
  return (
    <a href={receiptPath(row.receiptToken)} target="_blank" rel="noopener noreferrer" aria-label={adminText("history_receipt_aria", { payout: row.payoutId })} className="inline-flex min-h-11 items-center text-sm font-medium text-primary underline-offset-4 hover:underline md:min-h-0">
      {adminText("history_receipt")}
    </a>
  );
}

function VoidButton({ row, onVoid, wide = false }: { readonly row: PayoutHistoryRow; readonly onVoid: (row: PayoutHistoryRow) => void; readonly wide?: boolean }) {
  if (row.status !== "RECORDED") return null;
  return (
    <Button type="button" variant="outline" size={wide ? "lg" : "sm"} className={wide ? "text-destructive coarse:h-11" : "px-2 text-destructive coarse:h-11"} aria-label={adminText("history_void_aria", { payout: row.payoutId, name: nameOf(row) })} onClick={() => onVoid(row)}>
      {wide && <Undo2Icon aria-hidden />}
      {adminText("void_open")}
    </Button>
  );
}

function historyColumns(onVoid: ((row: PayoutHistoryRow) => void) | null): readonly ListColumn<PayoutHistoryRow>[] {
  const columns: ListColumn<PayoutHistoryRow>[] = [
    { key: "customerCode", header: adminText("col_customer_code"), kind: "code", sortable: true, desktopOnly: true },
    { key: "customerName", header: adminText("col_customer_name"), kind: "name", sortable: true },
    { key: "amount", header: adminText("col_payout_amount"), kind: "money", sortable: true, width: 100 },
    { key: "status", header: adminText("col_status"), kind: "status", entity: "payout", sortable: true, width: 152 },
    { key: "recordedAt", header: adminText("col_paid_on"), kind: "instant", sortable: true, width: 100 },
    { key: "recordedBy", header: adminText("col_recorded_by"), kind: "text", sortable: true, desktopOnly: true, width: 128 },
    { key: "voidedAt", header: adminText("col_voided_at"), kind: "instant", desktopOnly: true },
    { key: "receiptToken", header: adminText("col_receipt"), kind: "text", width: 72, render: (row) => <ReceiptLink row={row} /> },
  ];
  if (onVoid !== null) columns.push({ key: "payoutId", header: adminText("col_actions"), kind: "text", width: 112, render: (row) => <VoidButton row={row} onVoid={onVoid} /> });
  return columns;
}

function HistoryCard({ row, onVoid }: { readonly row: PayoutHistoryRow; readonly onVoid: ((row: PayoutHistoryRow) => void) | null }) {
  return (
    <article data-card="payout-history" className="flex min-w-0 flex-col gap-2 rounded-xl border border-border bg-card p-3">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <p className="min-w-0 text-[15px] leading-snug font-semibold break-words">{nameOf(row)}</p>
        <span className="shrink-0 text-right">
          <span className="sr-only">{adminText("col_payout_amount")} </span>
          <MoneyFigure amount={row.amount} size="md" />
        </span>
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
        {row.customerCode !== null && <CodeChip code={row.customerCode} className="shrink-0" />}
        <StatusBadge entity="payout" value={row.status} />
      </div>
      <PayoutDates row={row} />
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <ReceiptLink row={row} />
        {onVoid !== null && <VoidButton row={row} onVoid={onVoid} wide />}
      </div>
    </article>
  );
}

function ListDate({ label, at }: { readonly label: string; readonly at: string | null }) {
  const date = formatVnDateOf(at, systemClock);
  if (date === null) return null;
  return (
    <span className="whitespace-nowrap tabular-nums">
      {label} {date}
    </span>
  );
}

function PayoutDates({ row }: { readonly row: PayoutHistoryRow }) {
  return (
    <p className="flex min-w-0 flex-wrap gap-x-3 text-meta text-muted-foreground">
      <ListDate label={adminText("col_paid_on_short")} at={row.recordedAt} />
      {row.recordedBy !== null && <span className="min-w-0 truncate">{row.recordedBy}</span>}
      {row.voidedAt !== null && <ListDate label={adminText("col_voided_short")} at={row.voidedAt} />}
    </p>
  );
}

export interface PayoutHistoryPageProps {
  readonly state: ListSearchState;
  readonly onStateChange: (next: ListSearchState, options?: { readonly replace?: boolean }) => void;
}

const DATE_FIELDS = [{ value: "recordedAt", label: adminText("col_paid_on") }];

export function PayoutHistoryPage({ state, onStateChange }: PayoutHistoryPageProps) {
  const admin = useStaff().role === "ADMIN";
  const [voiding, setVoiding] = useState<PayoutHistoryRow | null>(null);
  const [done, setDone] = useState<number | null>(null);
  const query = usePayoutHistory(state);
  const onVoid = admin ? setVoiding : null;
  const columns = useMemo(() => historyColumns(onVoid), [onVoid]);
  return (
    <>
      <PageHeader title={adminText("nav_payouts")} lead={adminText("history_lead")} />
      <div className="flex min-w-0 flex-col gap-3">
        <PayoutTabs current="HISTORY" />
        {done !== null && (
          <p role="status" className="rounded-md bg-muted p-3 text-sm break-words">
            {adminText("history_void_done", { payout: done })}
          </p>
        )}
        <DataList
          search={PAYOUT_HISTORY_SEARCH}
          state={state}
          onStateChange={onStateChange}
          query={query}
          columns={columns}
          rowKey={(row) => String(row.payoutId)}
          searchPlaceholder={adminText("history_search")}
          countLabel={(count) => adminText("history_count", { count: formatCount(count) })}
          emptyText={adminText("history_empty")}
          statusFilter={{ field: "status", entity: "payout" }}
          summary={[{ key: "paidAmount", label: adminText("history_summary_paid") }]}
          filters={(api) => <DateFilter api={api} fields={DATE_FIELDS} />}
          card={(row) => <HistoryCard row={row} onVoid={onVoid} />}
        />
      </div>
      {voiding !== null && (
        <VoidDialog
          payoutId={voiding.payoutId}
          amount={voiding.amount}
          open
          onOpenChange={(open) => !open && setVoiding(null)}
          onVoided={() => {
            setDone(voiding.payoutId);
            setVoiding(null);
          }}
        />
      )}
    </>
  );
}
