import { Controller, Get, Inject, UseGuards } from "@nestjs/common";

import type { Db } from "../../../shared/database/connection";
import { DB } from "../../../shared/database/database.module";
import { AdminGuard } from "../../identity/http/admin.guard";
import { decodeOrderIds, listTransfers } from "../infrastructure/payment-transfer.repository";

@Controller("api/admin/transfers")
@UseGuards(AdminGuard)
export class TransfersController {
  constructor(@Inject(DB) private readonly db: Db) {}

  @Get()
  list() {
    return listTransfers(this.db).map((transfer) => ({
      id: transfer.id,
      customerId: transfer.customerId,
      amountVnd: transfer.amount,
      note: transfer.note,
      orderIds: decodeOrderIds(transfer.orderIds),
      createdAt: transfer.createdAt,
    }));
  }
}
