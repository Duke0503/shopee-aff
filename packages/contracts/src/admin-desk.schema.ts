/**
 * The admin desk's own screens for what the internal CLI did before (FR-11, FR-23, FR-24, decision
 * H8; Stories 4.19, 4.20): staff accounts, campaigns and customer merges, each through the same
 * commands as the CLI, and the sidebar's counts. Staff screens are admin only on the server
 * (ADMIN_ONLY_PATHS); no answer carries a password hash, and a password the server issues is
 * answered once and never stored in clear.
 */
import { INSTANT_PATTERN, STAFF_ROLES } from "@cashback/core";
import { z } from "zod";

import { campaignInputSchema, campaignPreviewResponseSchema } from "./admin-command.schema";
import { customerMergeRequestSchema, mergeBalanceSchema } from "./customer-merge.schema";

const instant = z.string().regex(INSTANT_PATTERN);
const count = z.number().int().min(0);
const dong = z.number().int().min(0);
const role = z.enum(STAFF_ROLES);
const staffStatus = z.enum(["ACTIVE", "DISABLED"]);

/** The sidebar's counts: the Payouts "payable" tab (the queue's own definition) and the open review cases. */
export const deskCountsSchema = z.object({ payable: count, openReviewCases: count });
export type DeskCounts = z.infer<typeof deskCountsSchema>;

export const staffMemberSchema = z.object({
  staffId: z.string(),
  username: z.string(),
  role,
  status: staffStatus,
  /** The root admin: always an active admin. */
  root: z.boolean(),
  lastSignInAt: instant.nullable(),
  createdAt: instant,
});
export type StaffMember = z.infer<typeof staffMemberSchema>;

export const staffListSchema = z.object({ staff: z.array(staffMemberSchema) });
export type StaffList = z.infer<typeof staffListSchema>;

export const staffAddRequestSchema = z.strictObject({ username: z.string().trim().regex(/^[a-z0-9._-]{3,64}$/), role });
export type StaffAddRequest = z.infer<typeof staffAddRequestSchema>;

/** A password the server made: shown to the admin once, to pass on; only its hash is kept. */
export const staffIssuedPasswordSchema = z.object({ staffId: z.string(), username: z.string(), password: z.string().min(12), sessionsEnded: count });
export type StaffIssuedPassword = z.infer<typeof staffIssuedPasswordSchema>;

export const CAMPAIGN_STATES = ["UPCOMING", "RUNNING", "FULL", "ENDED", "CLOSED"] as const;
export type CampaignState = (typeof CAMPAIGN_STATES)[number];
export const CAMPAIGN_AWARD_STATES = ["HELD", "CONFIRMED", "PAID", "VOID"] as const;

export const campaignAwardRowSchema = z.object({
  awardId: z.number().int(),
  orderId: z.string(),
  customerCode: z.string().nullable(),
  customerName: z.string().nullable(),
  createdAt: instant.nullable(),
  status: z.enum(CAMPAIGN_AWARD_STATES),
});
export type CampaignAwardRow = z.infer<typeof campaignAwardRowSchema>;

export const deskCampaignSchema = z.object({
  campaignId: z.string(),
  name: z.string(),
  startsAt: instant.nullable(),
  /** Exclusive (D22). */
  endsAt: instant.nullable(),
  /** The exclusive end in Vietnam time, for "until before <time> on <date>". */
  endsBefore: z.object({ time: z.string(), date: z.string() }).nullable(),
  slots: count,
  bonus: dong,
  minOrderValue: dong,
  platforms: z.array(z.string()),
  /** Slots one customer may hold; 0 is no cap. */
  perCustomer: count,
  state: z.enum(CAMPAIGN_STATES),
  /** Awards by status; HELD, CONFIRMED and PAID hold a slot, VOID gave it back. */
  awards: z.object({ held: count, confirmed: count, paid: count, void: count }),
  slotsUsed: count,
  /** The event's own figures (the Overview's events block), null for a campaign without a window. */
  result: z.object({ cost: dong, commission: dong, operatorShare: z.number().int(), result: z.number().int() }).nullable(),
  /** The latest awards, newest first (at most CAMPAIGN_AWARDS_SHOWN). */
  latest: z.array(campaignAwardRowSchema),
});
export type DeskCampaign = z.infer<typeof deskCampaignSchema>;

export const CAMPAIGN_AWARDS_SHOWN = 20;

export const deskCampaignsSchema = z.object({ asOf: instant, campaigns: z.array(deskCampaignSchema) });
export type DeskCampaigns = z.infer<typeof deskCampaignsSchema>;

/** The desk's campaign form posts the CLI's own campaign input. */
export const deskCampaignRequestSchema = z.strictObject({ campaign: campaignInputSchema });
export const deskCampaignPreviewSchema = campaignPreviewResponseSchema;

/** One side of a merge as the dialog shows it: who, how much is owed, how many orders and links, the bank. */
export const deskMergeSideSchema = z.object({
  customerId: z.string(),
  customerCode: z.string().nullable(),
  customerName: z.string().nullable(),
  zaloUserId: z.string().nullable(),
  balance: mergeBalanceSchema,
  orders: count,
  linkRequests: count,
  bank: z.object({ bankName: z.string().nullable(), lastFour: z.string() }).nullable(),
});
export type DeskMergeSide = z.infer<typeof deskMergeSideSchema>;

/**
 * The merge dialog's preview: both sides always, and either the plan (the bank move and the
 * survivor's balance after) or the command's refusal (its message key and fields), so the dialog
 * can show who would be merged and why it cannot be.
 */
export const deskMergePreviewSchema = z.object({
  merged: deskMergeSideSchema,
  survivor: deskMergeSideSchema,
  plan: z.object({ bankMoves: z.boolean(), result: mergeBalanceSchema }).nullable(),
  refusal: z.object({ code: z.string(), messageKey: z.string(), fields: z.record(z.string(), z.string()) }).nullable(),
});
export type DeskMergePreview = z.infer<typeof deskMergePreviewSchema>;

export const deskMergeRequestSchema = customerMergeRequestSchema;
