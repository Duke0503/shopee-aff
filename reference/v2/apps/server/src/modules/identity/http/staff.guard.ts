import {
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import { eq } from "drizzle-orm";

import type { Db } from "../../../shared/database/connection";
import { DB } from "../../../shared/database/database.module";
import { customers } from "../../../shared/database/schema";
import { nowLocalIso } from "../application/sign-in.use-case";
import { parseSessionToken } from "../domain/session-cookie";
import { findSessionCustomer } from "../infrastructure/session.repository";
import type { AuthenticatedRequest } from "./session.guard";

/** The staff area: a logged-in admin OR employee may look, only admin may change. */
@Injectable()
export class StaffGuard implements CanActivate {
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
    if (!row || (row.role !== "admin" && row.role !== "employee")) {
      throw new ForbiddenException("staff only");
    }

    request.customerId = customerId;
    return true;
  }
}
