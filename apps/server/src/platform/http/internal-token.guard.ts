/**
 * Internal routes (assistant, bridge) are authorized by their token header, never
 * by source address (AD-18, SECURITY_MODEL.md).
 */
import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";

import { HttpError } from "./error-envelope";

export const INTERNAL_TOKEN_HEADER = "x-internal-token";

function sameSecret(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function requireInternalToken(app: FastifyInstance, expected: string): void {
  if (expected.length < 32) throw new Error("internal token must be at least 32 characters");
  app.addHook("onRequest", async (request: FastifyRequest) => {
    const given = request.headers[INTERNAL_TOKEN_HEADER];
    if (typeof given !== "string" || !sameSecret(given, expected)) {
      throw new HttpError("unauthorized", "error.unauthorized");
    }
  });
}
