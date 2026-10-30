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

/** The one merge walker: a MERGED row to its survivor through its alias, at most MAX_MERGE_HOPS hops. */
function followMerges(db: LedgerDb, start: Row | undefined): Row | undefined {
  let row = start;
  for (let hop = 0; row?.status === "MERGED" && hop < MAX_MERGE_HOPS; hop++) {
    const survivor = aliasTarget(db, [row.customerId]);
    row = survivor === undefined || survivor === row.customerId ? undefined : byId(db, survivor);
  }
  return row;
}

export function resolveCustomer(db: LedgerDb, key: string): ResolvedCustomer | null {
  const compact = key.replace(/\s+/g, "");
  if (compact === "") return null;
  const row = followMerges(db, firstMatch(db, compact, compact.toUpperCase()));
  if (!row || row.status === "MERGED" || row.status === "ERASED") return null;
  return { customerId: row.customerId, role: row.role, status: row.status };
}

/** A customer's code by its permanent id, or null (staff, HOUSE and unknown ids have none). */
export function customerCodeOf(db: LedgerDb, customerId: string): string | null {
  return db.select({ code: customers.customerCode }).from(customers).where(eq(customers.customerId, customerId)).get()?.code ?? null;
}

export interface CustomerKeys {
  readonly customer: ResolvedCustomer;
  /** The survivor's id and every alias that leads to it, merged ids through a chain included. */
  readonly keys: readonly string[];
}

/**
 * The surviving customer behind `key` and every id its records may sit under (AD-23, D42): a merge
 * moves no order, award or ledger entry, so a balance reads them through the aliases. An alias is a
 * key only when `resolveCustomer` itself resolves it to this survivor, so the two share one merge
 * walker and its hop limit, and an alias that is another live customer's id never pulls that
 * customer's records in.
 */
export function customerKeys(db: LedgerDb, key: string): CustomerKeys | null {
  const customer = resolveCustomer(db, key);
  if (customer === null) return null;
  const keys = new Set([customer.customerId]);
  const seen = new Set(keys);
  let frontier = [customer.customerId];
  for (let hop = 0; frontier.length > 0 && hop < MAX_MERGE_HOPS; hop++) {
    const next = db.select({ alias: customerAliases.alias }).from(customerAliases).where(inArray(customerAliases.customerId, frontier)).all().map((r) => r.alias).filter((a) => !seen.has(a));
    for (const alias of next) {
      seen.add(alias);
      if (resolveCustomer(db, alias)?.customerId === customer.customerId) keys.add(alias);
    }
    frontier = next.filter((a) => keys.has(a));
  }
  return { customer, keys: [...keys].sort() };
}

/** The code and the display name a staff screen shows for one customer, or null for an unknown id. */
export function customerCardOf(db: LedgerDb, customerId: string): { customerCode: string | null; displayName: string | null } | null {
  return db.select({ customerCode: customers.customerCode, displayName: customers.displayName }).from(customers).where(eq(customers.customerId, customerId)).get() ?? null;
}
