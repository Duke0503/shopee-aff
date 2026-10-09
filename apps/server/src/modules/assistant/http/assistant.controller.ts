import {
  BadRequestException,
  Body,
  Controller,
  Delete,
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
  issuePassword,
  nowLocalIso,
  registerFromZalo,
  saveBankDetails,
  eraseBankDetails,
  type CustomerRole,
} from "../../identity";
import { computeBalanceFor } from "../../ledger";
import { listOrders, toOrderResponse } from "../../orders";

interface BankBody {
  bankName?: string;
  bankAccount?: string;
  accountHolder?: string;
}

interface RegisterBody {
  zaloUserId?: string;
  displayName?: string;
  privateChatId?: string;
}

type CustomerRow = typeof customers.$inferSelect;

/**
 * The assistant's view of a customer, addressed by any identifier the person
 * can type (DP code, Zalo UID, old id, alias).
 *
 * This covers what the old `POST /api/bot/customer-auth` did in one call:
 * first-contact registration, the customer's own code, their orders, their
 * balance, issuing a password and reading/saving bank details.
 *
 * Only the INTERNAL listener mounts this module, and every call needs the
 * assistant token (ADR-16) — the caller's address is never proof of anything.
 */
@Controller("internal/customers")
@UseGuards(AssistantTokenGuard)
export class AssistantController {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** First contact: the assistant has just met this person on Zalo. */
  @Post()
  register(@Body() body: RegisterBody) {
    const zaloUserId = (body.zaloUserId ?? "").trim();
    if (!zaloUserId) throw new BadRequestException("zaloUserId is required");
    const result = registerFromZalo(this.db, {
      zaloUserId,
      displayName: (body.displayName ?? "").trim() || null,
      privateChatId: (body.privateChatId ?? "").trim(),
      nowIso: nowLocalIso(),
    });
    return { ...this.profile(this.customer(result.customerId)), created: result.created };
  }

  @Get(":key")
  resolve(@Param("key") key: string) {
    return this.profile(this.customer(key));
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

  @Get(":key/bank")
  bank(@Param("key") key: string) {
    const row = this.customer(key);
    return {
      hasBank: Boolean(row.bankAccount),
      bankName: row.bankName,
      bankAccount: row.bankAccount,
      accountHolder: row.accountHolder,
    };
  }

  /** `/matkhau`: a fresh password, returned once and never readable again. */
  @Post(":key/password")
  password(@Param("key") key: string) {
    const customerId = this.customer(key).customerId;
    const issued = issuePassword(this.db, customerId, nowLocalIso());
    if (!issued) throw new NotFoundException("customer not found");
    return { ...this.profile(this.customer(customerId)), password: issued.password };
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

  /** `/xoathongtin`: erase the saved account so payouts stop going to it. */
  @Delete(":key/bank")
  eraseBank(@Param("key") key: string) {
    const row = this.customer(key);
    if (isHouse({ role: row.role as CustomerRole })) {
      throw new ForbiddenException("the guest account has no bank details");
    }
    this.db
      .update(customers)
      .set(eraseBankDetails())
      .where(eq(customers.customerId, row.customerId))
      .run();
    return { ok: true };
  }

  private profile(row: CustomerRow) {
    return {
      customerId: row.customerId,
      customerCode: row.customerCode,
      displayName: row.displayName,
      role: row.role,
    };
  }

  private customer(key: string): CustomerRow {
    const customerId = findCustomerIdByAnyId(this.db, key);
    if (!customerId) throw new NotFoundException("customer not found");
    const row = this.db.select().from(customers).where(eq(customers.customerId, customerId)).get();
    if (!row) throw new NotFoundException("customer not found");
    return row;
  }
}
