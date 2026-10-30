/**
 * Story 4.6: the Payouts list shows who can be paid and who needs action. Every amount is
 * `getBalances` payable (the one definition, AD-6, D27), the summary is the sum of the same
 * filtered set, awaiting money never appears, flagged customers sit in "needs action" and are
 * never hidden, and settlement is a separate fact. Also the regression tests for the list-defects
 * "Payments" lines that concern the list.
 */
import { payoutListResponseSchema, type PayoutQueueRow } from "@cashback/contracts";
import { fixedClock } from "@cashback/core";
import { afterEach, describe, expect, it } from "vitest";

import { answerPayoutQueue, getBalances, payableBalances, payoutQueueCounts } from "../src/modules/payouts/index";
import { openLedger, type Ledger } from "../src/platform/db/ledger";
import { HttpError } from "../src/platform/http/error-envelope";
import { closeLedgers } from "./helpers/order-ledger";
import { addBank, addBonus, addClawback, addOrder, CLOCK, codeOf, FIXTURE, nameOf, openClaim, payoutLedger, TU } from "./helpers/payout-ledger";

afterEach(closeLedgers);

const responseSchema = payoutListResponseSchema;

function list(ledger: Ledger, query: Record<string, string> = {}, clock = CLOCK) {
  return responseSchema.parse(answerPayoutQueue(ledger, { pageSize: "100", ...query }, clock));
}

const payableTab = (ledger: Ledger, query: Record<string, string> = {}) => list(ledger, { "filter[queue]": "PAYABLE", ...query });
const actionTab = (ledger: Ledger, query: Record<string, string> = {}) => list(ledger, { "filter[queue]": "ACTION", ...query });
const byId = (rows: readonly PayoutQueueRow[], id: string) => rows.find((r) => r.customerId === id);

/** Three payable customers with banks, the amounts of Story 4.1 AC1 among them. */
function threePayable(ledger: Ledger): void {
  addOrder(ledger, { id: "261001A0001", customer: "P1", cashback: 79216 });
  addOrder(ledger, { id: "261001A0002", customer: "P1", cashback: 36000 });
  addBonus(ledger, "P1", "261001A0001", 20000);
  addOrder(ledger, { id: "261001A0003", customer: "P2", cashback: 24860 });
  addOrder(ledger, { id: "261001A0004", customer: "P3", cashback: 9263 });
  for (const id of ["P1", "P2", "P3"]) addBank(ledger, id);
}

