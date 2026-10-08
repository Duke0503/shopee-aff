import { Controller, Get, Inject } from "@nestjs/common";

import type { Db } from "../../../shared/database/connection";
import { DB } from "../../../shared/database/database.module";
import { listActiveDeals } from "../infrastructure/featured-deal.repository";

@Controller("api/deals")
export class DealsController {
  constructor(@Inject(DB) private readonly db: Db) {}

  @Get()
  list() {
    return listActiveDeals(this.db).map((deal) => ({
      id: deal.id,
      name: deal.name,
      platform: deal.platform,
      category: deal.category,
      originalPriceVnd: deal.originalPrice,
      salePriceVnd: deal.salePrice,
      cashbackVnd: deal.cashback,
      imageUrl: deal.imageUrl,
      url: deal.url,
    }));
  }
}
