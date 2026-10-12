import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Post,
  UseGuards,
} from "@nestjs/common";
import { eq } from "drizzle-orm";

import type { Db } from "../../../shared/database/connection";
import { DB } from "../../../shared/database/database.module";
import { customers } from "../../../shared/database/schema";
import { AdminGuard, nowLocalIso } from "../../identity";
import { recordTransferForCustomer } from "../application/record-transfer.use-case";
import { decodeOrderIds, listTransfers } from "../infrastructure/payment-transfer.repository";

interface RecordTransferBody {
  customer_id?: string;
  order_ids?: string[];
  amount?: number | string;
  note?: string;
  transfer_code?: string;
  proof_image?: string;
}

/** The figure the caller expected, or null when they did not send one. */
function expectedAmount(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const amount = Number(value);
  if (!Number.isFinite(amount)) throw new BadRequestException("amount must be a number");
  return Math.trunc(amount);
}

/**
 * Transfers already made to customers. Recording one is owner work (it moves
 * money out), so the whole controller is admin-only.
 *
 * The AMOUNT is never taken from the request: it is computed from the orders
 * the transfer covers — the ones named, or everything approved and unpaid —
 * through the same payout path as `POST /api/admin/payments/confirm`. An
 * `amount` from the caller is only checked against that figure, so a stale
 * screen cannot record the wrong sum.
 */
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

  @Post()
  record(@Body() body: RecordTransferBody) {
    const customerId = (body?.customer_id ?? "").trim();
    if (!customerId) throw new BadRequestException("customer_id is required");

    const customer = this.db
      .select({ customerId: customers.customerId })
      .from(customers)
      .where(eq(customers.customerId, customerId))
      .get();
    if (!customer) throw new NotFoundException("unknown customer");

    const result = recordTransferForCustomer(this.db, {
      customerId,
      orderIds: Array.isArray(body?.order_ids) ? body.order_ids.map(String) : [],
      expectedAmountVnd: expectedAmount(body?.amount),
      note: (body?.note ?? "").trim(),
      transferCode: (body?.transfer_code ?? "").trim(),
      proofImage: (body?.proof_image ?? "").trim(),
      nowIso: nowLocalIso(),
    });
    if (!result.ok) throw new BadRequestException(result.reason ?? "transfer failed");

    return {
      ok: true,
      transferId: result.transferId,
      amountVnd: result.amountVnd,
      billToken: result.billToken,
      billPath: `/b/${result.billToken}`,
    };
  }
}
