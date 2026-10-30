import { eq } from "drizzle-orm";

import type { Db } from "../../../shared/database/connection";
import { customers } from "../../../shared/database/schema";
import { findCustomerIdByAnyId } from "../../identity";
import { offerFor, type CampaignOffer } from "../domain/campaign-offer";
import {
  activeCampaigns,
  liveCounts,
  liveTotal,
  splitList,
} from "../infrastructure/campaign.repository";

export interface CampaignOfferInput {
  customerKey: string;
  platform: string;
  nowIso: string;
}

/**
 * Answers the assistant's "can this customer still win something on this
 * platform?" question. The customer key may be an id, a code or an alias; a
 * key that matches nobody answers null, not an error, because the caller only
 * wants to know what it may honestly say.
 */
export function campaignOffer(db: Db, input: CampaignOfferInput): CampaignOffer | null {
  const customerId = findCustomerIdByAnyId(db, input.customerKey);
  if (!customerId) return null;

  const row = db
    .select({ role: customers.role })
    .from(customers)
    .where(eq(customers.customerId, customerId))
    .get();
  if (!row) return null;

  const candidates = activeCampaigns(db).map((campaign) => ({
    campaignId: campaign.campaignId,
    name: campaign.name,
    startsAt: campaign.startsAt,
    endsAt: campaign.endsAt,
    slots: campaign.slots,
    bonusVnd: campaign.bonusVnd,
    minOrderValueVnd: campaign.minOrderValue,
    perCustomer: campaign.perCustomer,
    platforms: splitList(campaign.platforms),
    excludedCustomerIds: splitList(campaign.excludedCustomers),
    liveSlots: liveTotal(db, campaign.campaignId),
    heldByCustomer: liveCounts(db, campaign.campaignId).get(customerId) ?? 0,
  }));

  return offerFor(candidates, {
    customerId,
    role: row.role,
    platform: input.platform,
    nowIso: input.nowIso,
  });
}
