import { Controller, Get, Inject, Query, UseGuards } from "@nestjs/common";

import type { Db } from "../../../shared/database/connection";
import { DB } from "../../../shared/database/database.module";
import { AdminGuard, StaffGuard } from "../../identity";
import { listEmployees } from "../application/list-employees.use-case";
import { listLogs } from "../application/list-logs.use-case";
import { listUsers } from "../application/list-users.use-case";
import { computeMetrics } from "../application/metrics.use-case";
import { parsePage } from "../application/pagination";

type QueryParams = Record<string, string | undefined>;

const direction = (value?: string): "asc" | "desc" => (value === "asc" ? "asc" : "desc");
const lower = (value?: string): string => (value ?? "").trim().toLowerCase();

/**
 * The staff read surface: numbers, activity, customers and staff accounts.
 * Looking is open to admin and employee; staff accounts themselves are
 * admin-only, exactly as the old console behaved.
 */
@Controller("api/admin")
export class AdminReadController {
  constructor(@Inject(DB) private readonly db: Db) {}

  @Get("metrics")
  @UseGuards(StaffGuard)
  metrics() {
    return { ok: true, ...computeMetrics(this.db) };
  }

  @Get("logs")
  @UseGuards(StaffGuard)
  logs(@Query() query: QueryParams) {
    const page = parsePage(query, 25);
    return {
      ok: true,
      ...listLogs(this.db, {
        ...page,
        search: lower(query.search),
        action: query.action ?? "all",
        sortOrder: direction(query.sort_order),
      }),
    };
  }

  @Get("users")
  @UseGuards(StaffGuard)
  users(@Query() query: QueryParams) {
    const page = parsePage(query, 20);
    return {
      ok: true,
      ...listUsers(this.db, {
        ...page,
        search: lower(query.search),
        bank: query.bank ?? "all",
        sortBy: lower(query.sort_by),
        sortOrder: direction(query.sort_order),
      }),
    };
  }

  @Get("employees")
  @UseGuards(AdminGuard)
  employees(@Query() query: QueryParams) {
    const page = parsePage(query, 20);
    return {
      ok: true,
      ...listEmployees(this.db, {
        ...page,
        search: lower(query.search),
        role: query.role ?? "all",
        sortBy: lower(query.sort_by),
        sortOrder: direction(query.sort_order),
      }),
    };
  }
}
