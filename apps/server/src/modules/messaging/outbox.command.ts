/**
 * The outbox (AD-16, D46): producers enqueue a notification inside their own transaction with
 * the dedup key `<entity>:<id>:<event>`; a key already in the outbox, enqueued or seeded by the
 * cutover as already sent, makes the enqueue a no-op. Guests (HOUSE) and customers who no longer
 * resolve (erased) are refused: nothing is ever told to them (D5). Delivery, retries, the daily
 * cap and `messaging.silent` come with Stories 6.4 and 6.10.
 */
import type { Clock, Instant } from "@cashback/core";

import { assertTablesEmpty, sortByKey } from "../../platform/db/bulk-import";
import type { LedgerDb } from "../../platform/db/ledger";
import type { OutboxMessage, OutboxPort } from "../../platform/ports/outbox.port";
import { resolveCustomer } from "../identity/index";
import { outbox } from "./schema";

/** `<entity>:<id>:<event>`: a snake_case entity and event around an id without colons or spaces. */
export const DEDUP_KEY_PATTERN = /^[a-z][a-z_]*:[^:\s]+:[a-z][a-z_]*$/;

const UNSAFE_IN_ID = /[%:\s]/gu;
const utf8 = new TextEncoder();

/**
 * The id part of a key: `%`, `:` and whitespace percent-encoded as their UTF-8 bytes (`AT 12345`
 * is `AT%2012345`, `x:1` is `x%3A1`), every other character as it is. Live ids are letters and
 * digits, so their keys read as the plain id; any other id still gets one key of its own, and
 * `dedupKeyParts` gives it back exactly.
 */
export function encodeDedupKeyId(id: string): string {
  return id.replace(UNSAFE_IN_ID, (c) => [...utf8.encode(c)].map((b) => `%${b.toString(16).toUpperCase().padStart(2, "0")}`).join(""));
}

export function dedupKey(entity: string, id: string, event: string): string {
  const key = `${entity}:${encodeDedupKeyId(id)}:${event}`;
  if (!DEDUP_KEY_PATTERN.test(key)) throw new RangeError(`not a dedup key: ${key}`);
  return key;
}

export function dedupKeyParts(key: string): { entity: string; id: string; event: string } {
  if (!DEDUP_KEY_PATTERN.test(key)) throw new RangeError(`not a dedup key: ${key}`);
  const [entity = "", encoded = "", event = ""] = key.split(":");
  return { entity, id: decodeURIComponent(encoded), event };
}

export type EnqueueResult = "enqueued" | "duplicate" | "refused_guest" | "refused_unknown_customer";

export function enqueue(db: LedgerDb, clock: Clock, message: OutboxMessage): EnqueueResult {
  if (!DEDUP_KEY_PATTERN.test(message.dedupKey)) throw new RangeError(`not a dedup key: ${message.dedupKey}`);
  const customer = resolveCustomer(db, message.customerId);
  if (customer === null) return "refused_unknown_customer";
  if (customer.role === "HOUSE") return "refused_guest";
  const now = clock.now();
  const result = db
    .insert(outbox)
    .values({ dedupKey: message.dedupKey, customerId: customer.customerId, messageKey: message.messageKey, params: JSON.stringify(message.params), createdAt: now, dueAt: now, origin: "EVENT" })
    .onConflictDoNothing({ target: outbox.dedupKey })
    .run();
  return result.changes === 1 ? "enqueued" : "duplicate";
}

/** The outbox port bound to one transaction's handle (platform/ports/outbox.port.ts). */
export function outboxFor(db: LedgerDb, clock: Clock): OutboxPort & { enqueue(message: OutboxMessage): EnqueueResult } {
  return { enqueue: (message) => enqueue(db, clock, message) };
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
export function seedSentNotifications(db: LedgerDb, rows: readonly SeededNotification[], seededAt: Instant): number {
  assertTablesEmpty(db, ["outbox"], (_table, n) => new OutboxSeedError(`the outbox must be empty to seed it; it has ${n} rows`));
  const sorted = sortByKey(rows, (r) => r.dedupKey);
  for (const row of sorted) {
    if (!DEDUP_KEY_PATTERN.test(row.dedupKey)) throw new OutboxSeedError(`not a dedup key: ${row.dedupKey}`);
    db.insert(outbox)
      .values({ dedupKey: row.dedupKey, customerId: row.customerId, messageKey: row.messageKey, params: "{}", createdAt: seededAt, dueAt: null, sentAt: row.sentAt ?? seededAt, origin: "CUTOVER_SEED" })
      .run();
  }
  return sorted.length;
}
