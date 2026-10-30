import { ForbiddenException, Inject, Injectable, UnauthorizedException, type CanActivate, type ExecutionContext } from "@nestjs/common";
import { eq } from "drizzle-orm";

import type { Db } from "../../../shared/database/connection";
import { DB } from "../../../shared/database/database.module";
import { customers } from "../../../shared/database/schema";
import { nowLocalIso } from "../application/sign-in.use-case";
import { parseSessionToken } from "../domain/session-cookie";
import { findSessionCustomer } from "../infrastructure/session.repository";
import type { AuthenticatedRequest } from "./session.guard";

/** Admin console, payouts, customer editing: a logged-in admin only. */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(@Inject(DB) private readonly db: Db) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const cookie = typeof request.headers.cookie === "string" ? request.headers.cookie : null;
    const token = parseSessionToken(cookie);
    const customerId = token ? findSessionCustomer(this.db, token, nowLocalIso()) : null;
    if (!customerId) throw new UnauthorizedException("not signed in");

    const row = this.db
      .select({ role: customers.role })
      .from(customers)
      .where(eq(customers.customerId, customerId))
      .get();
    if (!row || row.role !== "admin") throw new ForbiddenException("admin only");

    request.customerId = customerId;
    return true;
  }
}
