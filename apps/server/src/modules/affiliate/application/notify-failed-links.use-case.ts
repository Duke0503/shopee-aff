import { and, eq, inArray, isNotNull, isNull, ne } from "drizzle-orm";

import type { DeliveryPort, NotifyResult } from "../../../notifications/delivery";
import { render, type Messages } from "../../../notifications/messages";
import type { Db } from "../../../shared/database/connection";
import { customers, linkRequests } from "../../../shared/database/schema";

/**
 * Apologising for links the browser could not convert. Ports the "failed
 * links" step of the old notify loop. A request only reaches `failed` after
 * every retry, so this is final news, not a hiccup. An apology older than two
 * hours is marked and dropped: after an outage a pile of stale messages reads
 * as spam. The row is marked notified only AFTER the assistant confirms
 * delivery, so a restart retries instead of losing the message.
 */
export const FAILED_LINK_STALE_MS = 2 * 60 * 60 * 1000;

export interface NotifyFailedLinksDeps {
  db: Db;
  delivery: DeliveryPort;
  messages: Messages;
  now: () => string;
}

/** Old news: an unreadable or too-distant timestamp is not worth sending. */
export function isStale(createdAt: string, nowMs: number, staleMs = FAILED_LINK_STALE_MS): boolean {
  const createdMs = Date.parse(createdAt);
  if (Number.isNaN(createdMs)) return true;
  return nowMs - createdMs > staleMs;
}

export async function notifyFailedLinks(deps: NotifyFailedLinksDeps): Promise<NotifyResult> {
  const nowIso = deps.now();
  const nowMs = Date.parse(nowIso);

  const rows = deps.db
    .select({
      requestId: linkRequests.requestId,
      createdAt: linkRequests.createdAt,
      zaloUserId: customers.zaloUserId,
    })
    .from(linkRequests)
    .innerJoin(customers, eq(linkRequests.customerId, customers.customerId))
    .where(
      and(
        eq(linkRequests.status, "failed"),
        isNull(linkRequests.notifiedAt),
        isNotNull(customers.zaloUserId),
        ne(customers.role, "house"),
      ),
    )
    .orderBy(linkRequests.createdAt)
    .all();

  const stale = rows.filter((row) => isStale(row.createdAt, nowMs));
  if (stale.length > 0) {
    deps.db
      .update(linkRequests)
      .set({ notifiedAt: nowIso })
      .where(inArray(linkRequests.requestId, stale.map((row) => row.requestId)))
      .run();
  }

  let sent = 0;
  for (const row of rows.filter((candidate) => !isStale(candidate.createdAt, nowMs))) {
    if (!row.zaloUserId) continue;
    if (!(await deps.delivery.sendPrivate(row.zaloUserId, render(deps.messages, "link_failed")))) {
      continue;
    }
    deps.db
      .update(linkRequests)
      .set({ notifiedAt: nowIso })
      .where(eq(linkRequests.requestId, row.requestId))
      .run();
    sent += 1;
  }

  return { sent, failed: rows.length - stale.length - sent };
}
