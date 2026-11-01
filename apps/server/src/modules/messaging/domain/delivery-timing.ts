/**
 * When a handed-out notification is due again, and when it is too old to send (AD-16). The
 * assistant has 2 minutes to acknowledge a row; after that the row waits 1, 2, 4 ... minutes,
 * doubling per handout up to 60, before it is handed out again. Sending a pile of week-old news
 * after an outage reads as spam, so a row older than 7 days is dropped instead.
 */

export const ACK_WINDOW_MS = 2 * 60_000;
export const REDELIVERY_FIRST_MS = 60_000;
export const REDELIVERY_MAX_MS = 60 * 60_000;
export const NOTIFICATION_MAX_AGE_MS = 7 * 24 * 60 * 60_000;
/** The hard daily cap on proactive sends when the config sets none (D46). */
export const DEFAULT_DAILY_CAP = 150;

/** The wait after the ack window for the `handouts`-th handout (1 for the first). */
export function redeliveryDelayMs(handouts: number): number {
  if (!Number.isInteger(handouts) || handouts < 1) throw new RangeError("handouts must be a whole number from 1");
  return Math.min(REDELIVERY_FIRST_MS * 2 ** Math.min(handouts - 1, 30), REDELIVERY_MAX_MS);
}

/** How long after a handout the row is due again, unless it is acknowledged. */
export const dueAgainAfterMs = (handouts: number): number => ACK_WINDOW_MS + redeliveryDelayMs(handouts);
