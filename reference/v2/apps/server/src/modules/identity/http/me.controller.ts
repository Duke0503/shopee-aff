import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  NotFoundException,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { eq } from "drizzle-orm";

import type { Db } from "../../../shared/database/connection";
import { DB } from "../../../shared/database/database.module";
import { customers } from "../../../shared/database/schema";
import { nowLocalIso } from "../application/sign-in.use-case";
import { eraseBankDetails, saveBankDetails } from "../domain/bank-details";
import { SessionGuard, type AuthenticatedRequest } from "./session.guard";

interface BankBody {
  bankName?: string;
  bankAccount?: string;
  accountHolder?: string;
}

@Controller("api/me")
@UseGuards(SessionGuard)
export class MeController {
  constructor(@Inject(DB) private readonly db: Db) {}

  @Get()
  me(@Req() request: AuthenticatedRequest) {
    const customerId = request.customerId ?? "";
    const row = this.db.select().from(customers).where(eq(customers.customerId, customerId)).get();
    if (!row) throw new NotFoundException("customer not found");
    return {
      customerId: row.customerId,
      customerCode: row.customerCode,
      displayName: row.displayName,
      role: row.role,
      hasBankDetails: Boolean(row.bankAccount),
    };
  }

  @Post("bank")
  saveBank(@Req() request: AuthenticatedRequest, @Body() body: BankBody) {
    const customerId = request.customerId ?? "";
    this.db
      .update(customers)
      .set(
        saveBankDetails(
          body.bankName ?? "",
          body.bankAccount ?? "",
          body.accountHolder ?? "",
          nowLocalIso(),
        ),
      )
      .where(eq(customers.customerId, customerId))
      .run();
    return { ok: true };
  }

  @Delete("bank")
  eraseBank(@Req() request: AuthenticatedRequest) {
    const customerId = request.customerId ?? "";
    this.db
      .update(customers)
      .set(eraseBankDetails())
      .where(eq(customers.customerId, customerId))
      .run();
    return { ok: true };
  }
}
