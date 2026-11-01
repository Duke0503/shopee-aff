/**
 * How the assistant names an order's state (AD-10, D57; Stories 6.6 and 6.7): the customer sentence
 * the status registry points at for that status (docs/operations/status-flows.md, the one
 * source), with a rejected order's reason written from its reason code. A code the message file has
 * no sentence for points to the website instead of showing a raw code.
 *
 * An order notice is "update on order X: <status sentence>.", then the notice's own detail (the
 * cashback, a bank request). The server sends the target status with the notice; a row queued
 * before Story 6.6 under a registry key (`order_approved`) is written the same way from the status
 * that key belongs to, and an old rejection without a reason gets the neutral one. A notice
 * without its order id, or whose detail misses a value, has no sentence: never a bare status.
 */
import { statusesOf } from "@cashback/core";

import { dongText, type ReplyMessage } from "./link-reply-text";
import { isMessageKey, MessageIncompleteError, messageText, type MessageKey } from "./messages";

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

/** The detail of each order notice key, and the status it is about when the server did not say. */
const NOTICE_DETAILS: Readonly<Record<string, { readonly detail: MessageKey | null; readonly status: string | null }>> = {
  notice_order: { detail: null, status: null },
  notice_order_recorded: { detail: "notice_order_recorded", status: "AWAITING_APPROVAL" },
  notice_order_approved: { detail: "notice_order_approved", status: "APPROVED" },
  notice_order_approved_add_bank: { detail: "notice_order_approved_add_bank", status: "APPROVED" },
  notice_order_approved_bank_held: { detail: "notice_order_approved_bank_held", status: "APPROVED" },
};

/** A row queued before Story 6.6 under the registry key of a status. */
function legacyNotice(messageKey: string, params: Readonly<Record<string, string | number>>): { detail: MessageKey | null; status: string } | null {
  const status = statusesOf("order").find((s) => s.messageKey === messageKey)?.value ?? null;
  if (status === null) return null;
  if (status === "AWAITING_APPROVAL") return { detail: "notice_order_recorded", status };
  if (status === "APPROVED" && params["cashback"] !== undefined) return { detail: "notice_order_approved", status };
  return { detail: null, status };
}

/**
 * The message of an order notice, `undefined` when `messageKey` is no order notice, null when it is
 * one without a complete sentence.
 */
export function orderNoticeMessage(messageKey: string, params: Readonly<Record<string, string | number>>): ReplyMessage | null | undefined {
  const known = NOTICE_DETAILS[messageKey];
  const notice = known === undefined ? legacyNotice(messageKey, params) : { detail: known.detail, status: typeof params["status"] === "string" ? params["status"] : known.status };
  if (notice === null) return undefined;
  const orderId = params["orderId"];
  if (orderId === undefined || String(orderId) === "" || notice.status === null) return null;
  const reason = params["reason"] === undefined ? null : String(params["reason"]);
  const state = orderStateText(notice.status, reason);
  if (state === null) return null;
  if (notice.detail === null) return { key: "notice_order", values: { orderId: String(orderId), state } };
  const values: Record<string, string> = {};
  if (typeof params["cashback"] === "number") values["cashback"] = dongText(params["cashback"]);
  try {
    return { key: "notice_order_detail", values: { orderId: String(orderId), state, detail: messageText(notice.detail, values) } };
  } catch (error) {
    if (error instanceof MessageIncompleteError) return null;
    throw error;
  }
}
