/**
 * Story 4.1: `getBalances` is the one payable definition (AD-6, D27, D42): payable, waiting, paid
 * and deducted-next for any customer, resolved through aliases, with FROZEN and REVERSED counting
 * nowhere and the guest account never holding a balance.
 */
import { estimatedCashback } from "@cashback/money";
import { afterEach, describe, expect, it } from "vitest";

import { resolveCustomer } from "../src/modules/identity/index";
import { getBalances, payableBalances } from "../src/modules/payouts/index";
import type { Ledger } from "../src/platform/db/ledger";
import { closeLedgers, freshLedger } from "./helpers/order-ledger";

afterEach(closeLedgers);

interface OrderSpec {
  id: string;
  customer?: string;
  status: "AWAITING_APPROVAL" | "APPROVED" | "FROZEN" | "REVERSED" | "PAID" | "REJECTED";
  cashback?: number | null;
  estimate?: number | null;
  paidAt?: string | null;
}

function order(ledger: Ledger, o: OrderSpec): void {
  const approved = o.status === "AWAITING_APPROVAL" ? null : 100000;
  ledger.sqlite
    .prepare("INSERT INTO orders (order_id, network, platform, customer_id, status, estimated_commission, approved_commission, cashback, paid_at, origin) VALUES (?, 'shopee', 'shopee', ?, ?, ?, ?, ?, ?, 'CUTOVER')")
    .run(o.id, o.customer ?? "C1", o.status, o.estimate ?? null, approved, o.cashback ?? null, o.paidAt ?? null);
}

function bonus(ledger: Ledger, orderId: string, amount: number, status = "CONFIRMED", customer = "C1"): void {
  ledger.sqlite.prepare("INSERT INTO campaign_awards (campaign_id, customer_id, order_id, amount, status, origin) VALUES ('CAMP1', ?, ?, ?, ?, 'RULE')").run(customer, orderId, amount, status);
}

/** A clawback on a PAID order of the customer (the order is created with it). */
function clawback(ledger: Ledger, id: string, amounts: number[], customer = "C1"): void {
  order(ledger, { id: id.split("-")[0] as string, customer, status: "PAID", cashback: 79216, paidAt: "2026-09-05T03:00:00.000Z" });
  for (const [i, amount] of amounts.entries()) {
    ledger.sqlite
      .prepare("INSERT INTO ledger_entries (customer_id, clawback_id, kind, amount, order_id, created_at, created_by) VALUES (?, ?, ?, ?, ?, '2026-10-30T07:00:00.000Z', 'test')")
      .run(customer, id, i === 0 ? "CLAWBACK" : "NETTING", amount, id.split("-")[0]);
  }
}

function payout(ledger: Ledger, amount: number, status = "RECORDED", customer = "C1"): void {
  ledger.sqlite
    .prepare("INSERT INTO payouts (customer_id, status, transfer_amount, voided_at, void_reason, origin) VALUES (?, ?, ?, ?, ?, 'CUTOVER')")
    .run(customer, status, amount, status === "VOIDED" ? "2026-10-30T07:00:00.000Z" : null, status === "VOIDED" ? "mistake" : null);
}

/** The AC1 customer: two APPROVED unpaid orders and a CONFIRMED bonus. */
function ac1Customer(ledger: Ledger): void {
  order(ledger, { id: "261001APPR0001", status: "APPROVED", cashback: 79216 });
  order(ledger, { id: "261001APPR0002", status: "APPROVED", cashback: 36000 });
  bonus(ledger, "261001APPR0001", 20000);
}

