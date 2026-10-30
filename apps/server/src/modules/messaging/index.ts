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
  outboxFor,
  OutboxSeedError,
  seedSentNotifications,
  wasTold,
  type EnqueueResult,
  type SeededNotification,
} from "./outbox.command";
