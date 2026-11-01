/**
 * What a failed link submission means (AD-14, AD-27, D8; Story 5.5 and its review). Most failures
 * are about the one submission and are counted: after `LINK_MAX_ATTEMPTS` counted failures the
 * request is FAILED and its customer is told. The others are not counted:
 *
 * - `captcha`: Shopee parked the session on a verification page. The Shopee queue is held for
 *   `CAPTCHA_HOLD_MS` so the session is not pushed further, and the owner is alerted.
 * - `page_not_ready`, `script_error` (a page error): the custom-link page did not load or its
 *   script broke. On a new request, or on a different request right after another's page error,
 *   it is the session's problem: the queue is held for `PAGE_ERROR_HOLD_MS` with a warning alert.
 *   The same request again right after its own page error is that request's problem: it alone
 *   backs off, uncounted, and the requests behind it go first. A request still meeting page errors
 *   `PAGE_ERROR_FAIL_AFTER_MS` after its first one is FAILED and its customer told.
 * - `login_redirect`: the custom-link page sent the browser to the login page. The queue is paused
 *   until the owner signs in again and resumes it by command, with a critical alert.
 * - `link_unresolved`: the bridge could not resolve a returned short link, so its sub_ids could not
 *   be read. An outage, not the request's fault: it backs off `RESOLUTION_RETRY_MS`, uncounted, and
 *   is never FAILED for it.
 * - `accesstrade_not_in_affiliate`: AccessTrade says the product is outside its programme; no
 *   retry can change that, so the request is FAILED at once and the customer told why.
 *
 * Every alert goes through the alert port, whose per-severity cooldown keeps a repeat inside the
 * cooldown to one alert (AD-27).
 */
import { toMs, type Instant } from "@cashback/core";

export const LINK_MAX_ATTEMPTS = 3;
export const CAPTCHA_HOLD_MS = 5 * 60_000;
export const PAGE_ERROR_HOLD_MS = 60_000;
export const PAGE_ERROR_FAIL_AFTER_MS = 30 * 60_000;
export const RESOLUTION_RETRY_MS = 60_000;

export type QueueHoldReason = "captcha" | "page_error";
export type QueuePauseReason = "login_redirect";

type Severity = "critical" | "high" | "warning";

/** The alert kinds of the link queue; severities as the alert port names them. */
export const LINK_QUEUE_ALERTS = {
  captcha: { kind: "bridge_captcha", severity: "high" },
  page_error: { kind: "bridge_page_error", severity: "warning" },
  login_redirect: { kind: "bridge_login_lost", severity: "critical" },
  link_unresolved: { kind: "bridge_short_link_unresolved", severity: "warning" },
} as const satisfies Record<string, { kind: string; severity: Severity }>;

/** The runbook step a lost login points to (AD-14). */
export const RELOGIN_RUNBOOK = "docs/operations/bridge-runbook.md#sign-in-again";

/** The customer message of a request FAILED at once, by its reason (packages/labels/vi/messages.json). */
export const FINAL_FAILURE_MESSAGES = { accesstrade_not_in_affiliate: "link_not_in_affiliate" } as const;

export type FailureHandling =
  | { readonly kind: "counted" }
  | { readonly kind: "hold"; readonly reason: "captcha"; readonly ms: number }
  | { readonly kind: "page_error" }
  | { readonly kind: "pause"; readonly reason: QueuePauseReason }
  | { readonly kind: "outage"; readonly ms: number }
  | { readonly kind: "final"; readonly messageKey: string };

const PAGE_ERRORS: ReadonlySet<string> = new Set(["page_not_ready", "script_error"]);

export function handlingOf(reason: string): FailureHandling {
  if (reason === "captcha") return { kind: "hold", reason: "captcha", ms: CAPTCHA_HOLD_MS };
  if (PAGE_ERRORS.has(reason)) return { kind: "page_error" };
  if (reason === "login_redirect") return { kind: "pause", reason: "login_redirect" };
  if (reason === "link_unresolved") return { kind: "outage", ms: RESOLUTION_RETRY_MS };
  if (reason === "accesstrade_not_in_affiliate") return { kind: "final", messageKey: FINAL_FAILURE_MESSAGES.accesstrade_not_in_affiliate };
  return { kind: "counted" };
}

export interface PageErrorFacts {
  readonly requestId: string;
  /** The request whose submission last ended in a page error, if the last answer was one. */
  readonly lastPageErrorRequest: string | null;
  /** When this request met its first page error, if it has. */
  readonly since: Instant | null;
  readonly now: Instant;
}

/** What one page error does: hold the queue (session), back this request off, or fail it (30 minutes). */
export function pageErrorStep(facts: PageErrorFacts): "hold" | "back_off" | "fail" {
  if (facts.since !== null && toMs(facts.now) - toMs(facts.since) >= PAGE_ERROR_FAIL_AFTER_MS) return "fail";
  return facts.lastPageErrorRequest === facts.requestId ? "back_off" : "hold";
}
