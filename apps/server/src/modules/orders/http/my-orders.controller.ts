import { Controller, Get, Inject, Req, UseGuards } from "@nestjs/common";

import type { Db } from "../../../shared/database/connection";
import { DB } from "../../../shared/database/database.module";
import { SessionGuard, type AuthenticatedRequest } from "../../identity";
import { listOrders } from "../infrastructure/order.repository";

/** A customer's own orders. Session-guarded: you only ever see your own. */
@Controller("api/me/orders")
@UseGuards(SessionGuard)
export class MyOrdersController {
  constructor(@Inject(DB) private readonly db: Db) {}

  @Get()
  list(@Req() request: AuthenticatedRequest) {
    return listOrders(this.db, { customerId: request.customerId ?? "" }).map((order) => ({
      orderId: order.orderId,
      status: order.status,
      orderValueVnd: order.orderValue,
      cashbackVnd: order.cashbackAmount,
      recordedAt: order.recordedAt,
      paidAt: order.paidAt,
    }));
  }
}
