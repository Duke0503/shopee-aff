/**
 * Internal routes (assistant, bridge, admin CLI) are authorized by their token header, never
 * by source address (AD-18, SECURITY_MODEL.md INV-7). A route marked with `ASSISTANT_ROUTE` is
 * the Zalo assistant's: only `X-Assistant-Token` with the assistant token opens it, and the
 * internal token does not. A route marked with `BRIDGE_ROUTE` is the browser bridge's: only
 * `X-Bridge-Token` with the bridge token opens it (Story 5.3). Every other route, unknown paths
 * included, needs the internal token. The three tokens must differ, so none opens another's
 * routes. Tokens are compared in constant time.
 */
import { timingSafeEqual } from "node:crypto";
import { ASSISTANT_TOKEN_HEADER, BRIDGE_TOKEN_HEADER } from "@cashback/contracts";
import type { FastifyInstance, FastifyRequest } from "fastify";

import { tokensClash } from "../config/isolation.config";
import { HttpError } from "./error-envelope";

export const INTERNAL_TOKEN_HEADER = "x-internal-token";
export { ASSISTANT_TOKEN_HEADER, BRIDGE_TOKEN_HEADER };

/** Route config of an assistant route: `app.post(url, { config: ASSISTANT_ROUTE }, handler)`. */
export const ASSISTANT_ROUTE = { caller: "assistant" } as const;

/** Route config of a browser bridge route (Story 5.3). */
export const BRIDGE_ROUTE = { caller: "bridge" } as const;

export interface InternalTokens {
  readonly internal: string;
  /** Absent: no assistant token is configured and every assistant route answers 401. */
  readonly assistant?: string | null;
  /** Absent: no bridge token is configured and every bridge route answers 401. */
  readonly bridge?: string | null;
}

const MIN_TOKEN_LENGTH = 32;

function sameSecret(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

const callerOf = (request: FastifyRequest): unknown => (request.routeOptions.config as { caller?: unknown } | undefined)?.caller;

export function requireInternalToken(app: FastifyInstance, tokens: string | InternalTokens): void {
  const { internal, assistant = null, bridge = null } = typeof tokens === "string" ? { internal: tokens } : tokens;
  if (internal.length < MIN_TOKEN_LENGTH) throw new Error("internal token must be at least 32 characters");
  if (assistant !== null && assistant.length < MIN_TOKEN_LENGTH) throw new Error("assistant token must be at least 32 characters");
  if (bridge !== null && bridge.length < MIN_TOKEN_LENGTH) throw new Error("bridge token must be at least 32 characters");
  if (tokensClash(internal, assistant)) throw new Error("assistant token must differ from the internal token");
  if (tokensClash(internal, bridge) || tokensClash(assistant ?? "", bridge)) throw new Error("bridge token must differ from the internal and assistant tokens");
  const byCaller: Record<string, [string, string | null]> = { [ASSISTANT_ROUTE.caller]: [ASSISTANT_TOKEN_HEADER, assistant], [BRIDGE_ROUTE.caller]: [BRIDGE_TOKEN_HEADER, bridge] };
  app.addHook("onRequest", async (request: FastifyRequest) => {
    const caller = callerOf(request);
    const [header, expected] = (typeof caller === "string" ? byCaller[caller] : undefined) ?? [INTERNAL_TOKEN_HEADER, internal];
    const given = request.headers[header];
    if (expected === null || typeof given !== "string" || !sameSecret(given, expected)) {
      throw new HttpError("unauthorized", "error.unauthorized");
    }
  });
}
