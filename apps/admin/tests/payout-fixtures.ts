/**
 * Fake Payouts answers for the admin tests (Stories 4.6, 4.7): list rows, the tab totals and a
 * claim preview, built from fixtures/payouts.json, and a fake server route that records each call.
 */
import type { PayoutPreview, PayoutQueueRow } from "@cashback/contracts";

import { json, type Answer, type Route } from "./app-harness";
import fixtures from "./fixtures/payouts.json";

export { fixtures as PAYOUT_FIXTURES };

export function payoutRow(n: number, overrides: Partial<PayoutQueueRow> = {}): PayoutQueueRow {
  return {
    customerId: `P${n}`,
    customerCode: `DP${String(12 + n).padStart(5, "0")}`,
    customerName: fixtures.names[n % fixtures.names.length] ?? null,
    bankName: fixtures.banks[n % fixtures.banks.length] ?? null,
    accountLastFour: String(6789 - n),
    orderCount: 2,
    settledCount: 0,
    settlement: "UNSETTLED",
    flags: "",
    bankChangedAt: null,
    payable: 79216,
    queue: "PAYABLE",
    claimStaffId: null,
    claimStaffName: null,
    ...overrides,
  };
}

export function payoutsAnswer(rows: readonly PayoutQueueRow[], summary: number): Answer {
  return json(200, { rows, total: rows.length, page: 1, pageSize: 25, facets: {}, summary: { payable: summary }, asOf: "2026-10-30T12:42:00.000Z", queues: { payable: 12, action: 3 } });
}

export function preview(overrides: Partial<PayoutPreview> = {}): PayoutPreview {
  return {
    outcome: "claimed",
    claimId: "K7Q2M9XA",
    transferReference: "DP00012 K7Q2M9XA",
    openedAt: "2026-10-30T12:42:00.000Z",
    customerId: "P0",
    customerCode: "DP00012",
    customerName: fixtures.names[0] ?? null,
    amount: 135216,
    gross: 135216,
    deductedNext: 0,
    bankName: "Vietcombank",
    holderName: fixtures.holder,
    accountLastFour: "3456",
    qrPayload: fixtures.qrPayload,
    qrMissing: null,
    flags: [],
    orders: [
      { orderId: "261001A0001", productName: fixtures.products[0] ?? null, productImageUrl: null, cashback: 79216, settled: true },
      { orderId: "261001A0002", productName: null, productImageUrl: null, cashback: 36000, settled: false },
    ],
    bonuses: [{ awardId: 1, orderId: "261001A0001", campaignName: fixtures.campaign, amount: 20000 }],
    clawbacks: [],
    warning: null,
    ...overrides,
  };
}

export interface PayoutServer {
  readonly route: Route;
  readonly calls: { method: string; path: string; body: unknown }[];
}

/** Answers the list (with the tab totals), the claim, the account copy and the release. */
export function payoutServer(list: (url: URL) => Answer, claim: (customerId: string) => Answer | Promise<Answer> = () => json(200, preview()), account: () => Answer = () => json(200, { accountNumber: "0071000123456" })): PayoutServer {
  const calls: PayoutServer["calls"] = [];
  const route: Route = (url, init) => {
    const method = init?.method ?? "GET";
    const path = url.pathname;
    if (!path.startsWith("/api/admin/payout")) return undefined;
    calls.push({ method, path, body: init?.body === undefined ? undefined : JSON.parse(String(init.body)) });
    if (path === "/api/admin/payouts") return list(url);
    const claimed = /^\/api\/admin\/payouts\/([^/]+)\/claim$/.exec(path);
    if (claimed !== null) return claim(claimed[1] ?? "");
    if (path.endsWith("/account")) return account();
    if (path.endsWith("/release")) return json(200, { claimId: "K7Q2M9XA", status: "ABANDONED" });
    return undefined;
  };
  return { route, calls };
}
