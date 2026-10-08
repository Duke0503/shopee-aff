import { Controller, Get, Inject, Query, UseGuards } from "@nestjs/common";

import type { Db } from "../../../shared/database/connection";
import { DB } from "../../../shared/database/database.module";
import { customers } from "../../../shared/database/schema";
import { AdminGuard } from "./admin.guard";

/** Admin customer list, optional search by code or display name. */
@Controller("api/admin/customers")
@UseGuards(AdminGuard)
export class CustomersController {
  constructor(@Inject(DB) private readonly db: Db) {}

  @Get()
  list(@Query("q") query?: string) {
    const rows = this.db.select().from(customers).all();
    const needle = (query ?? "").trim().toLowerCase();
    const filtered =
      needle === ""
        ? rows
        : rows.filter(
            (row) =>
              (row.customerCode ?? "").toLowerCase().includes(needle) ||
              (row.displayName ?? "").toLowerCase().includes(needle),
          );
    return filtered.slice(0, 100).map((row) => ({
      customerId: row.customerId,
      customerCode: row.customerCode,
      displayName: row.displayName,
      role: row.role,
      hasBankDetails: Boolean(row.bankAccount),
    }));
  }
}
