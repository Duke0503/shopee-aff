/**
 * The campaigns module (AD-1): campaigns and campaign awards (FR-23). It may import orders. Other
 * modules reach it only through this file (code.md §1).
 */
export {
  CampaignsImportError,
  importCampaigns,
  type CampaignsImport,
  type CampaignsImportResult,
  type ImportedAward,
  type ImportedCampaign,
} from "./campaign-import.command";
export { confirmedBonusByCustomer, confirmedBonusLines, type BonusLine } from "./award-balance.query";
export { moveAwards, orderAwardsFor, paidBonusOn, payAwards, returnPaidAwards } from "./order-award.command";
export { CAMPAIGN_AWARD_STATUSES } from "./schema";
export {
  CAMPAIGN_PLATFORMS,
  CampaignCreateError,
  createCampaign,
  previewCampaign,
  type CampaignCreateErrorCode,
  type CampaignInput,
  type CampaignPlatform,
  type CampaignPreview,
} from "./campaign-create.command";
export { campaignNamesOf, campaignsOverlapping, liveAwards, type AwardFact, type CampaignWindow } from "./campaign-overview.query";
