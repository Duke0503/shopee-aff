/**
 * What a quiet run would have sent (AD-16, AD-24, D46; Story 6.10): the would-be sends recorded
 * while `messaging.silent` was on, from an instant on, counted per event (`<entity>:<event>` of
 * the dedup key) and per message key. Counts only: no customer, no id.
 */
import type { Instant } from "@cashback/core";
import { and, count, gte, isNotNull, isNull } from "drizzle-orm";

import { dedupKeyParts } from "../../platform/ports/outbox.port";
import type { LedgerDb } from "../../platform/db/ledger";
import { outbox } from "./schema";

export interface WouldBeSends {
  readonly total: number;
  /** `order:approved`, `link_request:delivered`, ... */
  readonly byEvent: Readonly<Record<string, number>>;
  readonly byMessageKey: Readonly<Record<string, number>>;
}

const sortedCounts = (values: readonly string[]): Record<string, number> => {
  const counts: Record<string, number> = {};
  for (const value of [...values].sort()) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
};

export function wouldBeSends(db: LedgerDb, since: Instant): WouldBeSends {
  const rows = db
    .select({ dedupKey: outbox.dedupKey, messageKey: outbox.messageKey })
    .from(outbox)
    .where(and(isNotNull(outbox.silencedAt), gte(outbox.silencedAt, since)))
    .all();
  return {
    total: rows.length,
    byEvent: sortedCounts(rows.map((r) => {
      const { entity, event } = dedupKeyParts(r.dedupKey);
      return `${entity}:${event}`;
    })),
    byMessageKey: sortedCounts(rows.map((r) => r.messageKey)),
  };
}

/** Notifications created from `since` on that are due to be sent (0 after a quiet run). */
export function dueCreatedSince(db: LedgerDb, since: Instant): number {
  return db.select({ n: count() }).from(outbox).where(and(gte(outbox.createdAt, since), isNotNull(outbox.dueAt), isNull(outbox.sentAt))).get()?.n ?? 0;
}
