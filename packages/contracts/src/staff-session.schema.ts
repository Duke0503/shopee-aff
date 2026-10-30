/**
 * Staff sign-in on the admin host (AD-18, Story 4.2): `POST /api/admin/session` with a name and a
 * password; `GET` answers who is signed in; `DELETE` signs out. The session token travels only in
 * the HttpOnly staff cookie, never in a body.
 */
import { z } from "zod";
import { INSTANT_PATTERN, STAFF_ROLES } from "@cashback/core";

export const staffSignInRequestSchema = z.strictObject({
  username: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(256),
});
export type StaffSignInRequest = z.infer<typeof staffSignInRequestSchema>;

export const staffSessionResponseSchema = z.object({
  staffId: z.string().min(1),
  username: z.string().min(1),
  role: z.enum(STAFF_ROLES),
  /** Present right after sign-in. */
  expiresAt: z.string().regex(INSTANT_PATTERN).optional(),
});
export type StaffSessionResponse = z.infer<typeof staffSessionResponseSchema>;
