import { Controller, Get, Inject, Query } from "@nestjs/common";

import { MESSAGES, type Messages } from "../../../notifications";
import type { Db } from "../../../shared/database/connection";
import { DB } from "../../../shared/database/database.module";
import { listFnbDeals } from "../application/list-fnb-deals.use-case";
import { listFnbVouchers } from "../application/list-fnb-vouchers.use-case";

/**
 * The coffee-chain vouchers, public and unauthenticated: the assistant asks
 * for these before it knows which customer is asking, and a voucher carries
 * nobody's data.
 */
@Controller("api/fnb")
export class FnbController {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(MESSAGES) private readonly messages: Messages,
  ) {}

  /** The vouchers on offer, optionally for one brand or one voucher type. */
  @Get("vouchers")
  vouchers(@Query("brand") brand?: string, @Query("type") type?: string) {
    return listFnbVouchers(this.db, this.messages, { brand, type });
  }

  /** The handful worth broadcasting today. */
  @Get("deals-of-the-day")
  deals() {
    return listFnbDeals(this.db);
  }
}
