import { BadRequestException, Body, Controller, Get, Inject, Post, UseGuards } from "@nestjs/common";

import type { Db } from "../../../shared/database/connection";
import { DB } from "../../../shared/database/database.module";
import { AdminGuard, nowLocalIso } from "../../identity";
import { createCampaign } from "../application/create-campaign.use-case";
import { listCampaigns } from "../infrastructure/campaign.repository";

interface CreateCampaignBody {
  campaign_id?: unknown;
  name?: unknown;
  starts_at?: unknown;
  ends_at?: unknown;
  slots?: unknown;
  bonus_vnd?: unknown;
  min_order_value?: unknown;
  platforms?: unknown;
  per_customer?: unknown;
}

const text = (value: unknown): string => (typeof value === "string" ? value : "");

/** The Python's `int(body.get(x) or default)`: empty or zero falls back. */
function intOrDefault(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed === 0) return fallback;
  return Math.trunc(parsed);
}

@Controller("api/admin/campaigns")
@UseGuards(AdminGuard)
export class CampaignsController {
  constructor(@Inject(DB) private readonly db: Db) {}

  @Get()
  list() {
    return listCampaigns(this.db).map((campaign) => ({
      campaignId: campaign.campaignId,
      name: campaign.name,
      startsAt: campaign.startsAt,
      endsAt: campaign.endsAt,
      slots: campaign.slots,
      bonusVnd: campaign.bonusVnd,
      perCustomer: campaign.perCustomer,
      status: campaign.status,
    }));
  }

  @Post()
  create(@Body() body: CreateCampaignBody) {
    const result = createCampaign(
      this.db,
      {
        campaignId: text(body?.campaign_id),
        name: text(body?.name),
        startsAt: text(body?.starts_at),
        endsAt: text(body?.ends_at),
        slots: intOrDefault(body?.slots, 20),
        bonusVnd: intOrDefault(body?.bonus_vnd, 20_000),
        minOrderValue: intOrDefault(body?.min_order_value, 0),
        platforms: text(body?.platforms) || "shopee,shopeefood,tiktok",
        perCustomer: intOrDefault(body?.per_customer, 0),
      },
      nowLocalIso(),
    );

    if (!result.ok) {
      throw new BadRequestException(
        result.reason === "duplicate_id"
          ? "that campaign id already exists"
          : "campaign_id, name, starts_at and ends_at are required",
      );
    }
    return { ok: true, campaignId: result.campaignId };
  }
}
