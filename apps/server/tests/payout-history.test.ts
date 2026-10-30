/**
 * Story 4.12: the payout history lists every payout, voided ones included, on the list contract
 * (FR-17, FR-34, FR-37, AD-12). The paid summary covers the whole filtered set (regression
 * "total paid counts only the last 100 transfers", dashboard.py:2628) and never a voided payout;
 * the date filter is in Vietnam days and includes the whole last day. Void stays admin only.
 */
import { payoutHistoryResponseSchema } from "@cashback/contracts";
import { afterEach, describe, expect, it } from "vitest";

import type { Ledger } from "../src/platform/db/ledger";
import { close, type Servers } from "../src/platform/http/servers";
import { deskGet, deskPost, errorOf, staffCookie } from "./helpers/desk-http";
import { closeLedgers } from "./helpers/order-ledger";
import { CLOCK, codeOf, payoutLedger } from "./helpers/payout-ledger";
import { deskServers } from "./helpers/staff-desk";

let servers: Servers | undefined;
afterEach(async () => {
  if (servers) await close(servers);
  servers = undefined;
  closeLedgers();
});

interface PayoutSpec {
  readonly customer?: string;
  readonly amount: number;
  readonly at: string;
  readonly voided?: boolean;
}

let tokens = 0;

function addPayout(ledger: Ledger, p: PayoutSpec): number {
  const voided = p.voided === true;
  const row = ledger.sqlite
    .prepare("INSERT INTO payouts (customer_id, status, transfer_amount, receipt_token, recorded_by, recorded_at, voided_at, void_reason, voided_by, origin) VALUES (?, ?, ?, ?, 'minh', ?, ?, ?, ?, 'CUTOVER') RETURNING payout_id")
    .get(p.customer ?? "P1", voided ? "VOIDED" : "RECORDED", p.amount, `rcpt_history_${String(++tokens).padStart(6, "0")}`, p.at, voided ? "2026-10-30T13:00:00.000Z" : null, voided ? "Ghi nham" : null, voided ? "minh" : null) as { payout_id: number };
  return row.payout_id;
}

async function history(ledger: Ledger, query: string, staffId = "tuan") {
  servers ??= deskServers(ledger, CLOCK);
  const res = await deskGet(servers, `/api/admin/payout-history${query}`, staffCookie(ledger, staffId, CLOCK), CLOCK);
  expect(res.statusCode).toBe(200);
  return payoutHistoryResponseSchema.parse(res.json());
}

describe("Story 4.12 acceptance criteria", () => {
  it("AC1: with 150 payouts and no filter, the paid summary covers all 150 and the count is the filtered set's (regression 'total paid counts only the last 100 transfers')", async () => {
    const ledger = payoutLedger();
    for (let i = 0; i < 150; i++) addPayout(ledger, { customer: `P${1 + (i % 7)}`, amount: 1000 + i, at: `2026-10-${String(1 + (i % 28)).padStart(2, "0")}T03:00:00.000Z` });
    const page = await history(ledger, "?pageSize=25");
    expect(page.rows).toHaveLength(25);
    expect(page.total).toBe(150);
    const expected = Array.from({ length: 150 }, (_, i) => 1000 + i).reduce((a, b) => a + b, 0);
    expect(page.summary).toEqual({ paidAmount: expected });
    // The newest first, with one value per field and the receipt token of /b/<token>.
    expect(page.rows[0]).toMatchObject({ customerCode: expect.stringMatching(/^DP\d{5}$/), status: "RECORDED", recordedBy: "minh", voidedAt: null, receiptToken: expect.stringMatching(/^rcpt_/) });
    expect(page.rows.map((r) => r.recordedAt)).toEqual([...page.rows.map((r) => r.recordedAt)].sort().reverse());
  });

  it("AC2: a voided payout is listed with the VOIDED status and its void time, keeps its amount, and is excluded from the paid sum", async () => {
    const ledger = payoutLedger();
    addPayout(ledger, { amount: 79216, at: "2026-10-20T03:00:00.000Z" });
    const voided = addPayout(ledger, { customer: "P2", amount: 36000, at: "2026-10-21T03:00:00.000Z", voided: true });
    const page = await history(ledger, "");
    const row = page.rows.find((r) => r.payoutId === voided);
    expect(row).toMatchObject({ status: "VOIDED", amount: 36000, paidAmount: 0, voidedAt: "2026-10-30T13:00:00.000Z", customerCode: codeOf("P2") });
    expect(page.total).toBe(2);
    expect(page.summary).toEqual({ paidAmount: 79216 });
    expect(page.facets["status"]).toEqual([
      { value: "RECORDED", count: 1 },
      { value: "VOIDED", count: 1 },
    ]);
    const onlyVoided = await history(ledger, "?filter[status]=VOIDED");
    expect([onlyVoided.total, onlyVoided.summary]).toEqual([1, { paidAmount: 0 }]);
  });

  it("AC3: any staff member reads the history; the void action behind it is refused to an employee (403) and open to an admin", async () => {
    const ledger = payoutLedger();
    const id = addPayout(ledger, { amount: 50000, at: "2026-10-20T03:00:00.000Z" });
    expect((await history(ledger, "", "tuan")).total).toBe(1);
    expect((await history(ledger, "", "minh")).total).toBe(1);
    const s = servers as Servers;
    const employee = await deskGet(s, `/api/admin/payouts/${id}/void`, staffCookie(ledger, "tuan", CLOCK), CLOCK);
    expect([employee.statusCode, errorOf(employee.body).code]).toEqual([403, "forbidden"]);
    const refused = await deskPost(s, `/api/admin/payouts/${id}/void`, staffCookie(ledger, "tuan", CLOCK), { reason: "x" }, CLOCK);
    expect(refused.statusCode).toBe(403);
    expect((await deskGet(s, `/api/admin/payouts/${id}/void`, staffCookie(ledger, "minh", CLOCK), CLOCK)).statusCode).toBe(200);
  });

  it("AC4: 'this month' is the Vietnam month and includes the whole last day: 00:00 on the 1st and 23:30 on the 31st in, the minute before and the day after out", async () => {
    const ledger = payoutLedger();
    const inside = [addPayout(ledger, { amount: 1, at: "2026-09-30T17:00:00.000Z" }), addPayout(ledger, { amount: 2, at: "2026-10-31T16:30:00.000Z" })];
    addPayout(ledger, { amount: 4, at: "2026-09-30T16:59:59.999Z" });
    addPayout(ledger, { amount: 8, at: "2026-10-31T17:00:00.000Z" });
    const page = await history(ledger, "?filter[recordedAt]=2026-10-01..2026-10-31");
    expect(page.rows.map((r) => r.payoutId).sort()).toEqual(inside.sort());
    expect(page.summary).toEqual({ paidAmount: 3 });
  });

  it("search finds a customer by the name without diacritics or by code, over the same set as the summary", async () => {
    const ledger = payoutLedger();
    addPayout(ledger, { customer: "P1", amount: 100, at: "2026-10-20T03:00:00.000Z" });
    addPayout(ledger, { customer: "P2", amount: 200, at: "2026-10-20T03:00:00.000Z" });
    expect((await history(ledger, "?q=nguyen%20thi")).summary).toEqual({ paidAmount: 100 });
    expect((await history(ledger, `?q=${codeOf("P2")}`)).summary).toEqual({ paidAmount: 200 });
  });
});
