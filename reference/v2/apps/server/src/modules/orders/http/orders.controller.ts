import { BadRequestException, Body, Controller, Inject, Post, UseGuards } from "@nestjs/common";

import type { Db } from "../../../shared/database/connection";
import { DB } from "../../../shared/database/database.module";
import { AdminGuard, nowLocalIso } from "../../identity";
import { findOrder, markPaid, settleOrdersForBatch } from "../infrastructure/order.repository";

interface MarkPaidBody {
  customer_id?: string;
  order_ids?: string[];
}

interface SettleBody {
  batch_id?: string;
  platform?: string;
  order_ids?: string[];
  settled_at?: string;
}

@Controller("api/admin/orders")
@UseGuards(AdminGuard)
export class OrdersController {
  constructor(@Inject(DB) private readonly db: Db) {}

  /**
   * Records a transfer that already happened in the banking app. Every order of
   * the lot is marked together, and only orders of the given customer that are
   * approved and unpaid are touched — so a double click can never pay twice.
   */
  @Post("mark-paid")
  markPaid(@Body() body: MarkPaidBody) {
    const orderIds = Array.isArray(body?.order_ids) ? body.order_ids : null;
    if (!orderIds) throw new BadRequestException("order_ids must be a list");

    let paid = 0;
    const skipped: string[] = [];
    for (const rawId of orderIds) {
      const orderId = String(rawId);
      const order = findOrder(this.db, orderId);
      if (!order || order.customerId !== body.customer_id || order.status !== "approved" || order.paidAt !== null) {
        skipped.push(orderId);
        continue;
      }
      markPaid(this.db, orderId, nowLocalIso());
      paid += 1;
    }

    if (paid === 0) return { ok: false, message: "nothing to mark", paid, skipped };
    return { ok: true, paid, skipped };
  }

  /**
   * Marks orders settled by a platform payout batch (the money the platform
   * sent us). Re-running is safe: an order already settled is never touched.
   */
  @Post("settle")
  settle(@Body() body: SettleBody) {
    const settledCount = settleOrdersForBatch(this.db, {
      platform: (body?.platform ?? "shopee").trim() || "shopee",
      batchId: (body?.batch_id ?? "MANUAL").trim() || "MANUAL",
      settledAt: body?.settled_at ?? nowLocalIso(),
      nowIso: nowLocalIso(),
      orderIds: Array.isArray(body?.order_ids) ? body.order_ids.map(String) : undefined,
    });
    return { ok: true, settledCount };
  }
}
