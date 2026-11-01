/**
 * The messaging module (AD-1): the notification outbox and conversations (AD-16); it implements
 * the platform outbox port. It sits on top and may import every module except operations. Other
 * modules reach it only through this file (code.md §1).
 */
export {
  DEDUP_KEY_PATTERN,
  dedupKey,
  dedupKeyParts,
  encodeDedupKeyId,
  enqueue,
  keyState,
  outboxFor,
  OutboxSeedError,
  seedSentNotifications,
  wasTold,
  withdrawUnsent,
  type EnqueueResult,
  type SeededNotification,
} from "./outbox.command";
export { isSilent, setSilent, silentFlag, type SilentFlag } from "./messaging-settings.command";
export {
  acknowledgeNotification,
  DAILY_CAP_ALERT,
  droppedNotifications,
  dropExpiredNotifications,
  handOutNext,
  holdsCutoverSeeds,
  sendsToday,
  UNDELIVERABLE_ALERT,
  withdrawPendingNotification,
  type AckOutcome,
  type HandedOutNotification,
  type Handout,
  type HandoutOptions,
} from "./notification-delivery.command";
export { ACK_WINDOW_MS, DEFAULT_DAILY_CAP, dueAgainAfterMs, NOTIFICATION_MAX_AGE_MS, redeliveryDelayMs, REDELIVERY_FIRST_MS, REDELIVERY_MAX_MS } from "./domain/delivery-timing";
export { dueCreatedSince, wouldBeSends, type WouldBeSends } from "./would-be-sends.query";
export { OUTBOX_DROP_REASONS, type OutboxDropReason } from "./schema";
