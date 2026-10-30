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
  detectShopeeExportMapping,
  mapExportStatus,
  normaliseExportStatus,
  normaliseHeader,
  parseCsv,
  readExportAmount,
  readShopeeExport,
  SHOPEE_EXPORT_FIELDS,
  SHOPEE_EXPORT_STATUS_MAP,
  shopeeExportMapping,
  type ShopeeExport,
  type ShopeeExportField,
  type ShopeeExportMapping,
} from "./domain/shopee-export";
export {
  assertComplete,
  cachedFileReport,
  fingerprintRow,
  readReportFile,
  ReportSourceError,
  sourced,
  withinWindow,
  type ReportSource,
  type ReportSourceErrorCode,
  type ReportWindow,
  type SourcedReport,
  type SourcedRow,
  type WindowedReportSource,
} from "./report-source.port";
export { readShopeeFile, readShopeePages, SHOPEE_MAX_PAGES, SHOPEE_PAGE_SIZE, shopeeFileSource, shopeeFileWindowSource, type ShopeeFileOptions } from "./shopee-file.adapter";
export { shopeeBridgeSource } from "./shopee-bridge.adapter";
export { accessTradeFileSource, accessTradeFileWindowSource, accessTradePages, readAccessTradeFile, readAccessTradePages, type AccessTradePage } from "./accesstrade-file.adapter";
export {
  ACCESSTRADE_MAX_PAGES,
  ACCESSTRADE_MAX_WINDOW_DAYS,
  ACCESSTRADE_PAGE_LIMIT,
  ACCESSTRADE_TIMEOUT_MS,
  accessTradeApiSource,
  accessTradeWindowSource,
  fetchGet,
  readAccessTradeApi,
  type AccessTradeApiOptions,
  type HttpAnswer,
  type HttpGet,
} from "./accesstrade-api.adapter";
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
export { findLinkRequestOwner, type LinkRequestOwner } from "./link-request.query";
export { findShareCode, type SharedLink } from "./share-code.query";
export { LINK_NETWORKS, LINK_REQUEST_STATUSES, type LinkNetwork } from "./schema";
