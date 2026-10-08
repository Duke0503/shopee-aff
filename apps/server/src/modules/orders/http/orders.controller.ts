import { Controller, Get, Inject, Query, UseGuards } from "@nestjs/common";

import type { Db } from "../../../shared/database/connection";
import { DB } from "../../../shared/database/database.module";
import { AdminGuard } from "../../identity";
import type { OrderStatus } from "../domain/order";
import { listOrders } from "../infrastructure/order.repository";

@Controller("api/admin/orders")
@UseGuards(AdminGuard)
export class OrdersController {
  constructor(@Inject(DB) private readonly db: Db) {}

  @Get()
  list(@Query("status") status?: OrderStatus) {
    return listOrders(this.db, status ? { status } : {}).map((order) => ({
      orderId: order.orderId,
      customerId: order.customerId,
      status: order.status,
      orderValueVnd: order.orderValue,
      approvedCommissionVnd: order.approvedCommission,
      cashbackVnd: order.cashbackAmount,
      recordedAt: order.recordedAt,
      paidAt: order.paidAt,
    }));
  }
}
