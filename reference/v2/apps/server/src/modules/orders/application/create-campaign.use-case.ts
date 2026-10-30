import { campaignExists, insertCampaign } from "../infrastructure/campaign.repository";
import type { Db } from "../../../shared/database/connection";

export type CreateCampaignResult =
  | { ok: true; campaignId: string }
  | { ok: false; reason: "missing_fields" | "duplicate_id" };

export interface NewCampaignInput {
  campaignId: string;
  name: string;
  startsAt: string;
  endsAt: string;
  slots: number;
  bonusVnd: number;
  minOrderValue: number;
  platforms: string;
  perCustomer: number;
}

/**
 * Ports `_admin_create_campaign`. A campaign is data, not code: creating one is
 * one INSERT, and later events need no deploy. The four identifying fields are
 * required; everything else has a default.
 */
export function createCampaign(db: Db, input: NewCampaignInput, nowIso: string): CreateCampaignResult {
  const campaignId = (input.campaignId ?? "").trim();
  const name = (input.name ?? "").trim();
  const startsAt = (input.startsAt ?? "").trim();
  const endsAt = (input.endsAt ?? "").trim();

  if (!campaignId || !name || !startsAt || !endsAt) return { ok: false, reason: "missing_fields" };
  if (campaignExists(db, campaignId)) return { ok: false, reason: "duplicate_id" };

  insertCampaign(db, {
    campaignId,
    name,
    startsAt,
    endsAt,
    slots: input.slots,
    bonusVnd: input.bonusVnd,
    minOrderValue: input.minOrderValue,
    platforms: (input.platforms ?? "").trim() || "shopee,shopeefood,tiktok",
    perCustomer: input.perCustomer,
    createdAt: nowIso,
  });

  return { ok: true, campaignId };
}