describe("Story 4.1 acceptance criteria", () => {
  it("AC1: two APPROVED unpaid orders of 79,216 and 36,000 and a CONFIRMED bonus of 20,000 are payable 135,216 (golden)", () => {
    const ledger = freshLedger();
    ac1Customer(ledger);
    expect(getBalances(ledger.db, ["C1"])).toEqual([{ customerId: "C1", gross: 135216, payable: 135216, waiting: 0, paid: 0, deductedNext: 0 }]);
  });

  it("AC2: an open clawback of -49,216 leaves 86,000 payable and 49,216 deducted next; one of -200,000 leaves 0, never negative", () => {
    const ledger = freshLedger();
    ac1Customer(ledger);
    clawback(ledger, "260901PAID0001-1", [-99216, 50000]);
    expect(getBalances(ledger.db, ["C1"])).toMatchObject([{ payable: 86000, deductedNext: 49216 }]);

    const other = freshLedger();
    ac1Customer(other);
    clawback(other, "260901PAID0001-1", [-200000]);
    expect(getBalances(other.db, ["C1"])).toMatchObject([{ gross: 135216, payable: 0, deductedNext: 200000 }]);
  });

  it("AC3: of an AWAITING_APPROVAL, a FROZEN and a REVERSED order only the awaiting estimate appears, in waiting", () => {
    const ledger = freshLedger();
    order(ledger, { id: "261001WAIT0001", status: "AWAITING_APPROVAL", estimate: 45000 });
    order(ledger, { id: "261001FROZ0001", status: "FROZEN", cashback: 70000, estimate: 90000 });
    order(ledger, { id: "261001REVS0001", status: "REVERSED", cashback: 50000, estimate: 60000 });
    bonus(ledger, "261001FROZ0001", 20000);
    expect(getBalances(ledger.db, ["C1"])).toEqual([{ customerId: "C1", gross: 0, payable: 0, waiting: estimatedCashback(45000, "shopee"), paid: 0, deductedNext: 0 }]);
    expect(estimatedCashback(45000, "shopee")).toBe(32047);
  });

  it("AC4: a merged customer's orders under the old id are in the survivor's balance, through aliases", () => {
    const ledger = freshLedger();
    ledger.sqlite.exec(`
      INSERT INTO customers (customer_id, customer_code, role, status) VALUES ('COLD', NULL, 'USER', 'MERGED'), ('COLDER', NULL, 'USER', 'MERGED');
      INSERT INTO customer_aliases (alias, customer_id) VALUES ('COLD', 'C1'), ('COLDER', 'COLD');`);
    order(ledger, { id: "261001SURV0001", status: "APPROVED", cashback: 36000 });
    order(ledger, { id: "261001OLDI0001", customer: "COLD", status: "APPROVED", cashback: 79216 });
    order(ledger, { id: "261001OLDI0002", customer: "COLDER", status: "AWAITING_APPROVAL", estimate: 45000 });
    bonus(ledger, "261001OLDI0001", 20000, "CONFIRMED", "COLD");
    clawback(ledger, "260901OLDP0001-1", [-10000], "COLD");
    payout(ledger, 50000, "RECORDED", "COLD");
    const survivor = { customerId: "C1", gross: 135216, payable: 125216, waiting: 32047, paid: 50000, deductedNext: 10000 };
    expect(getBalances(ledger.db, ["C1"])).toEqual([survivor]);
    expect(getBalances(ledger.db, ["COLD", "DP00001", "C1"])).toEqual([survivor]);
  });

  it("AC5: HOUSE gets no balance and is in no payable list", () => {
    const ledger = freshLedger();
    ac1Customer(ledger);
    order(ledger, { id: "261001HOUS0001", customer: "HOUSE", status: "APPROVED", cashback: 0 });
    order(ledger, { id: "261001HOUS0002", customer: "HOUSE", status: "APPROVED", cashback: 5000 });
    bonus(ledger, "261001HOUS0001", 20000, "CONFIRMED", "HOUSE");
    expect(getBalances(ledger.db, ["HOUSE"])).toEqual([]);
    expect(payableBalances(ledger.db).map((b) => b.customerId)).toEqual(["C1"]);
  });
});

