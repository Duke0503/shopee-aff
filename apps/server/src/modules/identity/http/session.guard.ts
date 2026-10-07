import { Inject, Injectable, UnauthorizedException, type CanActivate, type ExecutionContext } from "@nestjs/common";
import type { FastifyRequest } from "fastify";

import type { Db } from "../../../shared/database/connection";
import { DB } from "../../../shared/database/database.module";
import { nowLocalIso } from "../application/sign-in.use-case";
import { parseSessionToken } from "../domain/session-cookie";
import { findSessionCustomer } from "../infrastructure/session.repository";

/** A Fastify request with the signed-in customer attached by SessionGuard. */
export interface AuthenticatedRequest extends FastifyRequest {
  customerId?: string;
}

/**
 * Customer pages: a valid login cookie is the only way in. On success the
 * resolved customer id is attached to the request.
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(@Inject(DB) private readonly db: Db) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const cookie = typeof request.headers.cookie === "string" ? request.headers.cookie : null;
    const token = parseSessionToken(cookie);
    const customerId = token ? findSessionCustomer(this.db, token, nowLocalIso()) : null;
    if (!customerId) throw new UnauthorizedException("not signed in");
    request.customerId = customerId;
    return true;
  }
}
