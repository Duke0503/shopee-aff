/**
 * The operations module (AD-1): audit entries, alerts, their Telegram delivery and the one health
 * model (AD-17, AD-27); it implements the platform audit and alert ports. It sits on top and may
 * import identity, linking, orders and payouts. Other modules reach it only through this file (code.md §1), and the modules
 * below it only through the ports.
 */
export { AuditEntryError, auditFor, commandAudit, recordAudit } from "./audit.command";
export { ALERT_MAX_ATTEMPTS, alertsFor, claimForSending, expireAlerts, ledgerAlerts, markAlertDelivery, pendingAlerts, raiseAlert, type AlertOutcome } from "./alert.command";
export { ALERT_EXPIRY_MS, ALERTS_PER_RUN, BOOKKEEPING_ATTEMPTS, deliverPendingAlerts, immediateAlerts, type DeliveryResult } from "./alert-delivery.job";
export { ALERT_COOLDOWN_MS, alertText } from "./domain/alert-cooldown";
export { isIdentifierKey, isPersonalKey, payloadProblems, type AuditProblem } from "./domain/audit-payload";
export { hasAlertLabel, TelegramSendError, telegramSender, telegramText, type AlertSender, type FetchLike, type TelegramOptions } from "./telegram.adapter";
export { ALERT_DELIVERIES } from "./schema";
export { ASSISTANT_DOWN_AFTER_MS, assistantHeartbeats, type AssistantHeartbeats, type AssistantLiveness, type AssistantState, type ReceivedHeartbeat } from "./assistant-heartbeat.command";
export { ASSISTANT_DOWN_ALERT, runAssistantHealthCheck, type AssistantHealthDeps, type AssistantHealthStep } from "./assistant-health.job";
export { healthModel, QUEUE_STUCK_AFTER_MS, QUEUE_STUCK_ALERT, readHealthModel, RECONCILIATION_DOWN_AFTER_MS, RECONCILIATION_DOWN_ALERT, withoutAlerts, type HealthAlert, type HealthEntry, type HealthSources } from "./health-model.query";
export { healthCheck, type HealthCheck, type HealthCheckDeps } from "./health.job";
export { heartbeatPinger, isGreen, type HeartbeatDeps, type PingFetch, type PingOutcome } from "./heartbeat.job";
export { assistantHeartbeatRoutes, type AssistantHeartbeatRouteDeps } from "./http/assistant-heartbeat.routes";
export { siteStatusRoutes, type SiteStatusRouteDeps } from "./http/site-status.routes";
