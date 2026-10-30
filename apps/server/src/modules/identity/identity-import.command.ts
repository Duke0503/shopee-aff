/**
 * The cutover import of identity (AD-24, Story 2.2): writes customers, aliases, the code
 * counter and bank accounts exactly as given, into empty tables, inside the caller's `tx`.
 * It derives only what identity owns: `search_text` and `sort_key` from the name, the bank
 * fingerprint, and a counter that sits above every code already seen. Rows are written in
 * key order so two imports of one source give identical ledgers.
 */
import { searchText, sortKey } from "@cashback/core";

import { assertTablesEmpty, sortByKey } from "../../platform/db/bulk-import";
import type { LedgerDb } from "../../platform/db/ledger";
import { bankFingerprint } from "./bank-fingerprint";
import { counterAbove } from "./domain/customer-code";
import { bankAccounts, customerAliases, customerCodeCounter, customers, type CustomerRole } from "./schema";

export type ImportedCustomerStatus = "ACTIVE" | "DISABLED";

export interface ImportedCustomer {
  customerId: string;
  customerCode: string | null;
  role: CustomerRole;
  status: ImportedCustomerStatus;
  zaloUserId: string | null;
  privateChatId: string | null;
  displayName: string | null;
  passwordHash: string | null;
  passwordSetAt: string | null;
  failedSignIns: number;
  lockedUntil: string | null;
  lastSignInAt: string | null;
  createdAt: string | null;
}

export interface ImportedAlias {
  alias: string;
  customerId: string;
  createdAt: string | null;
  note: string | null;
}

export interface ImportedBankAccount {
  customerId: string;
  bankName: string | null;
  accountNumber: string;
  holderName: string | null;
  consentAt: string | null;
}

export interface IdentityImport {
  customers: readonly ImportedCustomer[];
  aliases: readonly ImportedAlias[];
  bankAccounts: readonly ImportedBankAccount[];
  /** The live counter's `last`; the imported counter is never below any code seen. */
  counterLast: number;
  /** Every live alias, imported or not: a retired code among them is never issued again. */
  retiredAliases: readonly string[];
}

export interface IdentityImportResult {
  customers: number;
  aliases: number;
  bankAccounts: number;
  counterLast: number;
}

export class IdentityImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IdentityImportError";
  }
}

function refuseUnlessEmpty(db: LedgerDb): void {
  assertTablesEmpty(db, ["customers", "customer_aliases", "customer_code_counter", "bank_accounts"], (table, n) => new IdentityImportError(`identity import needs empty tables; ${table} has ${n} rows`));
}

/** Imports identity into empty tables; call inside `tx`. The holder name is stored upper case (FR-10). */
export function importIdentity(db: LedgerDb, data: IdentityImport, fingerprintKey: string): IdentityImportResult {
  refuseUnlessEmpty(db);
  for (const c of sortByKey(data.customers, (r) => r.customerId)) {
    db.insert(customers)
      .values({ ...c, searchText: searchText(c.displayName, c.customerCode), sortKey: sortKey(c.displayName ?? "") })
      .run();
  }
  for (const a of sortByKey(data.aliases, (r) => r.alias)) db.insert(customerAliases).values(a).run();
  for (const b of sortByKey(data.bankAccounts, (r) => r.customerId)) {
    db.insert(bankAccounts)
      .values({ ...b, holderName: b.holderName?.toUpperCase() ?? null, fingerprint: bankFingerprint(fingerprintKey, b.accountNumber), pendingConfirmation: false })
      .run();
  }
  const codes = [...data.customers.map((c) => c.customerCode ?? ""), ...data.retiredAliases];
  const counterLast = counterAbove(data.counterLast, codes);
  db.insert(customerCodeCounter).values({ id: 1, last: counterLast }).run();
  return { customers: data.customers.length, aliases: data.aliases.length, bankAccounts: data.bankAccounts.length, counterLast };
}