describe("Story 4.1: what counts and what does not", () => {
  it("paid is the transfer of RECORDED payouts; a voided payout, a PAID order and a PAID or HELD bonus are not payable", () => {
    const ledger = freshLedger();
    order(ledger, { id: "261001PAID0001", status: "PAID", cashback: 79216, paidAt: "2026-10-05T03:00:00.000Z" });
    order(ledger, { id: "261001APPR0003", status: "APPROVED", cashback: 36000 });
    bonus(ledger, "261001PAID0001", 20000, "PAID");
    bonus(ledger, "261001APPR0003", 20000, "HELD");
    payout(ledger, 99216);
    payout(ledger, 12345, "VOIDED");
    expect(getBalances(ledger.db, ["C1"])).toEqual([{ customerId: "C1", gross: 36000, payable: 36000, waiting: 0, paid: 99216, deductedNext: 0 }]);
  });

  it("an approved order with commission 0 is not payable (R1); an unknown or erased customer has no balance", () => {
    const ledger = freshLedger();
    ledger.sqlite.exec("INSERT INTO orders (order_id, network, platform, customer_id, status, approved_commission, cashback, origin) VALUES ('261001ZERO0001', 'shopee', 'shopee', 'C1', 'APPROVED', 0, 500, 'CUTOVER')");
    expect(getBalances(ledger.db, ["C1", "NOBODY", "CE"])).toEqual([{ customerId: "C1", gross: 0, payable: 0, waiting: 0, paid: 0, deductedNext: 0 }]);
  });

  it("the payable list keeps a netting-only customer (payable 0, gross above 0) and leaves out a customer with nothing to pay", () => {
    const ledger = freshLedger();
    ac1Customer(ledger);
    clawback(ledger, "260901PAID0001-1", [-200000]);
    order(ledger, { id: "261001WAIT0002", customer: "C2", status: "AWAITING_APPROVAL", estimate: 45000 });
    expect(payableBalances(ledger.db)).toEqual([{ customerId: "C1", gross: 135216, payable: 0, waiting: 0, paid: 0, deductedNext: 200000 }]);
  });
});

describe("Story 4.1 code review", () => {
  it("an alias equal to another live customer's id never pulls that customer's money in, and the payable list counts it once", () => {
    const ledger = freshLedger();
    ledger.sqlite.exec("INSERT INTO customer_aliases (alias, customer_id) VALUES ('C2', 'C1')");
    order(ledger, { id: "261001MINE0001", status: "APPROVED", cashback: 36000 });
    order(ledger, { id: "261001THEI0001", customer: "C2", status: "APPROVED", cashback: 79216 });
    expect(getBalances(ledger.db, ["C1"])).toMatchObject([{ customerId: "C1", gross: 36000 }]);
    expect(payableBalances(ledger.db).map((b) => [b.customerId, b.gross])).toEqual([
      ["C1", 36000],
      ["C2", 79216],
    ]);
  });

  it("a merge chain is followed exactly as far as resolveCustomer follows it", () => {
    const ledger = freshLedger();
    const chain = ["M1", "M2", "M3", "M4", "M5", "M6"];
    for (const [i, id] of chain.entries()) {
      ledger.sqlite.prepare("INSERT INTO customers (customer_id, role, status) VALUES (?, 'USER', 'MERGED')").run(id);
      ledger.sqlite.prepare("INSERT INTO customer_aliases (alias, customer_id) VALUES (?, ?)").run(id, i === 0 ? "C1" : chain[i - 1]);
      order(ledger, { id: `261001CHN${i}0001`, customer: id, status: "APPROVED", cashback: 1000 });
    }
    const reached = chain.filter((id) => resolveCustomer(ledger.db, id)?.customerId === "C1");
    expect(reached.length).toBeLessThan(chain.length);
    expect(getBalances(ledger.db, ["C1"])).toMatchObject([{ gross: 1000 * reached.length }]);
    expect(payableBalances(ledger.db)).toMatchObject([{ customerId: "C1", gross: 1000 * reached.length }]);
  });

  it("the payable list's grouped sums equal each customer's getBalances", () => {
    const ledger = freshLedger();
    ac1Customer(ledger);
    clawback(ledger, "260901PAID0001-1", [-99216, 50000]);
    payout(ledger, 12000);
    order(ledger, { id: "261001C2AP0001", customer: "C2", status: "APPROVED", cashback: 9263 });
    order(ledger, { id: "261001C2WT0001", customer: "C2", status: "AWAITING_APPROVAL", estimate: 45000 });
    const list = payableBalances(ledger.db);
    expect(list.map((b) => b.customerId)).toEqual(["C1", "C2"]);
    expect(list).toEqual(getBalances(ledger.db, ["C1", "C2"]));
  });
});
