/**
 * The quiet first run after the cutover import (AD-24, D46, FR-33; Story 6.10). The import turned
 * `messaging.silent` on; this run is the first hourly reconciliation over the given report
 * sources and one link delivery check (Story 6.5), on the imported ledger. Every notification
 * they enqueue is recorded as a would-be send and none becomes due; keys the import seeded as
 * already told stay no-ops. The report counts the would-be sends per event and per message key,
 * and the notifications due afterwards (0 while silent). It refuses to run with the flag off, so
 * it can never be the burst it exists to prevent.
 */
import type { Clock } from "@cashback/core";

import { runLinkDeliveryCheck } from "../links/link-jobs";
import type { LinkDeliveryCheck, WindowedReportSource } from "../modules/linking/index";
import { dueCreatedSince, isSilent, wouldBeSends, type WouldBeSends } from "../modules/messaging/index";
import type { Ledger } from "../platform/db/ledger";
import type { Logger } from "../platform/log/logger";
import { runHourlyReconcile } from "../reconcile/hourly-reconcile.job";

export class FirstRunRefusedError extends Error {
  readonly code = "messaging_not_silent";
  constructor() {
    super("messaging.silent is off: the first run after the cutover must be quiet (D46)");
    this.name = "FirstRunRefusedError";
  }
}

export interface FirstRunInput {
  readonly ledger: Ledger;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly sources: readonly WindowedReportSource[];
  readonly production: boolean;
}

export interface FirstRunReport {
  readonly runs: readonly { readonly network: string; readonly outcome: string; readonly applied: number; readonly errorCode: string | null }[];
  readonly links: LinkDeliveryCheck;
  readonly wouldBeSends: WouldBeSends;
  /** Notifications enqueued by this run that are due: 0 in quiet mode. */
  readonly due: number;
}

export async function runQuietFirstRun(input: FirstRunInput): Promise<FirstRunReport> {
  if (!isSilent(input.ledger.db)) throw new FirstRunRefusedError();
  const since = input.clock.now();
  const runs = await runHourlyReconcile({ ledger: input.ledger, clock: input.clock, logger: input.logger, sources: input.sources, production: input.production });
  const links = runLinkDeliveryCheck(input.ledger, input.clock, input.logger);
  return {
    runs: runs.map((r) => ({ network: r.network, outcome: r.outcome, applied: r.applied, errorCode: r.errorCode })),
    links,
    wouldBeSends: wouldBeSends(input.ledger.db, since),
    due: dueCreatedSince(input.ledger.db, since),
  };
}
