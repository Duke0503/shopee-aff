/**
 * `resolveCustomer` (AD-23, identity.customer.lookup-any-form): the surviving customer behind a
 * customer id, a customer code, an alias (an old Zalo id or a retired code) or a Zalo id,
 * ignoring spaces and the case of a code. One key can match two rows (one row's id is another
 * row's Zalo id), so the match is taken in a fixed precedence: customer id, then customer code,
 * then alias, then Zalo id. A MERGED row resolves through its alias to the survivor; an ERASED
 * row, or a merged row with no survivor, resolves to null. Attribution, balances and lists
 * resolve through it.
 */
import { and, eq, inArray, ne } from "drizzle-orm";

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

/** The cards of every customer id named, in one read, by customer id; an unknown id is absent. */
export function customerCardsOf(db: LedgerDb, customerIds: readonly string[]): Map<string, { customerCode: string | null; displayName: string | null }> {
  const ids = [...new Set(customerIds)];
  if (ids.length === 0) return new Map();
  const rows = db.select({ customerId: customers.customerId, customerCode: customers.customerCode, displayName: customers.displayName }).from(customers).where(inArray(customers.customerId, ids)).all();
  return new Map(rows.map(({ customerId, ...card }) => [customerId, card]));
}

/** The ids of the guest accounts (role HOUSE, D5): their orders earn no cashback. */
export function guestCustomerIds(db: LedgerDb): string[] {
  return db.select({ customerId: customers.customerId }).from(customers).where(eq(customers.role, "HOUSE")).all().map((r) => r.customerId);
}

/**
 * The one rule for who the desk lists and opens as a customer (Story 4.14): a person who uses the
 * service (role USER). The guest account (HOUSE, D5) and the customer records of staff accounts
 * (ADMIN, EMPLOYEE) are not customers on any desk screen.
 */
export const DESK_CUSTOMER_ROLES: readonly CustomerRole[] = ["USER"];
export const isDeskCustomer = (role: CustomerRole): boolean => DESK_CUSTOMER_ROLES.includes(role);

export interface DeskCustomer {
  readonly customerId: string;
  readonly status: "ACTIVE" | "DISABLED" | "ERASED";
}

/**
 * The desk customer behind a key of any kind (id, code, alias, Zalo id), merges followed, an erased
 * customer included (FR-35: its page stays); null for nobody, a merged record without a survivor,
 * or someone who is not a desk customer.
 */
export function deskCustomerOf(db: LedgerDb, key: string): DeskCustomer | null {
  const compact = key.replace(/\s+/g, "");
  if (compact === "") return null;
  const row = followMerges(db, firstMatch(db, compact, compact.toUpperCase()));
  if (!row || row.status === "MERGED" || !isDeskCustomer(row.role)) return null;
  return { customerId: row.customerId, status: row.status };
}

/**
 * The customers the desk lists (Story 4.14): every desk customer (`isDeskCustomer`) but a merged
 * record, which lives on as an alias of its survivor. An erased customer stays listed under its id
 * (FR-35).
 */
export function deskCustomers(db: LedgerDb): DeskCustomer[] {
  return db
    .select({ customerId: customers.customerId, status: customers.status })
    .from(customers)
    .where(and(inArray(customers.role, [...DESK_CUSTOMER_ROLES]), ne(customers.status, "MERGED")))
    .all()
    .flatMap((r) => (r.status === "MERGED" ? [] : [{ customerId: r.customerId, status: r.status }]));
}

export interface CustomerProfile {
  readonly customerId: string;
  readonly customerCode: string | null;
  readonly displayName: string | null;
  readonly status: "ACTIVE" | "DISABLED" | "ERASED";
  readonly zaloUserId: string | null;
  readonly createdAt: string | null;
}

/** What a staff customer page shows of one surviving customer (never a password or session fact). */
export function customerProfileOf(db: LedgerDb, customerId: string): CustomerProfile | null {
  const row = db
    .select({
      customerId: customers.customerId,
      customerCode: customers.customerCode,
      displayName: customers.displayName,
      status: customers.status,
      zaloUserId: customers.zaloUserId,
      createdAt: customers.createdAt,
    })
    .from(customers)
    .where(eq(customers.customerId, customerId))
    .get();
  if (row === undefined || row.status === "MERGED") return null;
  return { ...row, status: row.status };
}
