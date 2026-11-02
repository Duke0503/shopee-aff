/**
 * How the assistant tells a customer about an order (AD-10, D57; Stories 6.6 and 6.7), in the live
 * system's words (notifications.py `notify_order_changes`, owner requirement 2026-11-02): "recorded"
 * with the estimated cashback and the payout window, "approved" with the cashback and what happens
 * to the money (the bank account set, missing or waiting to be confirmed), "rejected" (and a reversal,
 * which the live system told the same way) with the reason in words. Any other status falls back to
 * the status sentence the registry points at (docs/operations/status-flows.md).
 *
 * The server sends the notice key and the target status; a row queued before Story 6.6 under a
 * registry key (`order_approved`) is written the same way from the status that key belongs to, and
 * an old rejection without a reason gets the neutral one. A notice without its order id, or whose
 * message misses a value (an approval without its cashback), has no sentence: never a bare status.
 */
import { statusesOf } from "@cashback/core";

import { dongText, type ReplyMessage } from "./link-reply-text";
import { isMessageKey, messageText, type MessageKey } from "./messages";

const REASON_PREFIX = "rejection_reason_";

/** The words of a cancel reason code (`order_cancelled`); an unknown or missing one points to the website. */
export function rejectionReasonText(code: string | null | undefined): string {
  const key = `${REASON_PREFIX}${code ?? ""}`;
  return messageText(isMessageKey(key) ? key : "rejection_reason_other");
}

/** The status sentence of an order status value, or null for a value the registry does not hold. */
export function orderStateText(status: string, rejectionReason: string | null): string | null {
  const key = statusesOf("order").find((s) => s.value === status)?.messageKey ?? null;
  if (key === null || !isMessageKey(key)) return null;
  return messageText(key, { reason: rejectionReasonText(rejectionReason) });
}

/** The approved message by the state of the customer's bank account the server picked. */
const APPROVED_KEYS: Readonly<Record<string, MessageKey>> = {
  notice_order_approved: "notice_order_approved",
  notice_order_approved_add_bank: "notice_order_approved_add_bank",
  notice_order_approved_bank_held: "notice_order_approved_bank_held",
};

/** The status each notice key is about when the server did not say. */
const NOTICE_STATUS: Readonly<Record<string, string | null>> = {
  notice_order: null,
  notice_order_recorded: "AWAITING_APPROVAL",
  notice_order_approved: "APPROVED",
  notice_order_approved_add_bank: "APPROVED",
  notice_order_approved_bank_held: "APPROVED",
};

/** A row queued before Story 6.6 under the registry key of a status. */
function legacyStatus(messageKey: string): string | null {
  return statusesOf("order").find((s) => s.messageKey === messageKey)?.value ?? null;
}

type Params = Readonly<Record<string, string | number>>;

function noticeOf(messageKey: string, status: string, orderId: string, params: Params): ReplyMessage | null {
  const cashback = typeof params["cashback"] === "number" ? dongText(params["cashback"]) : null;
  switch (status) {
    case "AWAITING_APPROVAL": {
      const estimate = cashback ?? (typeof params["estimate"] === "number" ? dongText(params["estimate"]) : messageText("cashback_unknown"));
      return { key: "notice_order_recorded", values: { orderId, cashback: estimate } };
    }
    case "APPROVED":
      return cashback === null ? null : { key: APPROVED_KEYS[messageKey] ?? "notice_order_approved", values: { orderId, cashback } };
    case "REJECTED":
    case "REVERSED":
      return { key: "notice_order_rejected", values: { orderId, reason: rejectionReasonText(params["reason"] === undefined ? null : String(params["reason"])) } };
    default: {
      const state = orderStateText(status, null);
      return state === null ? null : { key: "notice_order", values: { orderId, state } };
    }
  }
}

/**
 * The message of an order notice, `undefined` when `messageKey` is no order notice, null when it is
 * one without a complete sentence.
 */
export function orderNoticeMessage(messageKey: string, params: Params): ReplyMessage | null | undefined {
  const known = Object.hasOwn(NOTICE_STATUS, messageKey);
  const legacy = known ? null : legacyStatus(messageKey);
  if (!known && legacy === null) return undefined;
  const status = typeof params["status"] === "string" ? params["status"] : known ? (NOTICE_STATUS[messageKey] ?? null) : legacy;
  const orderId = params["orderId"];
  if (orderId === undefined || String(orderId) === "" || status === null) return null;
  if (statusesOf("order").every((s) => s.value !== status)) return null;
  return noticeOf(messageKey, status, String(orderId), params);
}
