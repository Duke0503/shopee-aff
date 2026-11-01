/**
 * Internal routes (assistant, bridge, admin CLI) are authorized by their token header, never
 * by source address (AD-18, SECURITY_MODEL.md INV-7). A route marked with `ASSISTANT_ROUTE` is
 * the Zalo assistant's: only `X-Assistant-Token` with the assistant token opens it, and the
 * internal token does not. Every other route, unknown paths included, needs the internal token.
 * Tokens are compared in constant time.
 */
import { timingSafeEqual } from "node:crypto";
import { ASSISTANT_TOKEN_HEADER } from "@cashback/contracts";
import type { FastifyInstance, FastifyRequest } from "fastify";

import { tokensClash } from "../config/isolation.config";
import { HttpError } from "./error-envelope";

export const INTERNAL_TOKEN_HEADER = "x-internal-token";
export { ASSISTANT_TOKEN_HEADER };

/** Route config of an assistant route: `app.post(url, { config: ASSISTANT_ROUTE }, handler)`. */
export const ASSISTANT_ROUTE = { caller: "assistant" } as const;

export interface InternalTokens {
  readonly internal: string;
  /** Absent: no assistant token is configured and every assistant route answers 401. */
  readonly assistant?: string | null;
}

const MIN_TOKEN_LENGTH = 32;

function sameSecret(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

const isAssistantRoute = (request: FastifyRequest): boolean => (request.routeOptions.config as { caller?: unknown } | undefined)?.caller === ASSISTANT_ROUTE.caller;

export function requireInternalToken(app: FastifyInstance, tokens: string | InternalTokens): void {
  const { internal, assistant = null } = typeof tokens === "string" ? { internal: tokens } : tokens;
  if (internal.length < MIN_TOKEN_LENGTH) throw new Error("internal token must be at least 32 characters");
  if (assistant !== null && assistant.length < MIN_TOKEN_LENGTH) throw new Error("assistant token must be at least 32 characters");
  if (tokensClash(internal, assistant)) throw new Error("assistant token must differ from the internal token");
  app.addHook("onRequest", async (request: FastifyRequest) => {
    const [header, expected] = isAssistantRoute(request) ? [ASSISTANT_TOKEN_HEADER, assistant] : [INTERNAL_TOKEN_HEADER, internal];
    const given = request.headers[header];
    if (expected === null || typeof given !== "string" || !sameSecret(given, expected)) {
      throw new HttpError("unauthorized", "error.unauthorized");
    }
  });
}