describe("Story 4.6 acceptance criteria", () => {
  it("AC1: each row's amount equals getBalances payable and the summary 'N khach, X d' is the sum of the same filtered set", () => {
    const ledger = payoutLedger();
    threePayable(ledger);
    addClawback(ledger, "P2", "260901PAID01", 4860);
    const page = payableTab(ledger);
    expect(page.total).toBe(3);
    for (const row of page.rows) expect(row.payable).toBe(getBalances(ledger.db, [row.customerId])[0]?.payable);
    expect(byId(page.rows, "P1")).toMatchObject({ payable: 135216, customerCode: codeOf("P1"), customerName: nameOf("P1") });
    expect(byId(page.rows, "P2")?.payable).toBe(20000);
    expect(page.summary).toEqual({ payable: 135216 + 20000 + 9263 });

    const searched = payableTab(ledger, { q: codeOf("P3") });
    expect(searched.total).toBe(1);
    expect(searched.summary).toEqual({ payable: 9263 });
  });

  it("AC2: a customer with only awaiting orders is absent, and no query option shows awaiting orders", () => {
    const ledger = payoutLedger();
    threePayable(ledger);
    addOrder(ledger, { id: "261001W0001", customer: "P4", status: "AWAITING_APPROVAL", estimate: 45000 });
    addBank(ledger, "P4");
    expect(getBalances(ledger.db, ["P4"])[0]?.waiting).toBeGreaterThan(0);
    expect(byId(payableTab(ledger).rows, "P4")).toBeUndefined();
    expect(byId(actionTab(ledger).rows, "P4")).toBeUndefined();
    expect(byId(list(ledger).rows, "P4")).toBeUndefined();
    const widening: Record<string, string>[] = [{ showAwaiting: "1" }, { "filter[status]": "AWAITING_APPROVAL" }, { includeTest: "true" }];
    for (const widen of widening) {
      expect(() => list(ledger, widen)).toThrow(HttpError);
    }
  });

  it("AC3: no bank account, a held website change, a change within 72 hours and a shared account each put the row in 'Can xu ly' with its flag, never hidden", () => {
    const ledger = payoutLedger();
    for (const [i, id] of ["P1", "P2", "P3", "P4", "P5", "P6"].entries()) addOrder(ledger, { id: `261001F000${i}`, customer: id, cashback: 10000 + i });
    addBank(ledger, "P2", { held: true });
    addBank(ledger, "P3", { changedAt: "2026-10-28T13:00:00.000Z" });
    addBank(ledger, "P4", { number: "9704000011112222" });
    addBank(ledger, "P5", { number: "9704000011112222" });
    addBank(ledger, "P6", { changedAt: "2026-10-27T11:59:59.000Z" });
    const action = actionTab(ledger);
    expect(Object.fromEntries(action.rows.map((r) => [r.customerId, r.flags]))).toEqual({ P1: "NO_BANK", P2: "BANK_HELD", P3: "BANK_CHANGED", P4: "SHARED_BANK", P5: "SHARED_BANK" });
    expect(payableTab(ledger).rows.map((r) => r.customerId)).toEqual(["P6"]);
    expect(payoutQueueCounts(ledger.db, CLOCK)).toEqual({ payable: 1, action: 5 });
    expect(payableTab(ledger).queues).toEqual({ payable: 1, action: 5 });
    expect(action.total + payableTab(ledger).total).toBe(payableBalances(ledger.db).length);
  });

  it("AC3: an erased or merged customer with the same account no longer makes the account shared", () => {
    const ledger = payoutLedger();
    addOrder(ledger, { id: "261001S0001", customer: "P1", cashback: 10000 });
    addBank(ledger, "P1", { number: "9704000033334444" });
    addBank(ledger, "CE", { number: "9704000033334444" });
    expect(byId(payableTab(ledger).rows, "P1")?.flags).toBe("");
  });

  it("AC4: one customer has one amount, whatever the page size or sort the phone, tablet and desktop ask with", () => {
    const ledger = payoutLedger();
    threePayable(ledger);
    const asks: Record<string, string>[] = [{ pageSize: "25" }, { pageSize: "100", sort: "customerName:asc" }, { pageSize: "50", sort: "orderCount:desc" }];
    const amounts = asks.map((q) => byId(payableTab(ledger, q).rows, "P1")?.payable);
    expect(new Set(amounts)).toEqual(new Set([135216]));
  });

  it("AC5: a partly settled customer is listed, with settlement as a separate fact", () => {
    const ledger = payoutLedger();
    addOrder(ledger, { id: "261001P0001", customer: "P1", cashback: 21480, settled: true });
    addOrder(ledger, { id: "261001P0002", customer: "P1", cashback: 38200, settled: false });
    addOrder(ledger, { id: "261001P0003", customer: "P2", cashback: 9263, settled: true });
    addOrder(ledger, { id: "261001P0004", customer: "P3", cashback: 9263 });
    for (const id of ["P1", "P2", "P3"]) addBank(ledger, id);
    const rows = payableTab(ledger).rows;
    expect(byId(rows, "P1")).toMatchObject({ settlement: "PARTLY_SETTLED", settledCount: 1, orderCount: 2, payable: 59680 });
    expect(byId(rows, "P2")).toMatchObject({ settlement: "SETTLED", settledCount: 1, orderCount: 1 });
    expect(byId(rows, "P3")).toMatchObject({ settlement: "UNSETTLED", settledCount: 0 });
    expect(payableTab(ledger, { "filter[settlement]": "PARTLY_SETTLED" }).rows.map((r) => r.customerId)).toEqual(["P1"]);
  });
});

describe("Story 4.6 context: netting only, claimed rows, the production cancel bug", () => {
  it("review 11: a customer whose clawbacks reach the gross is listed in 'Can xu ly' as netting only with payable 0, never in 'Chuyen duoc'", () => {
    const ledger = payoutLedger();
    addOrder(ledger, { id: "261001N0001", customer: "P1", cashback: 9263 });
    addClawback(ledger, "P1", "260901PAID02", 20000);
    addBank(ledger, "P1");
    expect(byId(actionTab(ledger).rows, "P1")).toMatchObject({ payable: 0, flags: "NETTING_ONLY", queue: "ACTION" });
    expect(byId(payableTab(ledger).rows, "P1")).toBeUndefined();
  });

  it("a row claimed by another staff member names who is paying", () => {
    const ledger = payoutLedger();
    threePayable(ledger);
    expect(openClaim(ledger, "P1", TU).kind).toBe("claimed");
    expect(byId(payableTab(ledger).rows, "P1")).toMatchObject({ claimStaffId: "tuan", claimStaffName: "tuan" });
    expect(byId(payableTab(ledger).rows, "P2")).toMatchObject({ claimStaffId: null, claimStaffName: null });
  });

  it("a cancelled (REVERSED), FROZEN, REJECTED or paid order puts no money on the payout screen", () => {
    const ledger = payoutLedger();
    addOrder(ledger, { id: "261001X0001", customer: "P1", status: "REVERSED", cashback: 50000 });
    addOrder(ledger, { id: "261001X0002", customer: "P1", status: "FROZEN", cashback: 50000 });
    addOrder(ledger, { id: "261001X0003", customer: "P1", status: "REJECTED", cashback: 50000 });
    addOrder(ledger, { id: "261001X0004", customer: "P1", status: "PAID", cashback: 50000 });
    addBonus(ledger, "P1", "261001X0002", 20000);
    addBank(ledger, "P1");
    expect(list(ledger).total).toBe(0);
  });

  it("the guest account is in no list, whatever it is owed", () => {
    const ledger = payoutLedger();
    addOrder(ledger, { id: "261001H0001", customer: "HOUSE", cashback: 50000 });
    expect(list(ledger).total).toBe(0);
  });
});

