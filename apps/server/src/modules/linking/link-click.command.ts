/**
 * Recording a visit to a share link (FR-6, AD-14; Story 5.8), in one transaction: one row per
 * visit by a person, with the code, its request, the time and the kind of browser. A preview bot
 * and a HEAD request are never recorded; the caller decides that, and passes no user agent, so
 * none is ever stored (SECURITY_MODEL.md).
 */
import type { Clock } from "@cashback/core";

import type { LedgerDb } from "../../platform/db/ledger";
import { linkClicks, type LinkClickAgent } from "./schema";

export interface LinkVisit {
  readonly code: string;
  readonly requestId: string;
  readonly agent: Exclude<LinkClickAgent, "buy">;
}

/** Call inside `tx`. */
export function recordLinkClick(db: LedgerDb, visit: LinkVisit, clock: Clock): void {
  db.insert(linkClicks).values({ shareCode: visit.code, requestId: visit.requestId, clickedAt: clock.now(), agent: visit.agent }).run();
}
