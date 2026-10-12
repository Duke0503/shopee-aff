import { Controller, Get, Inject, Query } from "@nestjs/common";

import { MESSAGES, type Messages } from "../../../notifications";
import { listTopDeals } from "../application/list-top-deals.use-case";
import { ACCESSTRADE_CLIENT, type AccessTradeFeedPort } from "../providers/accesstrade.client";

/** What is selling well on TikTok Shop right now, for the bot's deal round. */
@Controller("api/tiktok")
export class TikTokController {
  constructor(
    @Inject(MESSAGES) private readonly messages: Messages,
    @Inject(ACCESSTRADE_CLIENT) private readonly accessTrade: AccessTradeFeedPort,
  ) {}

  @Get("topdeal")
  topDeal(@Query("q") q?: string, @Query("limit") limit?: string) {
    return listTopDeals(this.accessTrade, this.messages, {
      keyword: q,
      limit: Number((limit ?? "").trim() || "5"),
    });
  }
}
