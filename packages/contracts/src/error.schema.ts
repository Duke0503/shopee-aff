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
  "invalid_sort",
  "conflict",
  "rate_limited",
  "busy",
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
  /** A list sort on a field its spec does not declare sortable (AD-12, Story 4.3). */
  invalid_sort: 400,
  conflict: 409,
  rate_limited: 429,
  /** The ledger stayed locked past the busy timeout and one retry; the caller may try again. */
  busy: 503,
  internal: 500,
};
