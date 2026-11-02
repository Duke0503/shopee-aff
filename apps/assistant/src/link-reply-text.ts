/**
 * The text of a link reply (FR-1, D3, D60; Story 6.3), from the server's reply facts and the
 * message file, in the live assistant's format (assistant_worker.js `_executeHandleProductLink`,
 * owner requirement 2026-11-02): the ready line naming the shop, the product name cut to 60
 * characters, the share link, the commission parts ("Shopee 5% -> 6.000d", the cap note when
 * Shopee's part hit it), the customer's share with the estimated cashback, and the two tips, with
 * the same parts in bold. A link without an estimate says the customer gets 80% of the commission;
 * a ShopeeFood link names the shop and no amount. The reply carries the share link, never the
 * affiliate link. A refusal from the server maps to its own polite message.
 */
import { formatAmountDigits } from "@cashback/core";
import type { AssistantChat, AssistantLinkReply, LinkRefusal } from "@cashback/contracts";

import { messageText, styledMessage, type MessageKey } from "./messages";
import { joinStyled, plain, type StyledText, type StyledValue } from "./styled-text";

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
  readonly values: Readonly<Record<string, StyledValue>>;
}

const TITLE_MAX = 60;
const TRAILING_SEPARATORS = /[,.\-_\u2013\s]+$/;

/** The product name as the live bot cut it (`formatShortTitle`): one line, at most 60 characters, cut at a word. */
export function shortTitle(name: string | null): string {
  const cleaned = (name ?? "").trim().replace(/\s+/g, " ");
  if (cleaned.length <= TITLE_MAX) return cleaned;
  const cut = cleaned.slice(0, TITLE_MAX);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 25 ? cut.slice(0, lastSpace) : cut).replace(TRAILING_SEPARATORS, "")}...`;
}

const platformOf = (network: AssistantLinkReply["network"]): string => messageText(network === "accesstrade" ? "platform_accesstrade" : "platform_shopee");

const productLineOf = (name: string | null): StyledValue => {
  const short = shortTitle(name);
  return short === "" ? "" : messageText("link_product_line", { product: short });
};

/** A ShopeeFood shop name worth showing: not the generic names the lookup gives when it found none. */
function storeLineOf(name: string | null): StyledValue {
  const store = (name ?? "").trim();
  const generic = store === "" || store.toLowerCase() === messageText("shopeefood_generic_store") || /^shop(\s*\(.*?\))?$/i.test(store) || /^shopeefood$/i.test(store);
  return generic ? "" : messageText("link_store_line", { store });
}

type Estimate = NonNullable<AssistantLinkReply["estimate"]>;

/** The "commission now" lines, bold as live; "updating" when the server sent no parts. */
function commissionLines(estimate: Estimate): StyledText {
  const parts = estimate.parts ?? [];
  if (parts.length === 0) return plain(messageText("link_commission_line_pending"));
  const lines = parts.map((p) =>
    p.part === "shopee"
      ? styledMessage("link_commission_line_shopee", { rate: percentText(p.rateBps), amount: dongText(p.amount), capNote: estimate.capped === true ? messageText("link_commission_cap_note") : "" })
      : styledMessage("link_commission_line_seller", { rate: percentText(p.rateBps), amount: dongText(p.amount) }),
  );
  return joinStyled(lines, "\n");
}

/** The reply for a link that is made (`shareUrl` set). */
export function linkReplyMessage(reply: AssistantLinkReply & { readonly shareUrl: string }): ReplyMessage {
  const link = reply.shareUrl;
  if (reply.perShop) return { key: "link_ready_shopeefood", values: { link, storeLine: storeLineOf(reply.product.name) } };
  const base = { link, platform: platformOf(reply.network), productLine: productLineOf(reply.product.name) };
  if (reply.estimate === null) return { key: "link_ready_no_estimate", values: base };
  return { key: "link_ready", values: { ...base, commissionLines: commissionLines(reply.estimate), share: percentText(reply.estimate.shareBps), cashback: dongText(reply.estimate.cashback) } };
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
