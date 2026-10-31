/**
 * The Customers list (FR-26, FR-15, FR-37, AD-6, AD-12; Story 4.14): every customer the desk
 * lists (all but the guest account and merged records), on the list contract. A row's `payable`
 * and `paid` are `getBalances` figures (through `allBalances`, the same parts and arithmetic), so
 * the row, the customer page and the Payouts row show one amount (list-defects "list and detail
 * dialog use different formulas", "ready counts unsettled orders": only approved unpaid orders
 * and confirmed bonuses count, settled or not). The flags and the bank state come from the shared
 * payout flag rules (`payoutFlags`), so "has a bank account" means one thing everywhere; "no bank
 * account" is a flag only while there is money to send, since most customers never need one.
 *
 * Search covers the stored customer search_text: code, name folded and Zalo id. The code column is
 * the stored customer code and sorts by it, never by the Zalo id. The rows are built once per
 * request and listed from `temp.customer_figures` (platform/list/temp-rows.ts), so the count,
 * the chips' facets and the summary come from the same filtered set as the rows (LC-6); the
 * overall total is answered apart and labelled so.
 */
import type {
  AdminCustomerRow,
  CustomerBankState,
  ListResponse,
  PayoutFlag,
} from "@cashback/contracts";
import type { Clock } from "@cashback/core";

import type { LedgerDb } from "../../platform/db/ledger";
import { defineList } from "../../platform/list/define-list";
import { answerList } from "../../platform/list/list-request";
import { withTempRows, type TempTable } from "../../platform/list/temp-rows";
import {
  bankAccountsOf,
  bankDisplayName,
  deskCustomers,
  sharedBankFingerprints,
  type BankAccountFacts,
} from "../identity/index";
import { orderCountsByCustomer } from "../orders/index";
import {
  allBalances,
  NO_BALANCE,
  survivorResolver,
  type Balance,
  type Owner,
} from "./balance.query";
import { payoutFlags } from "./payout-flags";

export const CUSTOMERS_LIST = defineList({
  from: "temp.customer_figures f JOIN customers c ON c.customer_id = f.customer_id",
  key: "f.customer_id",
  fields: {
    customerId: { kind: "text", column: "f.customer_id" },
    customerCode: { kind: "text", column: "c.customer_code", sortable: true },
    customerName: {
      kind: "name",
      column: "c.display_name",
      sortKeyColumn: "c.sort_key",
      sortable: true,
    },
    bankName: { kind: "text", column: "f.bank_name", sortable: true },
    accountLastFour: { kind: "text", column: "f.account_last_four" },
    orderCount: { kind: "integer", column: "f.order_count", sortable: true },
    payable: { kind: "money", column: "f.payable", sortable: true, summary: true },
    paid: { kind: "money", column: "f.paid", sortable: true, summary: true },
    flags: { kind: "text", column: "f.flags" },
    bankChangedAt: { kind: "instant", column: "f.bank_changed_at" },
    owed: { kind: "text", column: "f.owed", filter: true, facet: true },
    flagged: { kind: "text", column: "f.flagged", filter: true, facet: true },
    bank: { kind: "text", column: "f.bank", filter: true, facet: true },
  },
  search: ["c.search_text"],
  defaultSort: { field: "payable", direction: "desc" },
  overallTotal: true,
});

const TEMP_TABLE: TempTable = {
  name: "customer_figures",
  columns: `customer_id TEXT PRIMARY KEY NOT NULL, payable INTEGER NOT NULL, paid INTEGER NOT NULL, order_count INTEGER NOT NULL,
  bank_name TEXT, account_last_four TEXT, bank_changed_at TEXT, flags TEXT NOT NULL, owed TEXT NOT NULL, flagged TEXT NOT NULL, bank TEXT NOT NULL`,
};

type FigureRow = Omit<AdminCustomerRow, "customerCode" | "customerName">;

