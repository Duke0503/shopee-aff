/**
 * The readable form of the shadow report, for the owner's sign-off (D44): the verdict on paid
 * parity, differences by reason, the customers live would have overpaid, every customer's
 * payable, waiting and paid side by side, then each changed order under its reason. It renders
 * only what shadow-report.ts computed; no figure is computed here.
 */
import type { ShadowOrder } from "./shadow-evaluate";
import type { ShadowReport } from "./shadow-report";
import { SHADOW_REASONS, type ShadowReason } from "./shadow-reasons";

const dong = (n: number | null): string => (n === null ? "not whole dong" : n.toLocaleString("en-US"));
const signed = (n: number | null): string => (n === null ? "n/a" : n > 0 ? `+${dong(n)}` : dong(n));
const cell = (v: string | null): string => (v === null || v === "" ? "-" : v.replace(/\|/g, "\\|"));

function table(head: readonly string[], rows: readonly (readonly (string | null)[])[]): string[] {
  if (rows.length === 0) return ["None.", ""];
  return [`| ${head.join(" | ")} |`, `|${head.map(() => " --- ").join("|")}|`, ...rows.map((r) => `| ${r.map(cell).join(" | ")} |`), ""];
}

function header(report: ShadowReport): string[] {
  const p = report.paidParity;
  return [
    "# Shadow reconciliation report",
    "",
    "The new reconciliation applied in memory to a read-only copy of the live ledger and the report files below. Nothing was written to the live copy.",
    "",
    ...table(
      ["Input", "File", "sha256", "Rows", "Window from", "Window to"],
      [
        ["live ledger copy", report.inputs.liveCopy.file, report.inputs.liveCopy.sha256, "-", "-", "-"],
        ...report.inputs.reports.map((r) => [r.network, r.source, r.sha256 ?? "-", String(r.rows), r.windowFrom ?? "unknown", r.windowTo ?? "unknown"]),
      ],
    ),
    "## Verdict",
    "",
    `- Paid parity (paid cashback, payouts, paid bonuses per customer): **${p.result.toUpperCase()}** over ${p.customers} customers, ${p.mismatches.length} mismatches.`,
    `- Orders evaluated: ${report.summary.orders}; with a difference: **${report.summary.changed}**.`,
    `- Customers live would have overpaid: **${report.summary.overpaid.length}**.`,
    "",
  ];
}

function parity(report: ShadowReport): string[] {
  if (report.paidParity.mismatches.length === 0) return [];
  return ["## Paid parity mismatches", "", ...table(["Customer", "Measure", "Live", "Imported", "Difference"], report.paidParity.mismatches.map((m) => [m.customerId, m.measure, dong(m.live), dong(m.imported), signed(m.difference)]))];
}

function summary(report: ShadowReport): string[] {
  return [
    "## Differences by reason",
    "",
    ...table(
      ["Reason", "Orders", "Payable difference", "Waiting difference", "Clawback"],
      report.summary.byReason.map((r) => [r.text, String(r.orders), signed(r.payableDifference), signed(r.waitingDifference), dong(r.clawback)]),
    ),
    "## Customers live would have overpaid",
    "",
    ...table(["Customer", "Live pays more by"], report.summary.overpaid.map((o) => [o.customerId, dong(o.amount)])),
    "## Orders not judged",
    "",
    ...table(
      ["Reason", "Orders"],
      Object.entries(report.summary.notJudged).map(([reason, n]) => [SHADOW_REASONS[reason as ShadowReason], String(n)]),
    ),
    "## Live orphan orders owed",
    "",
    "Approved unpaid live orders whose customer id is no customer: live payouts never list them, so they are not in live payable.",
    "",
    ...table(
      ["Order", "Live customer id", "Imported customer", "Cashback", "Bonus"],
      report.liveOrphanOwed.map((o) => [o.orderId, o.liveCustomerId, o.importedCustomerId, dong(o.cashback), dong(o.bonus)]),
    ),
  ];
}

function customers(report: ShadowReport): string[] {
  return [
    "## Per customer",
    "",
    "Payable: approved unpaid cashback plus the bonus on it (live: the named live SQL; shadow: after clawbacks). Waiting: awaiting orders' estimate through the split. Paid: the cutover import's paid parity.",
    "",
    ...table(
      ["Customer", "Live payable", "Shadow payable", "Difference", "Live waiting", "Shadow waiting", "Difference", "Live paid", "Shadow paid", "Clawbacks", "Changed orders"],
      report.customers.map((c) => [
        c.customerId,
        dong(c.livePayable),
        dong(c.shadowPayable),
        signed(c.payableDifference),
        dong(c.liveWaiting),
        dong(c.shadowWaiting),
        signed(c.waitingDifference),
        dong(c.livePaid),
        dong(c.shadowPaid),
        dong(c.clawbacks),
        String(c.changedOrders),
      ]),
    ),
  ];
}

const orderRow = (o: ShadowOrder): (string | null)[] => [
  o.orderId,
  o.network ?? "-",
  o.customerId ?? "-",
  `${o.live.status ?? "none"} ${o.live.cashback === null ? "" : dong(o.live.cashback)}`.trim(),
  `${o.shadow.status ?? "none"} ${o.shadow.cashback === null ? "" : dong(o.shadow.cashback)}`.trim(),
  signed(o.payableDifference),
  signed(o.waitingDifference),
  dong(o.shadow.clawback),
  o.reviewCases.join(", "),
  o.detail,
];

function orders(report: ShadowReport): string[] {
  const out = ["## Orders with a difference", ""];
  const reasons = Object.keys(SHADOW_REASONS) as ShadowReason[];
  for (const reason of reasons) {
    const rows = report.orders.filter((o) => o.changed && o.reason === reason);
    if (rows.length === 0) continue;
    out.push(`### ${SHADOW_REASONS[reason]} (${rows.length})`, "");
    out.push(...table(["Order", "Network", "Customer", "Live state, cashback", "New state, cashback", "Payable difference", "Waiting difference", "Clawback", "Review cases", "Detail"], rows.map(orderRow)));
  }
  return out;
}

const SIGN_OFF = [
  "## Sign-off",
  "",
  "Record the sign-off with `pnpm --filter @cashback/server shadow:sign-off --out <this folder> --name \"<owner>\"`; it stores the name, the time and the checksums of this report.",
  "",
];

export function renderShadowMarkdown(report: ShadowReport): string {
  return [...header(report), ...parity(report), ...summary(report), ...customers(report), ...orders(report), ...SIGN_OFF].join("\n");
}
