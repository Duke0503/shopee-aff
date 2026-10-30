/**
 * The Payouts list (FR-16, FR-31, FR-37, AD-6, AD-12, D11, D27, Story 4.6): every customer with
 * something to pay or to net, on the one list contract. The amount of each row is `getBalances`
 * payable (through `payableBalances`, the same definition), never a sum of its own: only
 * APPROVED unpaid orders with a commission and CONFIRMED bonuses count, FROZEN and REVERSED count
 * nowhere, awaiting money never appears, and there is no option that widens this. A customer with
 * only awaiting orders is in no row.
 *
 * A balance is not a stored column, so each request builds the rows once, in memory, and lists
 * them from `temp.payout_queue` (platform/list/temp-rows.ts) joined to the customers table, so
 * search, sort, the page, the count and the summary all come from the same filtered set as the
 * rows (LC-6), without taking the ledger's write lock (AD-2).
 * The tab totals come from the same build and travel with the list response. Settlement is a
 * separate fact on the row (D27), and a partly settled customer is listed like any other.
 */
import type { PayoutListResponse, PayoutQueueCounts, PayoutQueueRow } from "@cashback/contracts";
import { settlementOf, type Clock } from "@cashback/core";
import { eq } from "drizzle-orm";

import type { Ledger, LedgerDb } from "../../platform/db/ledger";
import { defineList } from "../../platform/list/define-list";
import { answerList } from "../../platform/list/list-request";
import { withTempRows, type TempTable } from "../../platform/list/temp-rows";
import { bankAccountsOf, bankDisplayName, sharedBankFingerprints, staffNamesOf } from "../identity/index";
import { payableOrderLines } from "../orders/index";
import { payableBalances, survivorResolver } from "./balance.query";
import { payoutFlags, queueOf } from "./payout-flags";
import { payoutClaims } from "./schema";

export const PAYOUT_QUEUE_LIST = defineList({
  from: "temp.payout_queue q JOIN customers c ON c.customer_id = q.customer_id",
  key: "q.customer_id",
  fields: {
    customerId: { kind: "text", column: "q.customer_id" },
    customerCode: { kind: "text", column: "c.customer_code", sortable: true },
    customerName: { kind: "name", column: "c.display_name", sortKeyColumn: "c.sort_key", sortable: true },
    bankName: { kind: "text", column: "q.bank_name", sortable: true },
    accountLastFour: { kind: "text", column: "q.account_last_four" },
    orderCount: { kind: "integer", column: "q.order_count", sortable: true },
    settledCount: { kind: "integer", column: "q.settled_count" },
    settlement: { kind: "text", column: "q.settlement", filter: true, facet: true },
    flags: { kind: "text", column: "q.flags" },
    bankChangedAt: { kind: "instant", column: "q.bank_changed_at" },
    payable: { kind: "money", column: "q.payable", sortable: true, summary: true },
    queue: { kind: "text", column: "q.queue", filter: true },
    claimStaffId: { kind: "text", column: "q.claim_staff_id" },
    claimStaffName: { kind: "text", column: "q.claim_staff_name" },
  },
  search: ["c.search_text"],
  defaultSort: { field: "payable", direction: "desc" },
});

const TEMP_TABLE: TempTable = {
  name: "payout_queue",
  columns: `customer_id TEXT PRIMARY KEY NOT NULL, queue TEXT NOT NULL, payable INTEGER NOT NULL, bank_name TEXT, account_last_four TEXT,
  order_count INTEGER NOT NULL, settled_count INTEGER NOT NULL, settlement TEXT, flags TEXT NOT NULL, bank_changed_at TEXT,
  claim_staff_id TEXT, claim_staff_name TEXT`,
};

type QueueRow = Omit<PayoutQueueRow, "customerCode" | "customerName">;

function orderFacts(db: LedgerDb): Map<string, boolean[]> {
  const owner = survivorResolver(db);
  const settled = new Map<string, boolean[]>();
  for (const line of payableOrderLines(db, null)) {
    const id = owner(line.customerId);
    if (id === null) continue;
    const facts = settled.get(id);
    if (facts === undefined) settled.set(id, [line.settled]);
    else facts.push(line.settled);
  }
  return settled;
}

function openClaimHolders(db: LedgerDb): Map<string, { staffId: string; staffName: string }> {
  const open = db.select({ customerId: payoutClaims.customerId, staffId: payoutClaims.staffId }).from(payoutClaims).where(eq(payoutClaims.status, "OPEN")).all();
  const names = staffNamesOf(db, open.map((c) => c.staffId));
  return new Map(open.map((c) => [c.customerId, { staffId: c.staffId, staffName: names.get(c.staffId) ?? c.staffId }]));
}

/** One row per customer with a gross above 0, built from `payableBalances` and the shared flag rules. */
export function payoutQueueRows(db: LedgerDb, clock: Clock): QueueRow[] {
  const balances = payableBalances(db);
  const ids = balances.map((b) => b.customerId);
  const banks = bankAccountsOf(db, ids);
  const shared = sharedBankFingerprints(db);
  const orders = orderFacts(db);
  const claims = openClaimHolders(db);
  const now = clock.now();
  return balances.map((b) => {
    const bank = banks.get(b.customerId) ?? null;
    const flags = payoutFlags({ bank, sharedFingerprints: shared, payable: b.payable, gross: b.gross, now });
    const settled = orders.get(b.customerId) ?? [];
    const claim = claims.get(b.customerId);
    return {
      customerId: b.customerId,
      queue: queueOf(flags),
      payable: b.payable,
      bankName: bank === null ? null : bankDisplayName(bank),
      accountLastFour: bank?.lastFour ?? null,
      orderCount: settled.length,
      settledCount: settled.filter(Boolean).length,
      settlement: settled.length === 0 ? null : settlementOf(settled.map((s) => (s ? "PAID" : null))),
      flags: flags.join(","),
      bankChangedAt: bank?.changedAt ?? null,
      claimStaffId: claim?.staffId ?? null,
      claimStaffName: claim?.staffName ?? null,
    };
  });
}

const queueValues = (r: QueueRow): readonly unknown[] => [r.customerId, r.queue, r.payable, r.bankName, r.accountLastFour, r.orderCount, r.settledCount, r.settlement, r.flags, r.bankChangedAt, r.claimStaffId, r.claimStaffName];

const countsOf = (rows: readonly QueueRow[]): PayoutQueueCounts => ({ payable: rows.filter((r) => r.queue === "PAYABLE").length, action: rows.filter((r) => r.queue === "ACTION").length });

/** One page of the Payouts list for a raw query, with both tab totals; a refused query is the list error envelope. */
export function answerPayoutQueue(ledger: Ledger, raw: unknown, clock: Clock): PayoutListResponse {
  const db = ledger.db;
  const rows = payoutQueueRows(db, clock);
  return withTempRows(db, TEMP_TABLE, rows, queueValues, () => ({ ...answerList<typeof PAYOUT_QUEUE_LIST.fields, PayoutQueueRow>(db, PAYOUT_QUEUE_LIST, raw, clock), queues: countsOf(rows) }));
}

/** How many customers each tab holds, over the whole queue (the tabs' own totals, not a search). */
export function payoutQueueCounts(db: LedgerDb, clock: Clock): PayoutQueueCounts {
  return countsOf(payoutQueueRows(db, clock));
}
