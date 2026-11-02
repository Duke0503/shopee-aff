/**
 * The sentence of one notification (AD-16, D57; Stories 6.4 and 6.5), from the message file by
 * key. A "link ready" notification is written exactly as the chat reply would be, from the link
 * reply facts the server attached (link-reply-text.ts). An order notice, old keys included, is
 * written by order-text.ts (Story 6.6). Every other one fills its key's placeholders from the
 * parameters: an amount in dong ("79.216" and the dong sign), a rejected order's reason code in words, a payout's
 * time as the live payout message wrote it ("30/10/2026 19:42"). A payout queued before the
 * message parity (no total or time) gets the live message without those two lines. A key the
 * message file does not have, a "link ready" one without a made link, or one whose parameters leave
 * a placeholder unfilled has no sentence: it is undeliverable, never sent as a raw key or with a raw
 * `{placeholder}`.
 */
import { formatVnDateTimeWithYearOf } from "@cashback/core";
import type { AssistantNotification } from "@cashback/contracts";

import { dongText, linkReplyMessage, type ReplyMessage } from "./link-reply-text";
import { isMessageKey, messageText } from "./messages";
import { orderNoticeMessage, rejectionReasonText } from "./order-text";

/** Parameters that are amounts in whole dong. */
const AMOUNT_PARAMS = new Set(["amount", "cashback", "price", "totalPaid", "estimate"]);

/** A message with a shorter form for rows queued without some of its parameters. */
const SHORTER_FORM: Readonly<Record<string, { readonly needs: readonly string[]; readonly key: string }>> = {
  payout_recorded: { needs: ["totalPaid", "paidAt"], key: "payout_recorded_basic" },
};

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

function keyOf(notification: AssistantNotification): string {
  const shorter = SHORTER_FORM[notification.messageKey];
  return shorter !== undefined && shorter.needs.some((name) => notification.params[name] === undefined) ? shorter.key : notification.messageKey;
}

function messageOf(notification: AssistantNotification): ReplyMessage | null {
  if (notification.link !== null) {
    const link = notification.link;
    if (link.shareUrl === null || link.status === "FAILED" || link.status === "QUEUED") return null;
    return linkReplyMessage({ ...link, shareUrl: link.shareUrl });
  }
  const order = orderNoticeMessage(notification.messageKey, notification.params);
  if (order !== undefined) return order;
  const key = keyOf(notification);
  if (!isMessageKey(key)) return null;
  const values: Record<string, string> = {};
  for (const [name, value] of Object.entries(notification.params)) values[name] = valueText(name, value);
  return { key, values };
}

function valueText(name: string, value: string | number): string {
  if (name === "reason") return rejectionReasonText(String(value));
  if (name === "paidAt") return formatVnDateTimeWithYearOf(value) ?? messageText("value_missing");
  return typeof value === "number" && AMOUNT_PARAMS.has(name) ? dongText(value) : String(value);
}