describe("list-defects 'Payments' regressions on the list", () => {
  it("'total paid counts the last 100': the summary covers every row of the filtered set, not one page", () => {
    const ledger = payoutLedger();
    const insert = ledger.sqlite.prepare("INSERT INTO customers (customer_id, customer_code, role, status, search_text, sort_key) VALUES (?, ?, 'USER', 'ACTIVE', '', '')");
    for (let i = 0; i < 130; i++) {
      const id = `M${i}`;
      insert.run(id, `DP9${String(i).padStart(4, "0")}`);
      addOrder(ledger, { id: `2610M${String(i).padStart(5, "0")}`, customer: id, cashback: 1000 });
      addBank(ledger, id);
    }
    const page = payableTab(ledger, { pageSize: "25" });
    expect(page.rows).toHaveLength(25);
    expect(page.total).toBe(130);
    expect(page.summary).toEqual({ payable: 130_000 });
  });

  it("'cards use the unfiltered set': the summary follows the search", () => {
    const ledger = payoutLedger();
    threePayable(ledger);
    expect(payableTab(ledger, { q: codeOf("P2") }).summary).toEqual({ payable: 24860 });
  });

  it("'the bonus paid card shows unpaid bonuses': a HELD bonus and a PAID bonus put nothing in the list", () => {
    const ledger = payoutLedger();
    addOrder(ledger, { id: "261001B0001", customer: "P1", status: "AWAITING_APPROVAL", estimate: 9000 });
    addOrder(ledger, { id: "261001B0002", customer: "P1", status: "PAID", cashback: 9000 });
    addBonus(ledger, "P1", "261001B0001", 20000, "HELD");
    addBonus(ledger, "P1", "261001B0002", 20000, "PAID");
    addBank(ledger, "P1");
    expect(list(ledger).total).toBe(0);
  });

  it("'needs bank filter and card count different people': the tab count is the tab's list total", () => {
    const ledger = payoutLedger();
    threePayable(ledger);
    addOrder(ledger, { id: "261001K0001", customer: "P4", cashback: 1000 });
    expect(payoutQueueCounts(ledger.db, CLOCK).action).toBe(actionTab(ledger).total);
    expect(payoutQueueCounts(ledger.db, CLOCK).payable).toBe(payableTab(ledger).total);
  });

  it("'search does not fold diacritics': a plain query finds a name written with marks", () => {
    const ledger = payoutLedger();
    threePayable(ledger);
    expect(payableTab(ledger, { q: FIXTURE.foldedQuery }).rows.map((r) => r.customerId)).toEqual(["P1"]);
  });

  it("review 8: a list refresh builds the queue once, returns both tab totals with it, and never takes the ledger write lock", () => {
    const ledger = payoutLedger();
    threePayable(ledger);
    const other = openLedger(ledger.sqlite.name);
    try {
      other.sqlite.exec("BEGIN IMMEDIATE");
      const page = payableTab(ledger, { q: codeOf("P2") });
      expect(page.total).toBe(1);
      expect(page.queues).toEqual({ payable: 3, action: 0 });
      other.sqlite.exec("ROLLBACK");
    } finally {
      other.close();
    }
  });

  it("the list runs on the list contract: an unknown sort is invalid_sort and the temporary rows never outlive the request", () => {
    const ledger = payoutLedger();
    threePayable(ledger);
    expect(() => list(ledger, { sort: "flags:asc" })).toThrow(expect.objectContaining({ code: "invalid_sort" }));
    payableTab(ledger);
    expect(ledger.sqlite.prepare("SELECT count(*) AS n FROM temp.payout_queue").get()).toEqual({ n: 0 });
  });

  it("the 72-hour flag is measured from the request's clock, not the wall clock", () => {
    const ledger = payoutLedger();
    addOrder(ledger, { id: "261001T0001", customer: "P1", cashback: 1000 });
    addBank(ledger, "P1", { changedAt: "2026-10-30T00:00:00.000Z" });
    expect(byId(list(ledger, {}, fixedClock("2026-11-02T00:00:00.000Z")).rows, "P1")?.flags).toBe("BANK_CHANGED");
    expect(byId(list(ledger, {}, fixedClock("2026-11-02T00:00:00.001Z")).rows, "P1")?.flags).toBe("");
  });
});
