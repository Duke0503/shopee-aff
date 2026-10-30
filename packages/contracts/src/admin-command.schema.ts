/**
 * The admin commands of the internal CLI (decision H8, AD-18, AD-28, Story 4.20): staff seed,
 * password reset, role and status change, and campaign create, each reached on the internal
 * listener with the internal token and, except the first seed of an empty staff table, the staff
 * token of a signed-in admin. Passwords travel only in these request bodies, over the loopback
 * listener, and are never returned.
 */
import { STAFF_ROLES } from "@cashback/core";
import { z } from "zod";

export const STAFF_TOKEN_HEADER = "x-staff-token";

const staffId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/);
const username = z.string().regex(/^[a-z0-9._-]{3,64}$/);
const role = z.enum(STAFF_ROLES);
/** At least 12 characters (the seed and reset policy), at most the hasher's limit. */
export const staffPasswordSchema = z.string().min(12).max(256);

export const adminSignInRequestSchema = z.strictObject({ username: z.string().min(1).max(64), password: z.string().min(1).max(256) });
export const adminSignInResponseSchema = z.object({ token: z.string(), staffId: z.string(), role, expiresAt: z.string().nullable() });

export const staffSeedSchema = z.strictObject({
  root: z.strictObject({ staffId, username }),
  members: z.array(z.strictObject({ staffId, username, role })).max(50),
});
export type StaffSeedInput = z.infer<typeof staffSeedSchema>;

export const staffSeedPreviewRequestSchema = z.strictObject({ seed: staffSeedSchema });
/** One password per member the seed creates: never more entries than the seed lists (root included). */
export const staffSeedRequestSchema = z
  .strictObject({ seed: staffSeedSchema, passwords: z.record(staffId, staffPasswordSchema) })
  .refine((v) => Object.keys(v.passwords).length <= v.seed.members.length + 1, { path: ["passwords"] });
export const staffSeedResponseSchema = z.object({
  bootstrap: z.boolean(),
  create: z.array(z.object({ staffId: z.string(), username: z.string(), role, root: z.boolean() })),
  unchanged: z.array(z.string()),
});
export type StaffSeedResponse = z.infer<typeof staffSeedResponseSchema>;

export const staffParamsSchema = z.strictObject({ staffId });
export const staffPasswordRequestSchema = z.strictObject({ password: staffPasswordSchema });
export const staffPasswordResponseSchema = z.object({ staffId: z.string(), sessionsEnded: z.number().int().min(0) });
export const staffAccessRequestSchema = z.strictObject({ role: role.optional(), status: z.enum(["ACTIVE", "DISABLED"]).optional() }).refine((v) => v.role !== undefined || v.status !== undefined);
export const staffAccessResponseSchema = z.object({ staffId: z.string(), role, status: z.enum(["ACTIVE", "DISABLED"]) });

/** A campaign as staff type it: the window in Vietnam time `DD/MM/YYYY HH:mm`, end exclusive (D22). */
export const campaignInputSchema = z.strictObject({
  campaignId: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/),
  name: z.string().trim().min(1).max(120),
  startsAt: z.string().regex(/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/),
  endsAt: z.string().regex(/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/),
  slots: z.number().int().min(1),
  bonus: z.number().int().min(0),
  minOrderValue: z.number().int().min(0).default(0),
  platforms: z.array(z.enum(["shopee", "shopeefood", "tiktok", "lazada"])).min(1),
  perCustomer: z.number().int().min(0).default(0),
  /** Customer codes or ids that never win a slot. */
  excludedCustomers: z.array(z.string().regex(/^[A-Za-z0-9]{1,64}$/)).max(500).default([]),
});
export type CampaignInputBody = z.infer<typeof campaignInputSchema>;

export const campaignRequestSchema = z.strictObject({ campaign: campaignInputSchema });
export const campaignPreviewResponseSchema = z.object({
  campaignId: z.string(),
  name: z.string(),
  startsAt: z.string(),
  /** Exclusive: the first instant outside the campaign. */
  endsAt: z.string(),
  /** The exclusive end in Vietnam time, for "until before <time> on <date>". */
  endsBefore: z.object({ time: z.string(), date: z.string() }),
  slots: z.number().int(),
  bonus: z.number().int(),
  minOrderValue: z.number().int(),
  platforms: z.array(z.string()),
  perCustomer: z.number().int(),
  excludedCustomerIds: z.array(z.string()),
});
export type CampaignPreviewResponse = z.infer<typeof campaignPreviewResponseSchema>;
