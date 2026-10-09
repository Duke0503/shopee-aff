import { and, eq, isNotNull, isNull, ne, or } from "drizzle-orm";

import type { DeliveryPort, NotifyResult } from "../../../notifications/delivery";
import { formatVnd, render, type Messages } from "../../../notifications/messages";
import type { Db } from "../../../shared/database/connection";
import { campaignAwards, campaigns, customers, linkRequests, orders } from "../../../shared/database/schema";
import { evaluateCampaigns, standingForOrder, AWARD_VOID, windowOpen } from "../infrastructure/campaign.repository";

/**
 * Telling a customer the moment they win a campaign slot, and when they lose
 * one. Ports the "campaign changes" step, which runs FIRST so an order already
 * carries its bonus by the time it is announced. A slot won by an order not yet
 * announced rides on that order's own message instead. As everywhere else, a
 * row is marked notified only after the assistant confirms delivery.
 */
export interface NotifyCampaignChangesDeps {
  db: Db;
  delivery: DeliveryPort;
  messages: Messages;
  now: () => string;
}

interface PendingAward {
  id: number;
  status: string;
  orderId: string;
  amount: number;
  name: string;
  slots: number;
  startsAt: string;
  endsAt: string;
  affiliateUrl: string | null;
  sourceUrl: string | null;
  zaloUserId: string | null;
}

/** What the customer recognises: the product, then the link they were given. */
function identityBlock(messages: Messages, row: PendingAward): string {
  const product = render(messages, "order_fallback_name", { order_id: row.orderId });
  const lines = [render(messages, "order_identity_product", { product })];
  const link = row.affiliateUrl ?? row.sourceUrl;
  if (link) lines.push(render(messages, "order_identity_link", { link }));
  return `${lines.join("\n")}\n\n`;
}

function pendingAwards(db: Db): PendingAward[] {
  return db
    .select({
      id: campaignAwards.id,
      status: campaignAwards.status,
      orderId: campaignAwards.orderId,
      amount: campaignAwards.amount,
      name: campaigns.name,
      slots: campaigns.slots,
      startsAt: campaigns.startsAt,
      endsAt: campaigns.endsAt,
      affiliateUrl: linkRequests.affiliateUrl,
      sourceUrl: linkRequests.sourceUrl,
      zaloUserId: customers.zaloUserId,
    })
    .from(campaignAwards)
    .innerJoin(campaigns, eq(campaignAwards.campaignId, campaigns.campaignId))
    .innerJoin(customers, eq(campaignAwards.customerId, customers.customerId))
    .innerJoin(orders, eq(campaignAwards.orderId, orders.orderId))
    .leftJoin(linkRequests, eq(orders.requestId, linkRequests.requestId))
    .where(
      and(
        isNotNull(customers.zaloUserId),
        or(
          and(
            isNull(campaignAwards.notifiedStatus),
            ne(campaignAwards.status, AWARD_VOID),
            isNotNull(orders.notifiedStatus),
          ),
          and(
            eq(campaignAwards.status, AWARD_VOID),
            isNotNull(campaignAwards.notifiedStatus),
            ne(campaignAwards.notifiedStatus, AWARD_VOID),
          ),
        ),
      ),
    )
    .all();
}

function awardText(messages: Messages, db: Db, row: PendingAward, nowIso: string): string | null {
  if (row.status === AWARD_VOID) {
    const running = windowOpen(row.startsAt, row.endsAt, nowIso);
    return render(messages, running ? "campaign_slot_lost" : "campaign_slot_lost_ended", {
      name: row.name,
      identity: identityBlock(messages, row),
    });
  }
  const standing = standingForOrder(db, row.orderId);
  if (!standing) return null;
  return render(messages, "campaign_slot_held", {
    name: row.name,
    rank: standing.rank,
    slots: row.slots,
    bonus: formatVnd(messages, row.amount),
    identity: identityBlock(messages, row),
  });
}

export async function notifyCampaignChanges(deps: NotifyCampaignChangesDeps): Promise<NotifyResult> {
  const nowIso = deps.now();
  evaluateCampaigns(deps.db, nowIso);

  const rows = pendingAwards(deps.db);
  let sent = 0;
  for (const row of rows) {
    if (!row.zaloUserId) continue;
    const text = awardText(deps.messages, deps.db, row, nowIso);
    if (!text) continue;
    if (!(await deps.delivery.sendPrivate(row.zaloUserId, text))) continue;
    deps.db
      .update(campaignAwards)
      .set({ notifiedStatus: row.status })
      .where(eq(campaignAwards.id, row.id))
      .run();
    sent += 1;
  }
  return { sent, failed: rows.length - sent };
}
