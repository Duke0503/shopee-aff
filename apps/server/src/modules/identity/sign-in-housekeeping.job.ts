/**
 * The hourly sign-in housekeeping (AD-13, AD-18; Story 7.2). Customer sign-in throttles keep no
 * state past 24 quiet hours: rows whose last failure is older and whose wait has ended are
 * removed, and the table is capped at the newest MAX_THROTTLE_ROWS rows, so failures from many
 * addresses on made-up codes cannot grow the ledger without limit. The failures on codes nobody
 * holds since the last run are written as one audit entry and one log line.
 */
import { instantFromMs, toMs, type Clock } from "@cashback/core";
import { and, isNull, lt, or, sql } from "drizzle-orm";

import type { Ledger, LedgerDb } from "../../platform/db/ledger";
import type { Logger } from "../../platform/log/logger";
import type { AuditPort } from "../../platform/ports/audit.port";
import { CUSTOMER_SIGN_IN_ACTOR } from "./customer-sign-in.command";
import { customerSignInClients, customerSignInThrottles } from "./schema";
import type { UnknownSignInTally } from "./sign-in-tally";

export const THROTTLE_QUIET_MS = 24 * 3_600_000;
export const MAX_THROTTLE_ROWS = 20_000;
export const UNKNOWN_CODES_ENTITY = "unknown";

export interface SignInHousekeepingDeps {
  readonly ledger: Ledger;
  readonly clock: Clock;
  readonly unknown: UnknownSignInTally;
  readonly auditFor: (db: LedgerDb) => AuditPort;
  readonly logger?: Pick<Logger, "info" | "warn">;
  readonly maxRows?: number;
}

export interface SignInHousekeeping {
  readonly pruned: number;
  readonly capped: number;
  readonly unknownFailures: number;
}

function prune(db: LedgerDb, clock: Clock, maxRows: number): { pruned: number; capped: number } {
  const now = clock.now();
  const cutoff = instantFromMs(toMs(now) - THROTTLE_QUIET_MS);
  const ended = (column: typeof customerSignInThrottles.lockedUntil | typeof customerSignInClients.lockedUntil) => or(isNull(column), lt(column, now));
  const pruned =
    db.delete(customerSignInThrottles).where(and(lt(customerSignInThrottles.lastFailedAt, cutoff), ended(customerSignInThrottles.lockedUntil))).run().changes +
    db.delete(customerSignInClients).where(and(lt(customerSignInClients.windowStartedAt, cutoff), ended(customerSignInClients.lockedUntil))).run().changes;
  const capped = db.run(sql`DELETE FROM customer_sign_in_throttles WHERE rowid IN (SELECT rowid FROM customer_sign_in_throttles ORDER BY last_failed_at DESC LIMIT -1 OFFSET ${maxRows})`).changes;
  return { pruned, capped };
}

export function runSignInHousekeeping(deps: SignInHousekeepingDeps): SignInHousekeeping {
  const unknownFailures = deps.unknown.take();
  const { pruned, capped } = deps.ledger.tx((db) => {
    if (unknownFailures > 0) deps.auditFor(db).record({ actor: CUSTOMER_SIGN_IN_ACTOR, event: "identity.customer.unknown_sign_ins", entityId: UNKNOWN_CODES_ENTITY, payload: { failures: unknownFailures } });
    return prune(db, deps.clock, deps.maxRows ?? MAX_THROTTLE_ROWS);
  });
  if (unknownFailures > 0) deps.logger?.warn({ failures: unknownFailures }, "identity.customer.unknown_sign_ins");
  if (capped > 0) deps.logger?.warn({ capped }, "identity.sign_in.throttles_capped");
  if (pruned > 0) deps.logger?.info({ pruned }, "identity.sign_in.throttles_pruned");
  return { pruned, capped, unknownFailures };
}
