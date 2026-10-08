import { Controller, Get, Inject, UseGuards } from "@nestjs/common";

import type { Db } from "../../../shared/database/connection";
import { DB } from "../../../shared/database/database.module";
import { AdminGuard } from "../../identity/http/admin.guard";
import { listCampaigns } from "../infrastructure/campaign.repository";

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
}
