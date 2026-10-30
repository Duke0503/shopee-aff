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
export { CAMPAIGN_AWARD_STATUSES } from "./schema";
