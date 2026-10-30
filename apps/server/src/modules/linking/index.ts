/**
 * The linking module (AD-1): link requests, share codes, bridge jobs and the network catalog, with
 * one adapter per network (AD-14, AD-22). It may import identity. Other modules reach it only
 * through this file (code.md §1).
 */
export {
  NETWORK_CATALOG,
  networkDefinition,
  type CapRule,
  type NetworkDefinition,
  type SubIdFormat,
  type TaxRule,
} from "./domain/network-catalog";
export { mapStatus, NETWORK_STATUSES, type KnownNetworkStatus, type NetworkStatus, type StatusMap } from "./domain/network-status";
export type { ReportItem, ReportRow, RowProblem } from "./domain/report-row";
export { parseShopeeSubIds, readShopeeConversion, SHOPEE_AMOUNT_SCALE, SHOPEE_STATUS_MAP, type ShopeeSubIds } from "./domain/shopee-report";
export { ACCESSTRADE_AMOUNT_SCALE, ACCESSTRADE_STATUS_MAP, mapAccessTradeLine, pythonInt, readAccessTradeTransactions } from "./domain/accesstrade-report";
export {
  importLinks,
  isShareCode,
  LinksImportError,
  SHARE_CODE_PATTERN,
  type ImportedLinkRequest,
  type ImportedProductOffer,
  type ImportedShareCode,
  type LinksImport,
  type LinksImportResult,
} from "./link-import.command";
export { findShareCode, type SharedLink } from "./share-code.query";
export { LINK_NETWORKS, LINK_REQUEST_STATUSES, type LinkNetwork } from "./schema";
