import { Controller, Get, Inject, UseGuards } from "@nestjs/common";

import type { Db } from "../../../shared/database/connection";
import { DB } from "../../../shared/database/database.module";
import { AdminGuard, nowLocalIso } from "../../identity";
import { collectPayablesFromDb } from "../infrastructure/payables.repository";

@Controller("api/payouts")
@UseGuards(AdminGuard)
export class PayoutsController {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** Who can be paid now (ready), and who is blocked by a missing bank account. */
  @Get()
  list() {
    return collectPayablesFromDb(this.db, nowLocalIso());
  }
}
