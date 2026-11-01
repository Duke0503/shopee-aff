/**
 * The Zalo accounts the assistant runs on (FR-36, D9; Story 6.11). Each heartbeat names the
 * session's own account; the first time an account is reported is stored, so a new account
 * connected after a lock is seen with its time, and that time is when known customers start to be
 * registered again under new Zalo ids (the default `since` of the merge proposals). Call inside `tx`.
 */
import type { Instant } from "@cashback/core";
import { count, desc } from "drizzle-orm";

import type { LedgerDb } from "../../platform/db/ledger";
import { zaloAccounts } from "./schema";

export const ZALO_ACCOUNT_ID_PATTERN = /^[A-Za-z0-9]{1,40}$/;

/** True when the account was not seen before. */
export function noteZaloAccount(db: LedgerDb, accountId: string, now: Instant): boolean {
  if (!ZALO_ACCOUNT_ID_PATTERN.test(accountId)) throw new RangeError("not a Zalo account id");
  return db.insert(zaloAccounts).values({ accountId, firstSeenAt: now }).onConflictDoNothing({ target: zaloAccounts.accountId }).run().changes === 1;
}

/** When the latest account was first seen, once there has been a switch (two accounts or more); null before. */
export function latestZaloSwitch(db: LedgerDb): Instant | null {
  const seen = db.select({ n: count() }).from(zaloAccounts).get()?.n ?? 0;
  if (seen < 2) return null;
  return (db.select({ at: zaloAccounts.firstSeenAt }).from(zaloAccounts).orderBy(desc(zaloAccounts.firstSeenAt)).limit(1).get()?.at ?? null) as Instant | null;
}
