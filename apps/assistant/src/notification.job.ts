/**
 * Delivering notifications (AD-15, AD-16, D9; Stories 6.4 and 6.5): the assistant pulls one due
 * notification at a time from the server, sends it in the pacer's turn to the customer's private
 * chat, records its key in the sent-notifications file and acknowledges it, then pulls the next.
 * Exactly once rests on that order:
 *
 * - a notification whose key is already recorded is acknowledged without a send (it was sent and
 *   its ack was lost, or the assistant stopped between the two);
 * - a send that fails is not acknowledged: the server hands the row out again 1, 2, 4 ... minutes
 *   later;
 * - a notification with no complete sentence (an unknown key, a placeholder its parameters leave
 *   unfilled, a "link ready" one without its link) is acknowledged `undeliverable`, never sent.
 *
 * Nothing is pulled while the Zalo session is down; rows wait on the server. When nothing is due
 * the loop waits `idleMs` before it asks again.
 */
import type { AssistantNotification } from "@cashback/contracts";

import type { ChatSend } from "./chat-reply";
import type { InternalApi } from "./internal-api.adapter";
import { notificationMessage } from "./notification-text";
import type { Sleep } from "./pacer";
import type { SentNotifications } from "./sent-notifications-file.adapter";

export const NOTIFICATION_IDLE_MS = 10_000;

export interface NotificationDeps {
  readonly api: InternalApi;
  /** Sends one message by key in the pacer's turn. */
  readonly send: ChatSend;
  readonly sent: SentNotifications;
  readonly connected: () => boolean;
  readonly onError: (event: string, error: unknown) => void;
  /** Stops a pull or an ack in flight when the assistant stops. */
  readonly signal?: AbortSignal;
}

export type DeliveryStep = "down" | "idle" | "sent" | "known" | "undeliverable" | "send_failed" | "pull_failed";

async function acknowledge(deps: NotificationDeps, notification: AssistantNotification, result: "sent" | "undeliverable"): Promise<void> {
  await deps.api.acknowledgeNotification(notification.id, { result }, deps.signal).catch((error: unknown) => deps.onError("assistant.notification.ack_failed", error));
}

/** One pull and, when a notification came, its delivery. */
export async function deliverNext(deps: NotificationDeps): Promise<DeliveryStep> {
  if (!deps.connected()) return "down";
  let notification: AssistantNotification | null;
  try {
    notification = await deps.api.nextNotification(deps.signal);
  } catch (error) {
    deps.onError("assistant.notification.pull_failed", error);
    return "pull_failed";
  }
  if (notification === null) return "idle";
  if (deps.sent.has(notification.dedupKey)) {
    await acknowledge(deps, notification, "sent");
    return "known";
  }
  const message = notificationMessage(notification);
  if (message === null) {
    await acknowledge(deps, notification, "undeliverable");
    return "undeliverable";
  }
  try {
    await deps.send({ kind: "private", userId: notification.zaloUserId }, message.key, message.values);
  } catch (error) {
    deps.onError("assistant.notification.send_failed", error);
    return "send_failed";
  }
  try {
    deps.sent.add(notification.dedupKey);
  } catch (error) {
    deps.onError("assistant.notification.record_failed", error);
  }
  await acknowledge(deps, notification, "sent");
  return "sent";
}

/** Delivers until `signal` aborts; the pacer sets the pace of the sends themselves. */
export async function runNotifications(deps: NotificationDeps & { readonly sleep: Sleep; readonly signal: AbortSignal; readonly idleMs?: number }): Promise<void> {
  while (!deps.signal.aborted) {
    const step = await deliverNext(deps);
    if (step === "sent" || step === "known" || step === "undeliverable") continue;
    await deps.sleep(deps.idleMs ?? NOTIFICATION_IDLE_MS, deps.signal);
  }
}
