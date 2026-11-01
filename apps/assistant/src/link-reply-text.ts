/**
 * The text of a link reply (FR-1, D3, D60, money rule 11; Story 6.3), from the server's reply
 * facts and the message file. The reply carries the share link, never the affiliate link. An
 * estimate is always "about" an amount and names the customer's share with that amount; a
 * ShopeeFood link names no amount; a link without an estimate says so instead of showing 0 dong.
 * A refusal from the server maps to its own polite message.
 */
import { formatAmountDigits } from "@cashback/core";
import type { AssistantChat, AssistantLinkReply, LinkRefusal } from "@cashback/contracts";

import { messageText, type MessageKey } from "./messages";

export function dongText(amount: number | null): string {
  const digits = amount === null ? null : formatAmountDigits(amount);
  return digits === null ? messageText("value_missing") : messageText("amount_dong", { amount: digits });
}

/** 8000 bps as "80%", 1250 as "12.5%". */
export function percentText(bps: number): string {
  const whole = Math.trunc(bps / 100);
  const decimals = String(bps % 100).padStart(2, "0").replace(/0+$/, "");
  return decimals === "" ? `${whole}%` : `${whole}.${decimals}%`;
}

export interface ReplyMessage {
  readonly key: MessageKey;
  readonly values: Readonly<Record<string, string>>;
}

/** The reply for a link that is made (`shareUrl` set). */
export function linkReplyMessage(reply: AssistantLinkReply & { readonly shareUrl: string }): ReplyMessage {
  const link = reply.shareUrl;
  if (reply.perShop) return { key: "link_ready_shopeefood", values: { link } };
  const product = reply.product.name ?? messageText("value_missing");
  const price = dongText(reply.product.price);
  if (reply.estimate === null) return { key: "link_ready_no_estimate", values: { link, product, price } };
  const values = { link, product, price, cashback: dongText(reply.estimate.cashback), share: percentText(reply.estimate.shareBps) };
  return { key: reply.estimate.withheld ? "link_ready_withheld" : "link_ready", values };
}

/**
 * The reply to each refusal the server's link route can give (every one has a reply; the record
 * type keeps it complete). A link to no shop at all is answered in the private chat as an
 * unsupported link and left unanswered in the group (owner decision, Sprint 25 review).
 */
export const REFUSAL_REPLIES: Readonly<Record<LinkRefusal, { readonly private: MessageKey; readonly group: MessageKey | null }>> = {
  network_unsupported: { private: "link_network_unsupported", group: "link_network_unsupported" },
  not_a_shop_link: { private: "link_network_unsupported", group: null },
  url_too_long: { private: "link_url_too_long", group: "link_url_too_long" },
  tiktok_unavailable: { private: "link_tiktok_unavailable", group: "link_tiktok_unavailable" },
  customer_disabled: { private: "link_customer_disabled", group: "link_customer_disabled" },
  customer_not_found: { private: "link_contact_admin", group: "link_contact_admin" },
  customer_id_unusable: { private: "link_contact_admin", group: "link_contact_admin" },
  day_full: { private: "link_day_full", group: "link_day_full" },
};

/** The message for a refused link in this chat, or null for none. */
export function refusalMessage(reason: LinkRefusal, chat: AssistantChat): MessageKey | null {
  return REFUSAL_REPLIES[reason][chat];
}
