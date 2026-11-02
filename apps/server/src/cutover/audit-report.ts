/**
 * The cutover numbers audit as one result and its owner-readable page (audit.json, audit.md):
 * orders, transfers, customers and network batches (cutover-audit.ts, audit-customers.ts), "pass"
 * only when every difference has a documented reason. Codes and ids only.
 */
import { sumDong } from "@cashback/money";
import type BetterSqlite3 from "better-sqlite3";

import { auditBatches, auditCustomers, statusTotals, type CustomerLine } from "./audit-customers";
import { readAuditSources } from "./audit-sources";
import { auditOrders, auditPayouts, type AuditDifference, type TransferLine } from "./cutover-audit";
import type { ImportReport } from "./import-report";

export interface AuditResult {
  readonly result: "pass" | "fail";
  readonly unexplained: number;
  readonly explained: Record<string, number>;
  readonly orders: { readonly checked: number; readonly statusMap: Record<string, number> };
  readonly payouts: { readonly checked: number; readonly lines: readonly TransferLine[] };
  readonly customers: { readonly checked: number; readonly lines: readonly CustomerLine[]; readonly totals: Record<string, { readonly live: number; readonly imported: number }> };
  readonly statusTotals: ReturnType<typeof statusTotals>;
  readonly batches: { readonly checked: number; readonly received: { readonly live: number; readonly imported: number } };
  readonly differences: readonly AuditDifference[];
}

export function runAudit(source: BetterSqlite3.Database, target: BetterSqlite3.Database, report: Pick<ImportReport, "notes" | "payouts">): AuditResult {
  const src = readAuditSources(source, target, report.notes, (report.payouts?.paidWithoutPayout ?? []).map((p) => p.orderId));
  const orders = auditOrders(src);
  const payouts = auditPayouts(src);
  const customers = auditCustomers(src, source, target);
  const batches = auditBatches(source, target);
  const differences = [...orders.differences, ...payouts.differences, ...customers.differences, ...batches.differences];
  const explained: Record<string, number> = {};
  for (const d of differences) if (d.explained) explained[d.reason] = (explained[d.reason] ?? 0) + 1;
  const unexplained = differences.filter((d) => !d.explained).length;
  const total = (pick: (l: CustomerLine) => number) => sumDong(customers.lines.map(pick), "total");
  return {
    result: unexplained === 0 ? "pass" : "fail",
    unexplained,
    explained,
    orders: { checked: orders.checked, statusMap: orders.statusMap },
    payouts: { checked: payouts.checked, lines: payouts.lines },
    customers: {
      checked: customers.lines.length,
      lines: customers.lines,
      totals: {
        paid: { live: total((l) => l.livePaid), imported: total((l) => l.newPaid) },
        payable: { live: total((l) => l.livePayable), imported: total((l) => l.newPayable) },
        waiting: { live: total((l) => l.liveWaiting), imported: total((l) => l.newWaiting) },
        liveQr: { live: total((l) => l.liveQr), imported: total((l) => l.newPayable) },
      },
    },
    statusTotals: statusTotals(source, target),
    batches: { checked: batches.checked, received: batches.received },
    differences,
  };
}

const row = (cells: readonly (string | number | null)[]): string => `| ${cells.map((c) => (c === null ? "" : String(c))).join(" | ")} |`;

export function auditMarkdown(a: AuditResult, generatedAt: string): string {
  const lines = [
    "# Cutover numbers audit",
    "",
    `Generated ${generatedAt}. Result: **${a.result.toUpperCase()}**, ${a.unexplained} unexplained differences. Every difference below has a reason code; "unexplained" fails the cutover.`,
    "",
    "## Totals",
    "",
    row(["Measure", "Live", "New"]),
    row(["---", "---", "---"]),
    ...Object.entries(a.customers.totals).map(([k, t]) => row([k, t.live, t.imported])),
    row(["network batches received", a.batches.received.live, a.batches.received.imported]),
    "",
    "## Orders per status",
    "",
    row(["Status", "Live orders", "Live cashback", "New orders", "New cashback"]),
    row(["---", "---", "---", "---", "---"]),
    ...[...new Set([...Object.keys(a.statusTotals.live), ...Object.keys(a.statusTotals.imported)])].map((s) =>
      row([s, a.statusTotals.live[s]?.orders ?? null, a.statusTotals.live[s]?.cashback ?? null, a.statusTotals.imported[s]?.orders ?? null, a.statusTotals.imported[s]?.cashback ?? null]),
    ),
    "",
    `Status mapping (live->new): ${Object.entries(a.orders.statusMap).map(([k, n]) => `${k} ${n}`).join(", ")}.`,
    "",
    "## Transfers",
    "",
    row(["Payout", "Customer", "Amount", "Covered", "Difference", "Orders", "Bonuses"]),
    row(["---", "---", "---", "---", "---", "---", "---"]),
    ...a.payouts.lines.map((l) => row([l.payoutId, l.customer, l.amount, l.covered, l.difference, l.orders.join(" "), l.awards.join(" ")])),
    "",
    "## Customers",
    "",
    row(["Code", "Paid live", "Paid new", "Payable live", "Payable new", "Waiting live", "Waiting new", "Live QR", "Reasons"]),
    row(["---", "---", "---", "---", "---", "---", "---", "---", "---"]),
    ...a.customers.lines.map((l) => row([l.code, l.livePaid, l.newPaid, l.livePayable, l.newPayable, l.liveWaiting, l.newWaiting, l.liveQr, l.reasons.join(" ")])),
    "",
    "## Differences",
    "",
    row(["Section", "Key", "Field", "Live", "New", "Reason"]),
    row(["---", "---", "---", "---", "---", "---"]),
    ...a.differences.map((d) => row([d.section, d.key, d.field, d.live, d.imported, d.explained ? d.reason : "**UNEXPLAINED**"])),
    "",
  ];
  return lines.join("\n");
}
