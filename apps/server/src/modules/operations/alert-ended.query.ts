/**
 * Whether a pending alert's condition has already ended (D69), read from the ledger in the claim's
 * transaction, so a retry looks again. Only evidence ends an alert: with none, or for any other
 * kind, it is sent. No Shopee page is read (D8).
 *
 * - `bridge_captcha`: the browser made a link, a Shopee reconciliation run that succeeded started,
 *   or the captcha was cleared, after the alert was raised and after the latest captcha on record.
 *   A repeat is counted on the waiting row without moving `raised_at`, so a success between two
 *   captchas ends neither the second one nor this alert.
 * - `reconciliation_failed`: each watched network's latest hourly run succeeded after it was raised.
 * - `link_request_stuck`: the request is no longer QUEUED. An unknown request is no evidence.
 */
import { toMs, type Instant } from "@cashback/core";

import type { LedgerDb } from "../../platform/db/ledger";
import { lastBrowserLinkAt, linkRequestStatusOf, shopeeQueueState } from "../linking/index";
import { everyNetworkRecoveredAfter, lastShopeeSuccessStartedAt } from "../orders/index";
import { parseAlertDetail } from "./alert.command";
import type { AlertRow } from "./schema";

function captchaEnded(db: LedgerDb, raisedAt: Instant): boolean {
  const { lastCaptchaAt, captchaClearedAt } = shopeeQueueState(db);
  const after = Math.max(toMs(raisedAt), toMs((lastCaptchaAt ?? raisedAt) as Instant));
  return [lastBrowserLinkAt(db), lastShopeeSuccessStartedAt(db), captchaClearedAt].some((at) => at !== null && toMs(at as Instant) > after);
}

function requestNoLongerQueued(db: LedgerDb, detail: string | null): boolean {
  const requestId = parseAlertDetail(detail)?.requestId;
  if (requestId === undefined) return false;
  const status = linkRequestStatusOf(db, requestId);
  return status !== null && status !== "QUEUED";
}

/** Call inside the claim's `tx`, so the check and the claim read one state. */
export function alertConditionEnded(db: LedgerDb, alert: Pick<AlertRow, "kind" | "raisedAt" | "detail">): boolean {
  const raisedAt = alert.raisedAt as Instant;
  if (alert.kind === "bridge_captcha") return captchaEnded(db, raisedAt);
  if (alert.kind === "reconciliation_failed") return everyNetworkRecoveredAfter(db, raisedAt);
  if (alert.kind === "link_request_stuck") return requestNoLongerQueued(db, alert.detail);
  return false;
}
