import { and, eq, isNotNull, isNull, ne } from "drizzle-orm";

import type { DeliveryPort, NotifyResult } from "../../../notifications/delivery";
import { render, type Messages } from "../../../notifications/messages";
import type { Db } from "../../../shared/database/connection";
import { customers, linkRequests } from "../../../shared/database/schema";

/**
 * Sending links nobody collected. Ports the "late links" step. Whoever hands a
 * link to the customer (the assistant in chat, the web page) marks it
 * delivered; a link still unclaimed after the assistant's own wait was finished
 * too late for the chat, and goes out here as a private message. Idempotent via
 * `notified_at`, so a restart never sends twice; a link older than the stale
 * window is marked and dropped rather than spammed after an outage.
 *
 * The wording here is the no-estimate one: the commission/price breakdown needs
 * the source provider, which is not ported yet. Saying "a share of the real
 * commission" is honest; inventing a figure is not.
 */
export const LINK_ASSISTANT_WAIT_MS = 55 * 1000;
export const LINK_STALE_MS = 2 * 60 * 60 * 1000;

export interface NotifyLateLinksDeps {
  db: Db;
  delivery: DeliveryPort;
  messages: Messages;
  now: () => string;
  /** The advertised cashback rate, e.g. 0.8 for "80%". */
  cashbackRate: number;
}

function ageMs(createdAt: string, nowMs: number): number {
  const createdMs = Date.parse(createdAt);
  if (Number.isNaN(createdMs)) return Number.POSITIVE_INFINITY;
  return nowMs - createdMs;
}

function percent(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

export async function notifyLateLinks(deps: NotifyLateLinksDeps): Promise<NotifyResult> {
  const nowIso = deps.now();
  const nowMs = Date.parse(nowIso);

  const rows = deps.db
    .select({
      requestId: linkRequests.requestId,
      createdAt: linkRequests.createdAt,
      affiliateUrl: linkRequests.affiliateUrl,
      zaloUserId: customers.zaloUserId,
    })
    .from(linkRequests)
    .innerJoin(customers, eq(linkRequests.customerId, customers.customerId))
    .where(
      and(
        isNotNull(linkRequests.affiliateUrl),
        ne(linkRequests.affiliateUrl, ""),
        isNull(linkRequests.notifiedAt),
        isNotNull(customers.zaloUserId),
        ne(customers.role, "house"),
      ),
    )
    .orderBy(linkRequests.createdAt)
    .all();

  const stale = rows.filter((row) => {
    const age = ageMs(row.createdAt, nowMs);
    return age < 0 || age > LINK_STALE_MS;
  });
  if (stale.length > 0) {
    for (const row of stale) {
      deps.db
        .update(linkRequests)
        .set({ notifiedAt: nowIso })
        .where(eq(linkRequests.requestId, row.requestId))
        .run();
    }
  }

  const ready = rows.filter((row) => {
    const age = ageMs(row.createdAt, nowMs);
    return age > LINK_ASSISTANT_WAIT_MS && age <= LINK_STALE_MS;
  });

  let sent = 0;
  for (const row of ready) {
    if (!row.zaloUserId || !row.affiliateUrl) continue;
    const text = render(deps.messages, "link_ready_no_estimate", {
      link: row.affiliateUrl,
      rate: percent(deps.cashbackRate),
      tax_clause: "",
      days: render(deps.messages, "payout_window"),
    });
    if (!(await deps.delivery.sendPrivate(row.zaloUserId, text))) continue;
    deps.db
      .update(linkRequests)
      .set({ notifiedAt: nowIso })
      .where(eq(linkRequests.requestId, row.requestId))
      .run();
    sent += 1;
  }

  return { sent, failed: ready.length - sent };
}
