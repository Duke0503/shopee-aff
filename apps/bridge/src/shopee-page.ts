/**
 * The Shopee Affiliate custom link page as the live system drives it (`page_selectors.py` on main,
 * read as reference): the one place to edit when Shopee changes the page. The page's own form is
 * filled and submitted like a person would; nothing here calls a Shopee API or builds a request
 * signature (D8, INV-10). The page carries one set of sub_ids per submission, so one submission is
 * one link for one customer (D7, D47); Shopee returns them in `utm_content` as
 * `sub1-sub2---`.
 */

import { hostOnDomain, SHOPEE_LINK_DOMAINS } from "@cashback/core";

export const CUSTOM_LINK_URL = "https://affiliate.shopee.vn/offer/custom_link";
/** The tab list query that finds the bridge tab again after a restart. */
export const AFFILIATE_TAB_PATTERN = "https://affiliate.shopee.vn/*";

export const SOURCE_TEXTAREA = ".custom-textarea > textarea";
export const SUB_ID_FIELDS = [1, 2, 3, 4, 5].map((n) => `#customLink_sub_id${n}`);
/** Matched by its label, in Vietnamese (an ASCII dot stands for the accented letter) or English. */
export const SUBMIT_BUTTON_TEXT = "l.y link|get link";
/** The generated link lands in a disabled textarea, read through `.value`. */
export const RESULT_FIELD = "textarea.ant-input.ant-input-disabled";
export const PAGE_ERROR = ".ant-form-item-explain-error, .ant-message-error, .ant-notification-notice-error, .ant-alert-error";

/** Where Shopee parks a session it distrusts; only a person can clear it. */
export const VERIFICATION_MARKERS = ["/verify/"] as const;
export const LOGIN_MARKERS = ["/login", "/signin", "passport", "/account"] as const;

export const onShopee = (host: string): boolean => hostOnDomain(host, SHOPEE_LINK_DOMAINS);

/** True for an http(s) link on a Shopee domain: the only kind of source a link job may carry. */
export function isShopeeLink(text: string, httpsOnly = false): boolean {
  if (!URL.canParse(text)) return false;
  const url = new URL(text);
  if (url.protocol !== "https:" && (httpsOnly || url.protocol !== "http:")) return false;
  return url.username === "" && url.password === "" && onShopee(url.hostname.toLowerCase());
}

export type PageBlock = "captcha" | "login_redirect" | null;

/** A whole-session state the tab is in, read from its address and whether it shows a password box. */
export function pageBlock(href: string, passwordBox: boolean): PageBlock {
  if (VERIFICATION_MARKERS.some((m) => href.includes(m))) return "captcha";
  if (passwordBox || LOGIN_MARKERS.some((m) => href.includes(m))) return "login_redirect";
  return null;
}
