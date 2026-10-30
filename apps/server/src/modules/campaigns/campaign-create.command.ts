/**
 * Creating a campaign by admin command (AD-11, AD-28, D22, D53, FR-23; Story 4.20). The campaign
 * screen comes after cutover; a campaign needed at cutover is created through the internal CLI,
 * preview first, then apply. Staff type the window in Vietnam time as `DD/MM/YYYY HH:mm`; it is
 * stored as two instants, start inclusive and end exclusive (D22), and the preview reads the end
 * back as the first moment that is no longer in the campaign. Slot allocation is not here: it
 * waits for its own decision (Story 9.4), and imported awards are honoured by `getBalances`.
 * Excluded customers arrive already resolved to customer ids by the composition root.
 */
import { campaignWindow, type Clock, type Instant } from "@cashback/core";
import { eq } from "drizzle-orm";

import type { LedgerDb } from "../../platform/db/ledger";
import { hasStaffRole, type CommandAudit } from "../../platform/ports/audit.port";
import { campaigns, type CampaignRow } from "./schema";

/** The shop platforms a campaign can name, as the live campaigns stored them. */
export const CAMPAIGN_PLATFORMS = ["shopee", "shopeefood", "tiktok", "lazada"] as const;
export type CampaignPlatform = (typeof CAMPAIGN_PLATFORMS)[number];

export type CampaignCreateErrorCode = "admin_only" | "campaign_exists" | "bad_window" | "bad_field";

export class CampaignCreateError extends Error {
  constructor(
    readonly code: CampaignCreateErrorCode,
    readonly field?: string,
  ) {
    super(`campaign create: ${code}${field === undefined ? "" : ` (${field})`}`);
    this.name = "CampaignCreateError";
  }
}

export interface CampaignInput {
  readonly campaignId: string;
  readonly name: string;
  /** `DD/MM/YYYY HH:mm`, Vietnam time, inclusive. */
  readonly startsAt: string;
  /** `DD/MM/YYYY HH:mm`, Vietnam time, exclusive. */
  readonly endsAt: string;
  readonly slots: number;
  readonly bonus: number;
  readonly minOrderValue: number;
  readonly platforms: readonly CampaignPlatform[];
  /** Slots one customer may hold; 0 is no cap. */
  readonly perCustomer: number;
  readonly excludedCustomerIds: readonly string[];
}

export interface CampaignPreview {
  readonly campaignId: string;
  readonly name: string;
  readonly startsAt: Instant;
  /** Exclusive: the first instant outside the campaign. */
  readonly endsAt: Instant;
  readonly slots: number;
  readonly bonus: number;
  readonly minOrderValue: number;
  readonly platforms: readonly CampaignPlatform[];
  readonly perCustomer: number;
  readonly excludedCustomerIds: readonly string[];
}

const ID = /^[A-Za-z0-9_-]{1,40}$/;
const wholeCount = (value: number): boolean => Number.isSafeInteger(value) && value >= 0;

function checked(input: CampaignInput): CampaignPreview {
  if (!ID.test(input.campaignId)) throw new CampaignCreateError("bad_field", "campaignId");
  const name = input.name.trim();
  if (name.length === 0 || name.length > 120) throw new CampaignCreateError("bad_field", "name");
  for (const field of ["slots", "bonus", "minOrderValue", "perCustomer"] as const) if (!wholeCount(input[field])) throw new CampaignCreateError("bad_field", field);
  if (input.slots === 0) throw new CampaignCreateError("bad_field", "slots");
  if (input.platforms.length === 0 || input.platforms.some((p) => !CAMPAIGN_PLATFORMS.includes(p))) throw new CampaignCreateError("bad_field", "platforms");
  let window: { from: Instant; to: Instant };
  try {
    window = campaignWindow(input.startsAt, input.endsAt);
  } catch {
    throw new CampaignCreateError("bad_window");
  }
  return { ...input, name, startsAt: window.from, endsAt: window.to, platforms: [...new Set(input.platforms)], excludedCustomerIds: [...new Set(input.excludedCustomerIds)].sort() };
}

/** The campaign as it would be stored; writes nothing. */
export function previewCampaign(db: LedgerDb, input: CampaignInput): CampaignPreview {
  const preview = checked(input);
  if (db.select({ id: campaigns.campaignId }).from(campaigns).where(eq(campaigns.campaignId, preview.campaignId)).get() !== undefined) throw new CampaignCreateError("campaign_exists", preview.campaignId);
  return preview;
}

/** Creates the campaign; admin only. Run inside `tx`. */
export function createCampaign(db: LedgerDb, input: CampaignInput, deps: { readonly clock: Clock; readonly by: CommandAudit }): CampaignPreview {
  if (!hasStaffRole(deps.by.actor, ["ADMIN"])) throw new CampaignCreateError("admin_only");
  const p = previewCampaign(db, input);
  const row: CampaignRow = {
    campaignId: p.campaignId,
    name: p.name,
    startsAt: p.startsAt,
    endsAt: p.endsAt,
    slots: p.slots,
    bonus: p.bonus,
    minOrderValue: p.minOrderValue,
    platforms: p.platforms.join(","),
    excludedCustomers: p.excludedCustomerIds.join(","),
    perCustomer: p.perCustomer,
    acceptsAwards: true,
    createdAt: deps.clock.now(),
    origin: "STAFF",
  };
  db.insert(campaigns).values(row).run();
  deps.by.audit.record({
    actor: deps.by.actor,
    event: "campaigns.campaign.created",
    entityId: p.campaignId,
    payload: { campaignId: p.campaignId, startsAt: p.startsAt, endsAt: p.endsAt, slots: p.slots, bonus: p.bonus, minOrderValue: p.minOrderValue, perCustomer: p.perCustomer, platforms: p.platforms.join(","), excluded: p.excludedCustomerIds.length },
  });
  return p;
}
