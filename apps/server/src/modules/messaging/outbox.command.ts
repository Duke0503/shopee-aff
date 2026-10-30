/**
 * The outbox (AD-16, D46): producers enqueue a notification inside their own transaction with
 * the dedup key `<entity>:<id>:<event>`; a key already in the outbox, enqueued or seeded by the
 * cutover as already sent, makes the enqueue a no-op. Guests (HOUSE) and customers who no longer
 * resolve (erased) are refused: nothing is ever told to them (D5); so is a netting-only payout,
 * whose transfer is 0 (AD-16, D42). An enqueue that adds a row, and
 * the cutover seed, each write one audit entry in the same transaction (AD-17); a no-op writes
 * none. Delivery, retries, the daily cap and `messaging.silent` come with Stories 6.4 and 6.10.
 */
import type { Clock, Instant } from "@cashback/core";
import { eq } from "drizzle-orm";

import { assertTablesEmpty, sortByKey } from "../../platform/db/bulk-import";
import type { LedgerDb } from "../../platform/db/ledger";
import type { CommandAudit } from "../../platform/ports/audit.port";
import { DEDUP_KEY_PATTERN, type OutboxLookup, type OutboxMessage, type OutboxPort } from "../../platform/ports/outbox.port";
import { resolveCustomer } from "../identity/index";
import { outbox } from "./schema";

export { DEDUP_KEY_PATTERN, dedupKey, dedupKeyParts, encodeDedupKeyId } from "../../platform/ports/outbox.port";

export type EnqueueResult = "enqueued" | "duplicate" | "refused_guest" | "refused_unknown_customer" | "refused_netting_only";

export function enqueue(db: LedgerDb, clock: Clock, message: OutboxMessage, by: CommandAudit): EnqueueResult {
  if (!DEDUP_KEY_PATTERN.test(message.dedupKey)) throw new RangeError(`not a dedup key: ${message.dedupKey}`);
  if (message.transferAmount === 0) return "refused_netting_only";
  const customer = resolveCustomer(db, message.customerId);
  if (customer === null) return "refused_unknown_customer";
  if (customer.role === "HOUSE") return "refused_guest";
  const now = clock.now();
  const result = db
    .insert(outbox)
    .values({ dedupKey: message.dedupKey, customerId: customer.customerId, messageKey: message.messageKey, params: JSON.stringify(message.params), createdAt: now, dueAt: now, origin: "EVENT" })
    .onConflictDoNothing({ target: outbox.dedupKey })
    .run();
  if (result.changes !== 1) return "duplicate";
  by.audit.record({ actor: by.actor, event: "messaging.outbox.enqueued", entityId: message.dedupKey, payload: { customerId: customer.customerId, messageKey: message.messageKey } });
  return "enqueued";
}

/** True when the outbox holds the key, enqueued or seeded as already sent. */
export function wasTold(db: LedgerDb, dedupKey: string): boolean {
  return db.select({ key: outbox.dedupKey }).from(outbox).where(eq(outbox.dedupKey, dedupKey)).get() !== undefined;
}

/** The outbox port bound to one transaction's handle (platform/ports/outbox.port.ts). */
export function outboxFor(db: LedgerDb, clock: Clock, by: CommandAudit): OutboxPort & OutboxLookup & { enqueue(message: OutboxMessage): EnqueueResult } {
  return { enqueue: (message) => enqueue(db, clock, message, by), told: (key) => wasTold(db, key) };
}

export interface SeededNotification {
  dedupKey: string;
  customerId: string;
  messageKey: string;
  /** When the live system told it, if it recorded that. */
  sentAt: Instant | null;
}

export class OutboxSeedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OutboxSeedError";
  }
}

/**
 * Seeds the keys the live system already told as sent (D46), into an empty outbox; call inside
 * `tx`. A seeded row is never due. Rows are written in key order for a deterministic ledger.
 */
export function seedSentNotifications(db: LedgerDb, rows: readonly SeededNotification[], seededAt: Instant, by: CommandAudit): number {
  assertTablesEmpty(db, ["outbox"], (_table, n) => new OutboxSeedError(`the outbox must be empty to seed it; it has ${n} rows`));
  const sorted = sortByKey(rows, (r) => r.dedupKey);
  for (const row of sorted) {
    if (!DEDUP_KEY_PATTERN.test(row.dedupKey)) throw new OutboxSeedError(`not a dedup key: ${row.dedupKey}`);
    db.insert(outbox)
      .values({ dedupKey: row.dedupKey, customerId: row.customerId, messageKey: row.messageKey, params: "{}", createdAt: seededAt, dueAt: null, sentAt: row.sentAt ?? seededAt, origin: "CUTOVER_SEED" })
      .run();
  }
  by.audit.record({ actor: by.actor, event: "messaging.outbox.seeded", entityId: by.actor.id, payload: { seeded: sorted.length } });
  return sorted.length;
}
