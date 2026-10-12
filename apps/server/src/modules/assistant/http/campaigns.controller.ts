import { BadRequestException, Controller, Get, Inject, Query, UseGuards } from "@nestjs/common";

import type { Db } from "../../../shared/database/connection";
import { DB } from "../../../shared/database/database.module";
import { AssistantTokenGuard } from "../../../shared/guards/assistant-token.guard";
import { nowLocalIso } from "../../identity";
import { campaignOffer } from "../../orders";

/**
 * The assistant's campaign question, on the internal listener only (ADR-16).
 * `offer` is null when there is nothing honest to say, never an error: the
 * assistant simply stays quiet.
 */
@Controller("internal/campaigns")
@UseGuards(AssistantTokenGuard)
export class AssistantCampaignsController {
  constructor(@Inject(DB) private readonly db: Db) {}

  @Get("offer")
  offer(@Query("customer_id") customerId?: string, @Query("platform") platform?: string) {
    const key = (customerId ?? "").trim();
    if (key === "") throw new BadRequestException("customer_id is required");

    const offer = campaignOffer(this.db, {
      customerKey: key,
      platform: (platform ?? "shopee").trim().toLowerCase() || "shopee",
      nowIso: nowLocalIso(),
    });
    return { ok: true, offer };
  }
}
