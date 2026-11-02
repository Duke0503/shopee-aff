/**
 * The customer website's own calls (AD-18, AD-21, FR-9, FR-36; Stories 7.1 and 7.2):
 * `POST /api/session` signs in with the customer code and the password from /matkhau, `GET`
 * answers who is signed in, `DELETE` signs out; the token travels only in the HttpOnly customer
 * cookie. `GET /api/site-status` tells every page whether the Zalo assistant is down, where
 * customers reach the operator meanwhile, and which chat the Zalo buttons open. `CUSTOMER_PATHS` are the website's pages, shared by
 * its router and the server, which answers any other page with the website's not-found page.
 * Written with zod/mini so the website's first script stays small (Story 7.1 AC3).
 */
import { z } from "zod/mini";

/** `DP` and its digits, in any case, as a customer types it; the server compares upper case. */
export const CUSTOMER_CODE_INPUT = /^\s*[dD][pP]\d{1,9}\s*$/;
export const MAX_CUSTOMER_PASSWORD = 256;

export const customerSignInRequestSchema = z.strictObject({
  customerCode: z.string().check(z.maxLength(32)),
  password: z.string().check(z.maxLength(MAX_CUSTOMER_PASSWORD)),
});
export type CustomerSignInRequest = z.infer<typeof customerSignInRequestSchema>;

export const customerSessionResponseSchema = z.object({
  customerCode: z.string().check(z.minLength(1)),
});
export type CustomerSessionResponse = z.infer<typeof customerSessionResponseSchema>;

/** Where customers reach the operator while chat is down: a web page or a phone number. */
export const FALLBACK_CONTACT_URL = /^(https:\/\/[^\s]+|tel:\+?[0-9]{6,15})$/;

/** A Zalo chat link: the assistant's private chat or a group. */
export const ZALO_CHAT_URL = /^https:\/\/zalo\.me\/[A-Za-z0-9/_-]{1,64}$/;

export const siteStatusResponseSchema = z.object({
  assistant: z.enum(["up", "down"]),
  fallbackContactUrl: z.nullable(z.string().check(z.regex(FALLBACK_CONTACT_URL))),
  /** The assistant's private chat; null when the owner has not set ZALO_ASSISTANT_URL. */
  assistantUrl: z.nullable(z.string().check(z.regex(ZALO_CHAT_URL))),
});
export type SiteStatusResponse = z.infer<typeof siteStatusResponseSchema>;

export const CUSTOMER_SESSION_PATH = "/api/session";
export const SITE_STATUS_PATH = "/api/site-status";

/** The website's pages (EXPERIENCE.md information architecture); slugs are Vietnamese without diacritics. */
export const CUSTOMER_PATHS = {
  home: "/",
  signIn: "/dang-nhap",
  myMoney: "/tien-cua-toi",
  account: "/tai-khoan",
  guide: "/huong-dan",
  /** One order in full; the order id travels as `?ma=<orderId>`. */
  orderDetail: "/don-hang",
  missingOrder: "/khong-thay-don",
} as const;
