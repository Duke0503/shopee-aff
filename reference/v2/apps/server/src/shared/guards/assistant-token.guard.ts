import { timingSafeEqual } from "node:crypto";

import { Injectable, UnauthorizedException, type CanActivate, type ExecutionContext } from "@nestjs/common";

interface RequestWithHeaders {
  headers: Record<string, string | string[] | undefined>;
}

function tokensMatch(expected: string, provided: string): boolean {
  const left = Buffer.from(expected);
  const right = Buffer.from(provided);
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * Protects every route on the INTERNAL listener (ADR-16). The source address
 * is never proof of who is calling; only a matching X-Assistant-Token is.
 * The token is compared in constant time.
 */
@Injectable()
export class AssistantTokenGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const expected = process.env.ASSISTANT_TOKEN ?? "";
    const request = context.switchToHttp().getRequest<RequestWithHeaders>();
    const header = request.headers["x-assistant-token"];
    const provided = Array.isArray(header) ? header[0] : header;

    if (!expected || !provided || !tokensMatch(expected, provided)) {
      throw new UnauthorizedException("invalid assistant token");
    }
    return true;
  }
}
