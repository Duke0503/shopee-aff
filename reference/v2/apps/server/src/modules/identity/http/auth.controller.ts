import {
  BadRequestException,
  Body,
  Controller,
  Inject,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";

import type { Db } from "../../../shared/database/connection";
import { DB } from "../../../shared/database/database.module";
import { changePassword } from "../application/change-password.use-case";
import { nowLocalIso, signIn } from "../application/sign-in.use-case";
import { SESSION_DAYS } from "../domain/password-policy";
import {
  buildSessionCookie,
  clearSessionCookie,
  parseSessionToken,
  sessionMaxAgeSeconds,
} from "../domain/session-cookie";
import { deleteSession } from "../infrastructure/session.repository";
import { SessionGuard, type AuthenticatedRequest } from "./session.guard";

interface LoginBody {
  name?: string;
  password?: string;
}

interface ChangePasswordBody {
  current?: string;
  replacement?: string;
}

@Controller("api/auth")
export class AuthController {
  constructor(@Inject(DB) private readonly db: Db) {}

  @Post("login")
  login(@Body() body: LoginBody, @Res({ passthrough: true }) reply: FastifyReply) {
    const result = signIn(this.db, body?.name ?? "", body?.password ?? "", nowLocalIso());
    if (!result.ok) throw new UnauthorizedException(result.reason ?? "bad_credentials");

    const maxAge = sessionMaxAgeSeconds(SESSION_DAYS);
    const expiresAt = new Date(Date.now() + maxAge * 1000).toUTCString();
    reply.header("Set-Cookie", buildSessionCookie(result.token ?? "", expiresAt, maxAge, false));
    return { ok: true, customerId: result.customerId };
  }

  @Post("logout")
  logout(@Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    const cookie = typeof request.headers.cookie === "string" ? request.headers.cookie : null;
    const token = parseSessionToken(cookie);
    if (token) deleteSession(this.db, token);
    reply.header("Set-Cookie", clearSessionCookie());
    return { ok: true };
  }

  /** A signed-in customer chooses their own password (ports /api/auth/password). */
  @Post("password")
  @UseGuards(SessionGuard)
  changePassword(@Req() request: AuthenticatedRequest, @Body() body: ChangePasswordBody) {
    const result = changePassword(
      this.db,
      request.customerId ?? "",
      body?.current ?? "",
      body?.replacement ?? "",
      nowLocalIso(),
    );
    if (result !== "ok") throw new BadRequestException(result);
    return { ok: true };
  }
}
