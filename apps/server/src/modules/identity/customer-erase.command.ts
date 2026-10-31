/**
 * Erasing a customer's personal data (AD-17, AD-23, D13, D26, FR-35, NFR-6, Story 4.16). The
 * privacy law needs the personal data gone, not the money record: the record keeps its permanent
 * id and code, becomes ERASED, and its orders, payouts, ledger entries, awards and audit entries
 * stay exactly as they were under that id. What goes: the name, the Zalo ids and the private chat,
 * the password and its sign-in state, the bank account, `search_text` and `sort_key`, the same on
 * every merged record of the same person, and the free-text notes on its aliases. The alias keys
 * stay: they are the ids and retired codes old links carry in sub_id1 and that must never be issued
 * again, so attribution and code issuance still see them. Every open customer session ends. An erased record earns nothing further and is told
 * nothing; its old links still attribute to it (`ledgerOwnerOf`, `earnsNothing`).
 *
 * A customer still owed money (payable or waiting above 0, D13) is refused with the owed amounts;
 * an admin may force it with a reason. Identity cannot read balances, so the caller passes them
 * (the payouts module's `getBalances`). One transaction, with its audit entry (ids, amounts and
 * the bank fingerprint only).
 */
import type { Clock } from "@cashback/core";
import { and, eq, inArray, isNull } from "drizzle-orm";

import type { LedgerDb } from "../../platform/db/ledger";
import { hasStaffRole, type CommandAudit } from "../../platform/ports/audit.port";
import { customerKeys } from "./customer.query";
import { bankAccounts, customerAliases, customers, sessions } from "./schema";

export const ERASE_REASON_MAX = 500;

export type EraseErrorCode = "customer_not_found" | "not_a_customer" | "already_erased" | "owed_money" | "admin_only" | "reason_required" | "claim_open";

export class CustomerEraseError extends Error {
  constructor(
    readonly code: EraseErrorCode,
    readonly owed?: OwedMoney,
  ) {
    super(`customer erase: ${code}`);
    this.name = "CustomerEraseError";
  }
}

/** What the customer is still owed, from `getBalances` (D13). */
export interface OwedMoney {
  readonly payable: number;
  readonly waiting: number;
}

export interface EraseInput {
  readonly customerId: string;
  readonly owed: OwedMoney;
  /** True only for the admin's forced erase; a reason is then required. */
  readonly force: boolean;
  readonly reason?: string;
  /** True when a payout claim is open for the customer: a transfer may be under way. */
  readonly claimOpen: boolean;
}

export interface ErasedCustomer {
  readonly customerId: string;
  readonly erasedAt: string;
  readonly forced: boolean;
  /** Merged records of the same person whose personal data went too. */
  readonly mergedRecords: number;
}

const isOwed = (owed: OwedMoney): boolean => owed.payable > 0 || owed.waiting > 0;

/** The erasable record behind a permanent id: a desk customer that is ACTIVE or DISABLED. */
function erasable(db: LedgerDb, customerId: string) {
  const row = db.select({ role: customers.role, status: customers.status }).from(customers).where(eq(customers.customerId, customerId)).get();
  if (row === undefined || row.status === "MERGED") throw new CustomerEraseError("customer_not_found");
  if (row.role !== "USER") throw new CustomerEraseError("not_a_customer");
  if (row.status === "ERASED") throw new CustomerEraseError("already_erased");
}

/** Refuses what the rules refuse, before anything is written (also the preview's check). */
export function checkErase(db: LedgerDb, input: EraseInput, by: CommandAudit): void {
  erasable(db, input.customerId);
  if (input.claimOpen) throw new CustomerEraseError("claim_open");
  if (input.force && !hasStaffRole(by.actor, ["ADMIN"])) throw new CustomerEraseError("admin_only");
  if (isOwed(input.owed) && !input.force) throw new CustomerEraseError("owed_money", input.owed);
  const reason = input.reason?.trim() ?? "";
  if (input.force && (reason.length === 0 || reason.length > ERASE_REASON_MAX)) throw new CustomerEraseError("reason_required");
}

const PERSONAL_CLEARED = {
  zaloUserId: null,
  privateChatId: null,
  displayName: null,
  searchText: "",
  sortKey: "",
  passwordHash: null,
  passwordSetAt: null,
  failedSignIns: 0,
  lockedUntil: null,
  lastSignInAt: null,
} as const;

/** Erases one customer; call inside `tx`. */
export function eraseCustomer(db: LedgerDb, input: EraseInput, deps: { readonly clock: Clock; readonly by: CommandAudit }): ErasedCustomer {
  checkErase(db, input, deps.by);
  const now = deps.clock.now();
  const family = customerKeys(db, input.customerId)?.keys ?? [input.customerId];
  const records = db.select({ customerId: customers.customerId }).from(customers).where(inArray(customers.customerId, [...family])).all().map((r) => r.customerId);
  const merged = records.filter((id) => id !== input.customerId);
  const bank = db.select({ fingerprint: bankAccounts.fingerprint }).from(bankAccounts).where(eq(bankAccounts.customerId, input.customerId)).get();

  db.update(customers).set(PERSONAL_CLEARED).where(inArray(customers.customerId, records)).run();
  db.update(customers).set({ status: "ERASED", erasedAt: now }).where(eq(customers.customerId, input.customerId)).run();
  db.delete(bankAccounts).where(inArray(bankAccounts.customerId, records)).run();
  db.update(customerAliases).set({ note: null }).where(inArray(customerAliases.customerId, records)).run();
  db.update(sessions).set({ endedAt: now, endReason: "SIGNED_OUT" }).where(and(inArray(sessions.customerId, records), isNull(sessions.endedAt))).run();

  const reason = input.reason?.trim();
  deps.by.audit.record({
    actor: deps.by.actor,
    event: "identity.customer.erased",
    entityId: input.customerId,
    payload: { customerId: input.customerId, forced: input.force, owedPayable: input.owed.payable, owedWaiting: input.owed.waiting, mergedRecords: merged.length, ...(bank === undefined ? {} : { bankFingerprint: bank.fingerprint }) },
    ...(input.force && reason !== undefined ? { reason } : {}),
  });
  return { customerId: input.customerId, erasedAt: now, forced: input.force, mergedRecords: merged.length };
}
