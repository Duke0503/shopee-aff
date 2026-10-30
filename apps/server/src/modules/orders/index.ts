/**
 * The orders module (AD-1): orders, their items and observations, the transition function, review
 * cases and reconciliation runs (AD-7, AD-8). It may import identity and linking. Other modules
 * reach it only through this file (code.md §1).
 */
export {
  reportSignal,
  type CancelReason,
  type FreezeReason,
  type ObservedItem,
  type ObservedStatus,
  type ReportObservation,
  type ReportSignal,
  type RowProblem,
} from "./domain/report-signal";
export {
  attribute,
  DEV_SUB_ID_PREFIX,
  type Attribution,
  type AttributionDirectory,
  type AttributionInput,
  type AttributionSource,
  type DirectoryCustomer,
  type ReviewReason,
} from "./domain/attribution";
export {
  transition,
  TransitionError,
  type AwardMove,
  type Effect,
  type Observation,
  type ReviewCaseReason,
  type ReviewContext,
  type Step,
  type TransitionContext,
  type TransitionErrorCode,
  type TransitionOrder,
  type TransitionResult,
} from "./domain/transition";
export {
  CUTOVER_ACTOR,
  importOrders,
  OrdersImportError,
  type ImportedOrder,
  type OrdersImport,
  type OrdersImportResult,
} from "./order-import.command";
export { ORDER_NETWORKS, ORDER_STATUSES, type OrderNetwork } from "./schema";
