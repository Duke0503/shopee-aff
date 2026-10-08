import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
import { eq } from "drizzle-orm";

import type { Db } from "../../../shared/database/connection";
import { DB } from "../../../shared/database/database.module";
import { customers } from "../../../shared/database/schema";
import { AssistantTokenGuard } from "../../../shared/guards/assistant-token.guard";
import {
  findCustomerIdByAnyId,
  isHouse,
  nowLocalIso,
  saveBankDetails,
  type CustomerRole,
} from "../../identity";
import { computeBalanceFor } from "../../ledger";
import { listOrders, toOrderResponse } from "../../orders";

interface BankBody {
  bankName?: string;
  bankAccount?: string;
  accountHolder?: string;
}

type CustomerRow = typeof customers.$inferSelect;

/**
 * The assistant's view of a customer, addressed by any identifier the person
 * can type (DP code, Zalo UID, old id, alias).
 *
 * Only the INTERNAL listener mounts this module, and every call needs the
 * assistant token (ADR-16) — the caller's address is never proof of anything.
 */
@Controller("internal/customers")
@UseGuards(AssistantTokenGuard)
export class AssistantController {
  constructor(@Inject(DB) private readonly db: Db) {}

  @Get(":key")
  resolve(@Param("key") key: string) {
    const row = this.customer(key);
    return {
      customerId: row.customerId,
      customerCode: row.customerCode,
      displayName: row.displayName,
      role: row.role,
    };
  }

  @Get(":key/orders")
  orders(@Param("key") key: string) {
    const customerId = this.customer(key).customerId;
    return listOrders(this.db, { customerId }).map(toOrderResponse);
  }

  @Get(":key/balance")
  balance(@Param("key") key: string) {
    return computeBalanceFor(this.db, this.customer(key).customerId);
  }

  @Post(":key/bank")
  saveBank(@Param("key") key: string, @Body() body: BankBody) {
    const row = this.customer(key);
    if (isHouse({ role: row.role as CustomerRole })) {
      throw new ForbiddenException("the guest account has no bank details");
    }
    const details = saveBankDetails(
      body.bankName ?? "",
      body.bankAccount ?? "",
      body.accountHolder ?? "",
      nowLocalIso(),
    );
    this.db.update(customers).set(details).where(eq(customers.customerId, row.customerId)).run();
    return { ok: true };
  }

  private customer(key: string): CustomerRow {
    const customerId = findCustomerIdByAnyId(this.db, key);
    if (!customerId) throw new NotFoundException("customer not found");
    const row = this.db.select().from(customers).where(eq(customers.customerId, customerId)).get();
    if (!row) throw new NotFoundException("customer not found");
    return row;
  }
}
