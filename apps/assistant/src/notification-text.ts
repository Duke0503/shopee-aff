/**
 * The sentence of one notification (AD-16, D57; Stories 6.4 and 6.5), from the message file by
 * key. A "link ready" notification is written exactly as the chat reply would be, from the link
 * reply facts the server attached (link-reply-text.ts). Every other one fills its key's
 * placeholders from the parameters; an amount is written in dong ("79.216d"). A key the message
 * file does not have, a "link ready" one without a made link, or one whose parameters leave a
 * placeholder unfilled has no sentence: it is undeliverable, never sent as a raw key or with a
 * raw `{placeholder}`.
 */
import type { AssistantNotification } from "@cashback/contracts";

import { dongText, linkReplyMessage, type ReplyMessage } from "./link-reply-text";
import { isMessageKey, messageText } from "./messages";

/** Parameters that are amounts in whole dong. */
const AMOUNT_PARAMS = new Set(["amount", "cashback", "price"]);

/** The notification's key and values, and its text, when it has a complete one. */
export function notificationMessage(notification: AssistantNotification): (ReplyMessage & { readonly text: string }) | null {
  const message = messageOf(notification);
  if (message === null) return null;
  try {
    return { ...message, text: messageText(message.key, message.values) };
  } catch {
    return null;
  }
}

function messageOf(notification: AssistantNotification): ReplyMessage | null {
  if (notification.link !== null) {
    const link = notification.link;
    if (link.shareUrl === null || link.status === "FAILED" || link.status === "QUEUED") return null;
    return linkReplyMessage({ ...link, shareUrl: link.shareUrl });
  }
  if (!isMessageKey(notification.messageKey)) return null;
  const values: Record<string, string> = {};
  for (const [name, value] of Object.entries(notification.params)) values[name] = typeof value === "number" && AMOUNT_PARAMS.has(name) ? dongText(value) : String(value);
  return { key: notification.messageKey, values };
}