/** The bank state by the payout flag rules: none, held until confirmed in Zalo, or saved. */
export function bankStateOf(flags: readonly PayoutFlag[]): CustomerBankState {
  if (flags.includes("NO_BANK")) return "NONE";
  return flags.includes("BANK_HELD") ? "HELD" : "SAVED";
}

/** The flags a customer row and page show: the payout flags, "no bank account" only while money waits for one. */
export function customerFlags(all: readonly PayoutFlag[], gross: number): PayoutFlag[] {
  return all.filter((flag) => flag !== "NO_BANK" || gross > 0);
}

/**
 * How many orders each listed customer holds, by the page's own rule: a live customer's orders
 * under its id and every alias (the survivor resolver), an erased customer's under its own id
 * (FR-35), so the row and the page always show the same count.
 */
function orderCounts(
  db: LedgerDb,
  survivor: Owner,
  erased: ReadonlySet<string>,
): Map<string, number> {
  const owner = (stored: string): string | null =>
    survivor(stored) ?? (erased.has(stored) ? stored : null);
  const counts = new Map<string, number>();
  for (const r of orderCountsByCustomer(db)) {
    const id = owner(r.customerId);
    if (id !== null) counts.set(id, (counts.get(id) ?? 0) + r.count);
  }
  return counts;
}

function rowOf(
  customerId: string,
  balance: Omit<Balance, "customerId">,
  bank: BankAccountFacts | null,
  all: readonly PayoutFlag[],
  orderCount: number,
): FigureRow {
  const flags = customerFlags(all, balance.gross);
  return {
    customerId,
    payable: balance.payable,
    paid: balance.paid,
    orderCount,
    bankName: bank === null ? null : bankDisplayName(bank),
    accountLastFour: bank?.lastFour ?? null,
    bankChangedAt: bank?.changedAt ?? null,
    flags: flags.join(","),
    owed: balance.payable > 0 ? "YES" : "NO",
    flagged: flags.length > 0 ? "YES" : "NO",
    bank: bankStateOf(all),
  };
}

/** One row per listed customer, figures from `allBalances` and the shared flag rules. */
export function customerRows(db: LedgerDb, clock: Clock): FigureRow[] {
  const listed = deskCustomers(db);
  const ids = listed.map((c) => c.customerId);
  // One resolver for the whole request: balances and order counts credit each stored id once.
  const survivor = survivorResolver(db);
  const balances = allBalances(db, survivor);
  const banks = bankAccountsOf(db, ids);
  const shared = sharedBankFingerprints(db);
  const erased = new Set(listed.filter((c) => c.status === "ERASED").map((c) => c.customerId));
  const counts = orderCounts(db, survivor, erased);
  const now = clock.now();
  return ids.map((id) => {
    const balance = balances.get(id) ?? NO_BALANCE;
    const bank = banks.get(id) ?? null;
    const all = payoutFlags({
      bank,
      sharedFingerprints: shared,
      payable: balance.payable,
      gross: balance.gross,
      now,
      erased: erased.has(id),
    });
    return rowOf(id, balance, bank, all, counts.get(id) ?? 0);
  });
}

const figureValues = (r: FigureRow): readonly unknown[] => [
  r.customerId,
  r.payable,
  r.paid,
  r.orderCount,
  r.bankName,
  r.accountLastFour,
  r.bankChangedAt,
  r.flags,
  r.owed,
  r.flagged,
  r.bank,
];

/** One page of the Customers list for a raw query; a refused query is the list error envelope. */
export function answerCustomersList(
  db: LedgerDb,
  raw: unknown,
  clock: Clock,
): ListResponse<AdminCustomerRow> {
  return withTempRows(db, TEMP_TABLE, customerRows(db, clock), figureValues, () =>
    answerList<typeof CUSTOMERS_LIST.fields, AdminCustomerRow>(db, CUSTOMERS_LIST, raw, clock),
  );
}
