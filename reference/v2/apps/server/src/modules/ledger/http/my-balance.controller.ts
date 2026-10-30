import { Controller, Get, Inject, Req, UseGuards } from "@nestjs/common";

import type { Db } from "../../../shared/database/connection";
import { DB } from "../../../shared/database/database.module";
import { SessionGuard, type AuthenticatedRequest } from "../../identity";
import { computeBalanceFor } from "../infrastructure/balance.repository";

/** A customer's own balance. The amount is computed on the server, never the client. */
@Controller("api/me/balance")
@UseGuards(SessionGuard)
export class MyBalanceController {
  constructor(@Inject(DB) private readonly db: Db) {}

  @Get()
  balance(@Req() request: AuthenticatedRequest) {
    return computeBalanceFor(this.db, request.customerId ?? "");
  }
}
