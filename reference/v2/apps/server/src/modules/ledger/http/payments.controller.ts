import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { eq } from "drizzle-orm";

import { DELIVERY_PORT, MESSAGES, render, type DeliveryPort, type Messages } from "../../../notifications";
import type { Db } from "../../../shared/database/connection";
import { DB } from "../../../shared/database/database.module";
import { customers } from "../../../shared/database/schema";
import { StaffGuard, nowLocalIso } from "../../identity";
import { findOrder } from "../../orders";
import { confirmPayout } from "../application/confirm-payout.use-case";
import { listPayments } from "../application/list-payments.use-case";
import { planPaymentFor } from "../application/plan-payment.use-case";

interface ConfirmBody {
  customer_id?: string;
  order_ids?: string[];
  note?: string;
  transfer_code?: string;
}

interface AskBankBody {
  customer_id?: string;
}

/**
 * The money-out desk. `confirm` records a transfer that already happened in the
 * banking app; the AMOUNT is computed by the ledger from the orders and their
 * confirmed campaign bonuses, never taken from the request, so a wrong figure
 * cannot reach the bank. The orders are then marked paid through Orders'
 * guarded `markPaid` — never twice — and their bonuses settled.
 */
@Controller("api/admin/payments")
@UseGuards(StaffGuard)
export class PaymentsController {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(DELIVERY_PORT) private readonly delivery: DeliveryPort,
    @Inject(MESSAGES) private readonly messages: Messages,
  ) {}

  /** Everyone who can be paid now, who they are, plus the transfers recorded. */
  @Get()
  list() {
    return { ok: true, ...listPayments(this.db, nowLocalIso()) };
  }

  /**
   * What paying one customer right now would cover: their payable orders, the
   * confirmed bonuses riding with them, the server's total, the memo, and a
   * VietQR when the bank matches for certain. Nothing is recorded.
   */
  @Get("plan")
  plan(@Query("customer_id") customerId?: string) {
    const id = (customerId ?? "").trim();
    if (!id) throw new BadRequestException("customer_id is required");
    const plan = planPaymentFor(this.db, id);
    if (plan === null) throw new NotFoundException("unknown customer");
    return { ok: true, ...plan };
  }

  @Post("confirm")
  confirm(@Body() body: ConfirmBody) {
    const customerId = (body?.customer_id ?? "").trim();
    if (!customerId) throw new BadRequestException("customer_id is required");

    const orderIds = Array.isArray(body?.order_ids) ? body.order_ids.map(String) : [];
    if (orderIds.length === 0) throw new BadRequestException("order_ids must be a non-empty list");

    for (const orderId of orderIds) {
      const order = findOrder(this.db, orderId);
      if (!order || order.customerId !== customerId) {
        throw new BadRequestException(`order ${orderId} does not belong to ${customerId}`);
      }
    }

    const result = confirmPayout(this.db, {
      customerId,
      orderIds,
      note: body?.note ?? "",
      transferCode: body?.transfer_code ?? "",
      nowIso: nowLocalIso(),
    });
    if (!result.ok) throw new BadRequestException(result.reason ?? "payout failed");
    return {
      ok: true,
      transferId: result.transferId,
      amountVnd: result.amountVnd,
      billToken: result.billToken,
      billPath: `/b/${result.billToken}`,
    };
  }

  /** Have the bot ask one customer for a bank account, privately. */
  @Post("ask-bank")
  async askBank(@Body() body: AskBankBody) {
    const customerId = (body?.customer_id ?? "").trim();
    if (!customerId) throw new BadRequestException("customer_id is required");

    const row = this.db
      .select({ zaloUserId: customers.zaloUserId })
      .from(customers)
      .where(eq(customers.customerId, customerId))
      .get();
    if (!row) throw new NotFoundException("unknown customer");
    if (!row.zaloUserId) throw new BadRequestException("customer has no Zalo id");

    const sent = await this.delivery.sendPrivate(row.zaloUserId, render(this.messages, "need_bank"));
    return { ok: sent };
  }
}
