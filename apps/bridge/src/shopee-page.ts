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

/**
 * The product lookup's two pages (Story 5.6, the live `dashboard_lookup.py` read as reference,
 * without its API calls): the storefront product page for the name, picture and price, then the
 * affiliate offer search for the item's commission rates. Both are opened and read like a person
 * would; only page 1 of the search is ever read (paging sent the live session to Shopee's traffic
 * check), so the search address carries no page or offset. The search can only find by keyword,
 * so it searches the leading words of the product's name, as live.
 */
export const productPageUrl = (shopId: string, itemId: string): string => `https://shopee.vn/product/${shopId}/${itemId}`;
export const OFFER_SEARCH_URL = "https://affiliate.shopee.vn/offer/product_offer";
export const offerSearchUrl = (keyword: string): string => `${OFFER_SEARCH_URL}?keyword=${encodeURIComponent(keyword)}`;
/** Full names are stuffed with keywords and match nothing; the leading words are the product (live). */
export const KEYWORD_WORDS = 8;

/** Where the storefront shows the name, the picture and the price; the first that is there counts. */
export const STOREFRONT_NAME = ['meta[property="og:title"]', "h1"] as const;
export const STOREFRONT_IMAGE = 'meta[property="og:image"]';
export const STOREFRONT_PRICE = ['meta[property="product:price:amount"]', '[class*="price"]'] as const;
/** One product card of the offer search, and its empty state. */
export const OFFER_CARD = '.product-offer-item, [class*="product-card"], [class*="ProductCard"], .ant-card';
export const OFFER_EMPTY = ".ant-empty";
/** The labels of the card's commission and XTRA elements, in Vietnamese (escaped) or English. */
export const COMMISSION_LABEL = "hoa h\u1ed3ng|commission";
export const XTRA_LABEL = "xtra";

/**
 * The conversion report page (Story 5.9; the live `report_reader.py` and `payout_sync.py` read as
 * reference, without their API call): opened at one page of one purchase-time window, like a
 * person paging through it, and read from the table the page itself rendered. Each row of the
 * table carries the conversion the page shows in its React props (`record`), as the live payout
 * reader reads the payout table; the pager carries the total. The address takes the page and the
 * window as query parameters; whether the page honours them is checked on the server (the page
 * number shown, every purchase time inside the window).
 */
export const REPORT_PAGE_URL = "https://affiliate.shopee.vn/report/conversion_report";
export const REPORT_PAGE_SIZE = 50;
export const reportPageUrl = (job: { page: number; purchaseTimeStart: number; purchaseTimeEnd: number }): string =>
  `${REPORT_PAGE_URL}?page_num=${job.page}&page_size=${REPORT_PAGE_SIZE}&purchase_time_s=${job.purchaseTimeStart}&purchase_time_e=${job.purchaseTimeEnd}`;
export const REPORT_ROW = "tr[data-row-key]";
export const REPORT_EMPTY = ".ant-empty";
export const REPORT_PAGER = ".ant-pagination";
export const REPORT_ACTIVE_PAGE = ".ant-pagination-item-active";
export const REPORT_LOADING = ".ant-spin-spinning";
