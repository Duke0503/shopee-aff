import { windowOpen } from "./campaign";

/**
 * "Is there a running event this customer could still win a slot in?"
 * Ports `ledger/campaigns.py::offer_for`. Everything a customer is told here
 * must be true: a slot already promised is not offered twice.
 */
export interface OfferCandidate {
  campaignId: string;
  name: string;
  startsAt: string;
  endsAt: string;
  slots: number;
  bonusVnd: number;
  minOrderValueVnd: number;
  perCustomer: number;
  platforms: string[];
  excludedCustomerIds: string[];
  liveSlots: number;
  heldByCustomer: number;
}

export interface CampaignOffer {
  name: string;
  bonus: number;
  slots: number;
  left: number;
  minOrderValue: number;
  perCustomer: number;
}

export interface OfferQuery {
  customerId: string;
  role: string | null;
  platform: string;
  nowIso: string;
}

/**
 * The first candidate that still has something to give, or null when there is
 * nothing honest to say: staff or the house account, an excluded customer, one
 * already at their per-customer cap, a platform the event does not cover, an
 * event that is not running, or one whose slots are all gone.
 */
export function offerFor(candidates: OfferCandidate[], query: OfferQuery): CampaignOffer | null {
  if ((query.role ?? "user") !== "user") return null;

  for (const campaign of candidates) {
    if (!windowOpen(campaign.startsAt, campaign.endsAt, query.nowIso)) continue;
    if (!campaign.platforms.includes(query.platform)) continue;
    if (campaign.excludedCustomerIds.includes(query.customerId)) continue;
    if (campaign.perCustomer > 0 && campaign.heldByCustomer >= campaign.perCustomer) continue;

    const left = campaign.slots - campaign.liveSlots;
    if (left <= 0) continue;

    return {
      name: campaign.name,
      bonus: campaign.bonusVnd,
      slots: campaign.slots,
      left,
      minOrderValue: campaign.minOrderValueVnd,
      perCustomer: campaign.perCustomer,
    };
  }
  return null;
}
