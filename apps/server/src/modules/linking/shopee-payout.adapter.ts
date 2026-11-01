/**
 * The Shopee payout record page read through the affiliate browser (FR-19, AD-14, AD-22, D8, D59;
 * Story 4.22): one bridge job, page 1 only, no call from the server to Shopee. The bridge serves
 * it after any link or lookup, like a report page. The answer is the batches the page rendered,
 * read here by `readShopeePayoutRecords` into whole-dong records for the network-payout recording
 * of Story 4.21, which the composition root runs (this module never writes a payout).
 *
 * While the Shopee queue is held or paused no page is asked for; a page answered with a captcha
 * or the login page holds or pauses the queue as a link submission does. Anything but a readable
 * page fails the read, so nothing is recorded from it.
 */
import { bridgePayoutRecordValueSchema, type NetworkPayoutRecord } from "@cashback/contracts";
import type { Clock } from "@cashback/core";

import type { Ledger, LedgerDb } from "../../platform/db/ledger";
import type { AlertPort } from "../../platform/ports/alert.port";
import type { BridgePort } from "../../platform/ports/bridge.port";
import { readShopeePayoutRecords } from "./domain/shopee-payout-record";
import { shopeeQueueGate } from "./link-queue.command";
import { blockOnSessionPage } from "./shopee-bridge.adapter";

export type PayoutRecordErrorCode = "payout_record_unavailable" | "payout_record_failed" | "payout_record_unreadable";

export class PayoutRecordError extends Error {
  constructor(
    readonly code: PayoutRecordErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PayoutRecordError";
  }
}

export interface ShopeePayoutSourceDeps {
  readonly bridge: BridgePort;
  readonly ledger: Ledger;
  readonly clock: Clock;
  readonly alerts: (db: LedgerDb) => AlertPort;
}

/**
 * The batches page 1 of the payout record page shows, as network-payout records in whole dong,
 * oldest first: a batch's matching window starts at the batch before it, so that one is recorded
 * first (the page lists the newest first).
 */
export async function readShopeePayouts(deps: ShopeePayoutSourceDeps, signal: AbortSignal): Promise<NetworkPayoutRecord[]> {
  const read = deps.bridge.readPayoutRecords;
  if (read === undefined) throw new PayoutRecordError("payout_record_unavailable", "this bridge reads no payout record page");
  const gate = shopeeQueueGate(deps.ledger.db, deps.clock.now());
  if (gate !== "open") throw new PayoutRecordError("payout_record_unavailable", `the Shopee queue is ${gate}; the payout record page is not read`);
  const answer = await read.call(deps.bridge, signal);
  if (answer.outcome === "unavailable") throw new PayoutRecordError("payout_record_unavailable", `the payout record page: ${answer.reason}`);
  if (answer.outcome === "failed") {
    blockOnSessionPage(deps, answer.reason);
    throw new PayoutRecordError("payout_record_failed", `the payout record page: the browser answered ${answer.reason}`);
  }
  const value = bridgePayoutRecordValueSchema.safeParse(answer.value);
  if (!value.success) throw new PayoutRecordError("payout_record_unreadable", "the payout record page: the answer is not a payout record page");
  const page = readShopeePayoutRecords(value.data.list);
  if (!page.ok) throw new PayoutRecordError("payout_record_unreadable", `the payout record page: ${page.problem}`);
  const oldestFirst = [...page.batches].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.networkPayoutId.localeCompare(b.networkPayoutId));
  return oldestFirst.map((b) => ({ network: "shopee", networkPayoutId: b.networkPayoutId, status: b.status, amount: b.amount, eligibleAmount: b.eligibleAmount, createdAt: b.createdAt, paidAt: b.paidAt }));
}
