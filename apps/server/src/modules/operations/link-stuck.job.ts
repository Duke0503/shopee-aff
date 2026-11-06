/**
 * One owner message per stuck request (D65): while the Shopee queue is stopped by a captcha or a
 * lost login, each request it keeps waiting raises `link_request_stuck` once, ever, with the reason
 * as its detail. The kind's cooldown does not apply, the key alone decides. A page error hold is not
 * a stop. The check reads the ledger only, no Shopee page (D8). Log lines carry ids and kinds.
 */
import type { Clock } from "@cashback/core";

import type { Ledger } from "../../platform/db/ledger";
import type { Logger } from "../../platform/log/logger";
import { queuedShopeeRequests, shopeeQueueStopReason } from "../linking/index";
import { raiseKeyedAlert } from "./alert.command";

export const LINK_REQUEST_STUCK_ALERT = { kind: "link_request_stuck", severity: "high" } as const;

/** One check; returns how many requests were newly told. */
export function raiseStuckRequestAlerts(ledger: Pick<Ledger, "tx">, clock: Clock, logger: Pick<Logger, "warn">): number {
  return ledger.tx((db) => {
    const reason = shopeeQueueStopReason(db, clock.now());
    if (reason === null) return 0;
    let raised = 0;
    for (const requestId of queuedShopeeRequests(db)) {
      if (!raiseKeyedAlert(db, clock, { ...LINK_REQUEST_STUCK_ALERT, dedupKey: `${LINK_REQUEST_STUCK_ALERT.kind}:${requestId}`, detail: { source: reason, requestId } })) continue;
      raised++;
      logger.warn({ kind: LINK_REQUEST_STUCK_ALERT.kind, requestId, source: reason }, "operations.alert.raised");
    }
    return raised;
  });
}
