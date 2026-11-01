/**
 * The payout record page job (Story 4.22; the live `payout_sync.py` read as reference, without
 * any API call, D8, INV-10): page 1 of the affiliate payout record page opened like a person
 * would, looked at until its table has loaded (or the wait ends), and answered with the six fields
 * of each row's rendered record. The job has no page parameter and nothing here pages on.
 *
 * A verification or login page is answered as such (the server holds or pauses the queue). An
 * empty table is a page with no batches. A table that never loads is `page_not_ready`; rows whose
 * records cannot be read are `script_error`. Every wait is in the service worker.
 */
import type { BridgeFailure, BridgePayoutRecordJob, BridgePayoutRecordValue } from "@cashback/contracts";

import type { PageDriver, Wait } from "./bridge-tab";
import { Blocked, lookUntil } from "./lookup-job";
import { readPayoutTable, type PayoutTableInput } from "./page-scripts";
import { PAYOUT_EMPTY, PAYOUT_FIELDS, PAYOUT_FIXED_COPIES, PAYOUT_LOADING, PAYOUT_PAGE_SIZE, PAYOUT_RECORD_URL, PAYOUT_ROW } from "./shopee-page";

export type PayoutRecordAnswer = { outcome: "value"; value: BridgePayoutRecordValue } | { outcome: "failed"; reason: BridgeFailure };

const TABLE: PayoutTableInput = { row: PAYOUT_ROW, fixedCopies: PAYOUT_FIXED_COPIES, idField: "payoutId", empty: PAYOUT_EMPTY, loading: PAYOUT_LOADING, maxRows: PAYOUT_PAGE_SIZE, fields: PAYOUT_FIELDS };

export async function runPayoutRecordJob(_job: BridgePayoutRecordJob, page: PageDriver, wait: Wait): Promise<PayoutRecordAnswer> {
  try {
    await page.prepare();
    await page.open(PAYOUT_RECORD_URL);
    const look = await lookUntil(() => page.run(readPayoutTable, TABLE), (l) => l.state !== "waiting", wait);
    if (look.state === "waiting") return { outcome: "failed", reason: "page_not_ready" };
    if (look.state === "unreadable") return { outcome: "failed", reason: "script_error" };
    const list = look.state === "rows" ? (look.records as BridgePayoutRecordValue["list"]) : [];
    return { outcome: "value", value: { list } };
  } catch (error) {
    return { outcome: "failed", reason: error instanceof Blocked ? error.reason : "script_error" };
  }
}
