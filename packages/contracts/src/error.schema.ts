/**
 * The one error envelope (AD-20): `{ error: { code, messageKey, fields? } }`.
 * `messageKey` points into the label files; no human text and no stack trace
 * ever leaves the server.
 */
import { z } from "zod";

export const ERROR_CODES = [
  "not_found",
  "unauthorized",
  "forbidden",
  "invalid_request",
  "conflict",
  "rate_limited",
  "internal",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export const errorEnvelopeSchema = z.object({
  error: z.object({
    code: z.enum(ERROR_CODES),
    messageKey: z.string().min(1),
    fields: z.record(z.string(), z.string()).optional(),
  }),
});

export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;

export const ERROR_STATUS: Record<ErrorCode, number> = {
  not_found: 404,
  unauthorized: 401,
  forbidden: 403,
  invalid_request: 400,
  conflict: 409,
  rate_limited: 429,
  internal: 500,
};
