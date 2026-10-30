/**
 * `resolveCustomer` (AD-23, identity.customer.lookup-any-form): the surviving customer behind a
 * customer id, a customer code, an alias (an old Zalo id or a retired code) or a Zalo id,
 * ignoring spaces and the case of a code. One key can match two rows (one row's id is another
 * row's Zalo id), so the match is taken in a fixed precedence: customer id, then customer code,
 * then alias, then Zalo id. A MERGED row resolves through its alias to the survivor; an ERASED
 * row, or a merged row with no survivor, resolves to null. Attribution, balances and lists
 * resolve through it.
 */
import { eq, inArray } from "drizzle-orm";

import type { LedgerDb } from "../../platform/db/ledger";
import { customerAliases, customers, type CustomerRole } from "./schema";

export interface ResolvedCustomer {
  readonly customerId: string;
  readonly role: CustomerRole;
  /** ACTIVE, LOCKED is derived from `locked_until`, or DISABLED: never MERGED or ERASED. */
  readonly status: "ACTIVE" | "DISABLED";
}

/** Merges chain at most this deep; a longer chain is a data error and resolves to null. */
const MAX_MERGE_HOPS = 5;

type Row = { customerId: string; role: CustomerRole; status: "ACTIVE" | "DISABLED" | "MERGED" | "ERASED" };

const columns = { customerId: customers.customerId, role: customers.role, status: customers.status };

function byId(db: LedgerDb, id: string): Row | undefined {
  return db.select(columns).from(customers).where(eq(customers.customerId, id)).get();
}

function aliasTarget(db: LedgerDb, keys: string[]): string | undefined {
  return db.select({ id: customerAliases.customerId }).from(customerAliases).where(inArray(customerAliases.alias, keys)).get()?.id;
}

function firstMatch(db: LedgerDb, compact: string, upper: string): Row | undefined {
  const viaAlias = (): Row | undefined => {
    const target = aliasTarget(db, [compact, upper]);
    return target === undefined ? undefined : byId(db, target);
  };
  return (
    byId(db, compact) ??
    db.select(columns).from(customers).where(eq(customers.customerCode, upper)).get() ??
    viaAlias() ??
    db.select(columns).from(customers).where(eq(customers.zaloUserId, compact)).get()
  );
}

export function resolveCustomer(db: LedgerDb, key: string): ResolvedCustomer | null {
  const compact = key.replace(/\s+/g, "");
  if (compact === "") return null;
  let row = firstMatch(db, compact, compact.toUpperCase());
  for (let hop = 0; row?.status === "MERGED" && hop < MAX_MERGE_HOPS; hop++) {
    const survivor = aliasTarget(db, [row.customerId]);
    row = survivor === undefined || survivor === row.customerId ? undefined : byId(db, survivor);
  }
  if (!row || row.status === "MERGED" || row.status === "ERASED") return null;
  return { customerId: row.customerId, role: row.role, status: row.status };
}

/** A customer's code by its permanent id, or null (staff, HOUSE and unknown ids have none). */
export function customerCodeOf(db: LedgerDb, customerId: string): string | null {
  return db.select({ code: customers.customerCode }).from(customers).where(eq(customers.customerId, customerId)).get()?.code ?? null;
}
