/**
 * Customer merge (AD-6, AD-17, AD-23, D42, FR-11, INV-1, Story 4.19): one person with two records,
 * usually after a change of Zalo account, becomes one customer. In one transaction the merged
 * record becomes MERGED and its id an alias of the survivor; no order, award, payout or ledger
 * entry moves, because every balance, list and attribution reads through the aliases
 * (`resolveCustomer`, `customerKeys`). A merge is refused when the two saved bank accounts differ:
 * money would otherwise follow one person's record into another account. When only the merged
 * record has an account, it moves to the survivor, so the survivor can be paid what the merged
 * record earned. The merged record's open sessions end.
 *
 * Preview and apply run the same plan, so apply refuses exactly what the preview showed as
 * refused. The admin role is checked here as well as at the internal route. Balances are the
 * payouts module's, so the caller composes them (admin-command composition); this module plans
 * and writes identity's tables only.
 */
import type { Clock } from "@cashback/core";
import { and, eq, isNull } from "drizzle-orm";

import type { LedgerDb } from "../../platform/db/ledger";
import { hasStaffRole, type CommandAudit } from "../../platform/ports/audit.port";
import { bankAccountsOf, bankDisplayName, type BankAccountFacts } from "./bank-account.query";
import { resolveCustomer } from "./customer.query";
import { bankAccounts, customerAliases, customers, sessions } from "./schema";

export type MergeErrorCode = "admin_only" | "customer_not_found" | "same_customer" | "not_a_customer" | "bank_differs" | "claim_open";

export class CustomerMergeError extends Error {
  constructor(
    readonly code: MergeErrorCode,
    readonly fields: Readonly<Record<string, string>> = {},
  ) {
    super(`customer merge: ${code}`);
    this.name = "CustomerMergeError";
  }
}

export interface MergeSide {
  readonly customerId: string;
  readonly customerCode: string | null;
  readonly displayName: string | null;
  readonly status: "ACTIVE" | "DISABLED";
  readonly bank: { readonly bankName: string | null; readonly lastFour: string } | null;
}

export interface MergePlan {
  readonly merged: MergeSide;
  readonly survivor: MergeSide;
  /** True when the merged record's bank account moves to a survivor that has none. */
  readonly bankMoves: boolean;
}

function side(db: LedgerDb, key: string, banks: (id: string) => BankAccountFacts | undefined): MergeSide {
  const found = resolveCustomer(db, key);
  if (found === null) throw new CustomerMergeError("customer_not_found", { customer: key });
  if (found.role !== "USER") throw new CustomerMergeError("not_a_customer", { customer: key });
  const row = db.select({ customerCode: customers.customerCode, displayName: customers.displayName }).from(customers).where(eq(customers.customerId, found.customerId)).get();
  const bank = banks(found.customerId);
  return { customerId: found.customerId, customerCode: row?.customerCode ?? null, displayName: row?.displayName ?? null, status: found.status, bank: bank === undefined ? null : { bankName: bankDisplayName(bank), lastFour: bank.lastFour } };
}

/**
 * The merge of `mergedKey` into `survivorKey` (each an id, code, alias or Zalo id), or the refusal.
 * `openClaim` says whether a payout claim is open for a customer id (a transfer may be under way).
 */
export function planMerge(db: LedgerDb, mergedKey: string, survivorKey: string, openClaim: (customerId: string) => boolean): MergePlan {
  const ids = [resolveCustomer(db, mergedKey)?.customerId, resolveCustomer(db, survivorKey)?.customerId].filter((id): id is string => id !== undefined);
  const banks = bankAccountsOf(db, ids);
  const merged = side(db, mergedKey, (id) => banks.get(id));
  const survivor = side(db, survivorKey, (id) => banks.get(id));
  if (merged.customerId === survivor.customerId) throw new CustomerMergeError("same_customer");
  const a = banks.get(merged.customerId);
  const b = banks.get(survivor.customerId);
  if (a !== undefined && b !== undefined && a.fingerprint !== b.fingerprint) {
    throw new CustomerMergeError("bank_differs", {
      mergedBank: `${bankDisplayName(a) ?? "?"} ${a.lastFour}`,
      survivorBank: `${bankDisplayName(b) ?? "?"} ${b.lastFour}`,
    });
  }
  for (const s of [merged, survivor]) if (openClaim(s.customerId)) throw new CustomerMergeError("claim_open", { customer: s.customerCode ?? s.customerId });
  return { merged, survivor, bankMoves: a !== undefined && b === undefined };
}

/** Applies a plan made inside the same transaction; call inside `tx`. */
export function applyMerge(db: LedgerDb, plan: MergePlan, deps: { readonly clock: Clock; readonly by: CommandAudit }): MergePlan {
  if (!hasStaffRole(deps.by.actor, ["ADMIN"])) throw new CustomerMergeError("admin_only");
  const now = deps.clock.now();
  const { merged, survivor } = plan;
  db.update(customers).set({ status: "MERGED" }).where(eq(customers.customerId, merged.customerId)).run();
  db.insert(customerAliases).values({ alias: merged.customerId, customerId: survivor.customerId, createdAt: now, note: "merge" }).onConflictDoUpdate({ target: customerAliases.alias, set: { customerId: survivor.customerId, createdAt: now, note: "merge" } }).run();
  if (plan.bankMoves) db.update(bankAccounts).set({ customerId: survivor.customerId }).where(eq(bankAccounts.customerId, merged.customerId)).run();
  db.update(sessions).set({ endedAt: now, endReason: "SIGNED_OUT" }).where(and(eq(sessions.customerId, merged.customerId), isNull(sessions.endedAt))).run();
  deps.by.audit.record({
    actor: deps.by.actor,
    event: "identity.customer.merged",
    entityId: merged.customerId,
    payload: { mergedId: merged.customerId, survivorId: survivor.customerId, bankMoves: plan.bankMoves },
  });
  return plan;
}
