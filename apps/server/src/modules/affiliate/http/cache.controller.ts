import { Controller, Get, Inject } from "@nestjs/common";

import type { Db } from "../../../shared/database/connection";
import { DB } from "../../../shared/database/database.module";
import { cacheStats } from "../application/list-cache-stats.use-case";

/** How much the Shopee price lookups have cached, and the most asked-for items. */
@Controller("api/shopee/cache")
export class CacheController {
  constructor(@Inject(DB) private readonly db: Db) {}

  @Get("stats")
  stats() {
    return cacheStats(this.db);
  }
}
