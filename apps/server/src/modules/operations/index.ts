/**
 * The operations module (AD-1): audit entries, alerts and the Overview (AD-17, AD-27); it
 * implements the platform audit and alert ports. It sits on top and may import identity, linking,
 * orders and payouts. Other modules reach it only through this file (code.md §1), and the modules
 * below it only through the ports.
 */
export { AuditEntryError, auditFor, commandAudit, recordAudit } from "./audit.command";
export { ALERT_MAX_ATTEMPTS, alertsFor, claimForSending, ledgerAlerts, markAlertDelivery, pendingAlerts, raiseAlert, type AlertOutcome } from "./alert.command";
export { BOOKKEEPING_ATTEMPTS, deliverPendingAlerts, type DeliveryResult } from "./alert-delivery.job";
export { ALERT_COOLDOWN_MS, alertText } from "./domain/alert-cooldown";
export { isIdentifierKey, isPersonalKey, payloadProblems, type AuditProblem } from "./domain/audit-payload";
export { TelegramSendError, telegramSender, type AlertSender, type FetchLike, type TelegramOptions } from "./telegram.adapter";
export { ALERT_DELIVERIES } from "./schema";
