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
export { httpsImageUrl, productSnapshotsOf, type ProductSnapshot } from "./product-snapshot.query";
export { findShareCode, type SharedLink } from "./share-code.query";
export { BRIDGE_JOB_KINDS, BRIDGE_JOB_STATUSES, LINK_NETWORKS, LINK_REQUEST_STATUSES, type LinkNetwork } from "./schema";
export {
  answerCustomerLinkRequests,
  LINK_REQUESTS_LIST,
  linkRequestCountOf,
} from "./link-requests.list";
export { deliveredLinkCounts, failedLinkCount, type NetworkCount } from "./link-overview.query";
export { LINK_CHANNELS, LinkRequestError, nextRequestId, queueLinkRequest, type LinkChannel, type LinkRequestErrorCode, type LinkRequestInput, type LinkRequestNote, type QueuedLinkRequest } from "./link-request.command";
export { claimLinkJob, claimLinkWork, type ApiLinkRequest, type ClaimOptions, type LinkWork } from "./link-issue.command";
export { LINK_FAILED_MESSAGE, randomShareCode, recordApiLinkResult, recordLinkResult, recordSilentBridge, SHARE_CODE_LENGTH, SILENT_ANSWERS_BEFORE_FAILURE, type ApiLinkAnswer, type LinkEffects, type LinkResultRecorded, type RecordedBridgeAnswer, type RecordOptions } from "./link-result.command";
export { holdShopeeQueue, notePageError, pauseShopeeQueue, resumeShopeeQueue, shopeeQueueGate, shopeeQueueState, type LinkQueueState, type QueueGate, type QueueResumed } from "./link-queue.command";
export { CAPTCHA_HOLD_MS, FINAL_FAILURE_MESSAGES, handlingOf, LINK_MAX_ATTEMPTS, LINK_QUEUE_ALERTS, PAGE_ERROR_FAIL_AFTER_MS, PAGE_ERROR_HOLD_MS, pageErrorStep, RELOGIN_RUNBOOK, RESOLUTION_RETRY_MS, type FailureHandling } from "./domain/link-failure";
export { ACCESSTRADE_LINK_PATH, accessTradeLinkCreator, fakeAccessTradeLinks, fetchPost, type AccessTradeLinkOptions, type HttpPost, type LinkCreator, type PostAnswer } from "./accesstrade-link.adapter";
export { checkReturnedLink, isShopeeShortHost, linkWithoutQuery, needsResolution, RETRY_BASE_MS, RETRY_MAX_MS, retryDelayMs, type LinkCheck, type LinkCheckFailure, type LinkOrigin } from "./domain/link-check";
export { MAX_LINKS_PER_RUN, runLinkJob, type LinkJobDeps, type LinkJobRun } from "./link.job";
export { FAKE_BRIDGE_HOST, fakeBridge, fakeLinkUrl } from "./fake-bridge.adapter";
export { readProductLink, readShopeeProduct, shopeeProductKey, shopeeProductKeyOf, shopeeProductUrl, SUB_ID_PATTERN, type ProductLink } from "./domain/product-url";
export { chooseReusable, isReusable, LINK_REUSE_WINDOW_DAYS, unreadableTimes, type ReuseCandidate, type ReuseRule } from "./domain/link-reuse";
export { linkRequestInternalRoutes, type LinkRequestRouteDeps } from "./http/link-request.routes";
export { BRIDGE_ANSWER_GRACE_MS, BRIDGE_JOB_TIMEOUT_MS, BRIDGE_PICKUP_MS, BRIDGE_POLL_MS, browserBridge, type BridgeAnswer, type BridgeTimer, type BridgeWork, type BrowserBridge, type BrowserBridgeOptions } from "./browser-bridge.adapter";
export { bridgeInternalRoutes, type BridgeRouteDeps } from "./http/bridge.routes";
