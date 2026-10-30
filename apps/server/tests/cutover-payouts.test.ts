/**
 * Story 2.4: payouts, receipts and campaign awards imported from a read-only copy of the live
 * ledger (fixtures/live-schema.sql + fixtures/live-rows.sql), with paid parity to the dong over
 * paid cashback, payout totals and paid bonuses per customer (D44).
 */
import { isPayableAward, type CampaignAwardStatus, type OrderStatus } from "@cashback/core";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { fullPaidParity } from "../src/cutover/paid-parity";
import { findReceipt, isReceiptToken } from "../src/modules/payouts/index";
import { openLedger, type Ledger } from "../src/platform/db/ledger";
import { buildLiveCopy, importOnce, rows } from "./helpers/live-fixture";

type Row = Record<string, string | number | null>;

const source = buildLiveCopy();
const run = importOnce(source);
const payouts = new Map((rows(run.targetPath, "SELECT * FROM payouts") as Row[]).map((p) => [p["payout_id"], p]));
const awards = new Map((rows(run.targetPath, "SELECT * FROM campaign_awards") as Row[]).map((a) => [a["award_id"], a]));
const notesOf = (kind: string) => run.report.notes.filter((n) => n.kind === kind).map((n) => (n.detail === undefined ? n.key : `${n.key}:${n.detail}`));

function withLedger<T>(path: string, fn: (ledger: Ledger) => T): T {
  const ledger = openLedger(path);
  try {
    return fn(ledger);
  } finally {
    ledger.close();
  }
}

describe("Story 2.4 acceptance criteria", () => {
  it("AC1: for every customer the imported payouts, paid cashback and paid bonuses equal the live totals to the dong, and parity passes", () => {
    expect(run.report.paidParity).toEqual({ result: "pass", customers: 3, mismatches: [] });
    expect(rows(run.targetPath, "SELECT customer_id, sum(transfer_amount) AS paid FROM payouts WHERE status = 'RECORDED' GROUP BY customer_id ORDER BY customer_id")).toEqual([
      { customer_id: "1000000000000000001", paid: 6232 },
      { customer_id: "1000000000000000002", paid: 30000 },
      { customer_id: "1000000000000000009", paid: 7000 },
    ]);
    expect(rows(run.targetPath, "SELECT customer_id, sum(amount) AS paid FROM campaign_awards WHERE status = 'PAID' GROUP BY customer_id")).toEqual([{ customer_id: "1000000000000000002", paid: 20000 }]);
  });

  it("AC2: one deliberately altered payout fails parity with that customer and the difference in dong", () => {
    const { targetPath } = importOnce(source);
    const live = new Database(source, { readonly: true });
    try {
      withLedger(targetPath, (ledger) => {
        ledger.sqlite.exec("UPDATE payouts SET transfer_amount = 6000 WHERE payout_id = 1");
        expect(fullPaidParity(live, ledger.sqlite, new Set(["HOUSE"]))).toEqual({
          result: "fail",
          customers: 3,
          mismatches: [{ customerId: "1000000000000000001", measure: "payout_total", live: 6232, imported: 6000, difference: -232 }],
        });
        ledger.sqlite.exec("UPDATE campaign_awards SET amount = 25000 WHERE award_id = 1");
        expect(fullPaidParity(live, ledger.sqlite, new Set(["HOUSE"])).mismatches).toContainEqual({ customerId: "1000000000000000002", measure: "paid_bonus", live: 20000, imported: 25000, difference: 5000 });
      });
    } finally {
      live.close();
    }
  });

  it("AC2: a live transfer the import cannot take (its customer is gone) fails the report's parity", () => {
    const copy = buildLiveCopy({
      extraSql: "INSERT INTO payment_transfers (id, customer_id, amount, order_ids, created_at, bill_token) VALUES (4, 'ghost', 5000, '', '2026-10-09 02:00:00', 'Gh0stTokenGh0stTokenGh0stToken12');",
    });
    const altered = importOnce(copy);
    expect(altered.report.paidParity).toEqual({ result: "fail", customers: 4, mismatches: [{ customerId: "ghost", measure: "payout_total", live: 5000, imported: 0, difference: -5000 }] });
    expect(altered.report.notes).toContainEqual({ kind: "payout_customer_missing", table: "payment_transfers", key: "4" });
  });

  it("AC3: a live bill token is stored unchanged and resolves to its payout, showing facts only (D49)", () => {
    const tokens = rows(source, "SELECT id, bill_token FROM payment_transfers ORDER BY id") as Row[];
    for (const t of tokens) expect(payouts.get(t["id"])?.["receipt_token"]).toBe(t["bill_token"]);
    expect(run.report.comparison["payouts"]).toEqual({ source: 3, imported: 3, mismatches: [] });
    withLedger(run.targetPath, (ledger) => {
      const receipt = ledger.tx((db) => findReceipt(db, "Rk3vQ9xZtYw2mN8pL4sH6dF1gJ0aBcDe"));
      expect(receipt).toEqual({ payoutId: 1, customerCode: "DP00001", bankLastFour: "4455", amount: 6232, recordedAt: "2026-10-05T03:00:05.000Z", voided: false });
      expect(ledger.tx((db) => findReceipt(db, "Zq8wE7rT6yU5iO4p-3sD2fG1hJ0kL9m_"))).toMatchObject({ payoutId: 2, customerCode: "DP00003", amount: 30000 });
      // An old /b/<number> link and an unknown token find nothing.
      for (const token of ["1", "", "Rk3vQ9xZtYw2mN8pL4sH6dF1gJ0aBcDx", "../etc/passwd"]) expect(ledger.tx((db) => findReceipt(db, token))).toBeNull();
    });
    // The proof image stays a staff-only reference: never part of the receipt.
    expect(payouts.get(1)).toMatchObject({ proof_ref: "https://drive.google.com/file/d/fakeproof1/view" });
  });

  it("AC4: a campaign window uses the Vietnam-time rule, and every award keeps its order and state", () => {
    expect(rows(run.targetPath, "SELECT campaign_id, starts_at, ends_at, accepts_awards FROM campaigns ORDER BY campaign_id")).toEqual([
      { campaign_id: "flash2026", starts_at: "2026-10-19T17:00:00.000Z", ends_at: "2026-10-26T17:00:00.000Z", accepts_awards: 0 },
      { campaign_id: "trungthu2026", starts_at: "2026-09-14T17:00:00.000Z", ends_at: "2026-09-30T17:00:00.000Z", accepts_awards: 1 },
    ]);
    expect([...awards.values()].map((a) => [a["award_id"], a["order_id"], a["status"], a["amount"]])).toEqual([
      [1, "260919IIII0009", "PAID", 20000],
      [2, "260916FFFF0006", "HELD", 20000],
      [3, "261001JJJJ0010", "VOID", 20000],
      [4, "260912BBBB0002", "CONFIRMED", 20000],
    ]);
    expect(run.report.comparison["campaign_awards"]).toEqual({ source: 6, imported: 4, mismatches: [] });
    expect(notesOf("award_customer_missing")).toEqual(["5"]);
    expect(notesOf("award_to_guest")).toEqual(["6"]);
    expect(awards.get(1)).toMatchObject({ paid_at: "2026-10-07T02:00:00.000Z", confirmed_at: "2026-10-03T02:05:00.000Z" });
  });

  it("AC5: the ledger entries table is insert-only: an UPDATE or DELETE of an entry is rejected by the trigger", () => {
    const { targetPath } = importOnce(source);
    withLedger(targetPath, (ledger) => {
      expect(rows(targetPath, "SELECT count(*) AS n FROM ledger_entries")).toEqual([{ n: 0 }]);
      ledger.sqlite.exec("INSERT INTO ledger_entries (customer_id, clawback_id, kind, amount, order_id, created_at, created_by) VALUES ('1000000000000000001', 'cb1', 'CLAWBACK', -6232, '260911AAAA0001', '2026-10-30T07:00:00.000Z', 'test')");
      expect(() => ledger.sqlite.exec("UPDATE ledger_entries SET amount = -1")).toThrow(/insert_only: ledger_entries/);
      expect(() => ledger.sqlite.exec("DELETE FROM ledger_entries")).toThrow(/insert_only: ledger_entries/);
      expect(() => ledger.sqlite.exec("INSERT INTO ledger_entries (customer_id, clawback_id, kind, amount, created_at, created_by) VALUES ('1000000000000000001', 'cb1', 'CLAWBACK', 100, '2026-10-30T07:00:00.000Z', 'test')")).toThrow(/CHECK/);
    });
  });
});

describe("Story 2.4: payouts, their orders and the owner's lists", () => {
  it("every payout is RECORDED with no claim (claims are new-system only, D39), its live id, reference and recorder", () => {
    expect([...payouts.values()].map((p) => [p["payout_id"], p["customer_id"], p["status"], p["claim_id"], p["transfer_reference"], p["recorded_by"], p["origin"]])).toEqual([
      [1, "1000000000000000001", "RECORDED", null, "DP00001", "admin", "CUTOVER"],
      [2, "1000000000000000002", "RECORDED", null, null, "nv01", "CUTOVER"],
      [3, "1000000000000000009", "RECORDED", null, "DP00010", "admin", "CUTOVER"],
    ]);
    expect(notesOf("payout_customer_via_alias")).toEqual(["2"]);
  });

  it("links each covered order with its stored cashback and its paid bonus; a named order that does not exist is listed", () => {
    expect(rows(run.targetPath, "SELECT payout_id, line_no, kind, order_id, award_id, amount FROM payout_items ORDER BY payout_id, line_no")).toEqual([
      { payout_id: 1, line_no: 1, kind: "ORDER", order_id: "260911AAAA0001", award_id: null, amount: 6232 },
      { payout_id: 2, line_no: 1, kind: "ORDER", order_id: "260919IIII0009", award_id: null, amount: 10000 },
      { payout_id: 2, line_no: 2, kind: "AWARD", order_id: "260919IIII0009", award_id: 1, amount: 20000 },
    ]);
    expect(notesOf("payout_order_missing")).toEqual(["1:NOPE00000001"]);
    expect(run.report.payouts?.itemDifferences).toEqual([]);
  });

  it("lists every paid order no payout covers, instead of inventing a payout, and the payouts that named no order", () => {
    expect(run.report.payouts).toMatchObject({
      imported: 3,
      items: 3,
      receiptTokens: 3,
      paidWithoutPayout: [
        { orderId: "261001JJJJ0010", customerId: "1000000000000000009", cashback: 7000 },
        { orderId: "TT0000000000000007", customerId: "1000000000000000001", cashback: null },
      ],
      payoutsWithoutOrders: [3],
    });
    expect(rows(run.targetPath, "SELECT count(*) AS n FROM payout_items WHERE order_id IN ('261001JJJJ0010', 'TT0000000000000007')")).toEqual([{ n: 0 }]);
  });

  it("an order named by two transfers is linked to the first and listed; one of another customer or not paid is listed, never linked", () => {
    const copy = buildLiveCopy({
      extraSql: `INSERT INTO payment_transfers (id, customer_id, amount, order_ids, created_at, bill_token) VALUES
        (4, '1000000000000000001', 6232, '260911AAAA0001,261001JJJJ0010,260916FFFF0006', '2026-10-09 02:00:00', 'Tw1ceTokenTw1ceTokenTw1ceToken12');`,
    });
    const twice = importOnce(copy);
    expect(rows(twice.targetPath, "SELECT payout_id, order_id FROM payout_items WHERE order_id = '260911AAAA0001'")).toEqual([{ payout_id: 1, order_id: "260911AAAA0001" }]);
    const kinds = (kind: string) => twice.report.notes.filter((n) => n.kind === kind).map((n) => `${n.key}:${n.detail ?? ""}`);
    expect(kinds("payout_order_twice")).toEqual(["4:260911AAAA0001"]);
    expect(kinds("payout_order_other_customer")).toEqual(["4:261001JJJJ0010"]);
    expect(kinds("payout_order_not_paid")).toEqual(["4:260916FFFF0006"]);
    expect(twice.report.payouts?.itemDifferences).toEqual([]);
    expect(twice.report.payouts?.payoutsWithoutOrders).toEqual([3, 4]);
  });

  it("a transfer for the guest account is never a payout (D5) and is listed", () => {
    const copy = buildLiveCopy({ extraSql: "INSERT INTO payment_transfers (id, customer_id, amount, created_at, bill_token) VALUES (4, 'HOUSE', 3000, '2026-10-09 02:00:00', 'H0useTokenH0useTokenH0useToken12');" });
    const guest = importOnce(copy);
    expect(rows(guest.targetPath, "SELECT count(*) AS n FROM payouts WHERE customer_id = 'HOUSE'")).toEqual([{ n: 0 }]);
    expect(guest.report.notes).toContainEqual({ kind: "payout_to_guest", table: "payment_transfers", key: "4" });
    expect(guest.report.paidParity?.result).toBe("pass");
  });

  it("a transfer without a bill token is imported with none and listed", () => {
    const copy = buildLiveCopy({ extraSql: "UPDATE payment_transfers SET bill_token = NULL WHERE id = 3;" });
    const noToken = importOnce(copy);
    expect(rows(noToken.targetPath, "SELECT receipt_token FROM payouts WHERE payout_id = 3")).toEqual([{ receipt_token: null }]);
    expect(noToken.report.notes).toContainEqual({ kind: "bill_token_missing", table: "payment_transfers", key: "3" });
  });
});

describe("Story 2.4: awards and their orders", () => {
  it("a HELD award is never payable, and an award on a FROZEN order is suspended (D55)", () => {
    const joined = rows(run.targetPath, "SELECT a.award_id, a.status, o.status AS order_status FROM campaign_awards a JOIN orders o USING (order_id) ORDER BY a.award_id") as { award_id: number; status: CampaignAwardStatus; order_status: OrderStatus }[];
    const payable = joined.filter((a) => isPayableAward({ status: a.status, orderStatus: a.order_status })).map((a) => a.award_id);
    expect(payable).toEqual([4]);
    expect(joined.find((a) => a.award_id === 2)).toEqual({ award_id: 2, status: "HELD", order_status: "FROZEN" });
    expect(run.report.campaigns).toEqual({ imported: 2, awards: 4, awardsByStatus: { CONFIRMED: 1, HELD: 1, PAID: 1, VOID: 1 }, suspendedAwards: [2], stopped: [{ campaignId: "flash2026", reason: "stopped_live" }] });
    expect(notesOf("campaign_stopped")).toEqual(["flash2026:stopped"]);
  });

  it("follows the merged customer's old Zalo id to the survivor and lists awards whose state disagrees with their order", () => {
    expect(awards.get(4)).toMatchObject({ customer_id: "1000000000000000002" });
    expect(notesOf("award_customer_via_alias")).toEqual(["4"]);
    const copy = buildLiveCopy({ extraSql: "UPDATE campaign_awards SET status = 'confirmed' WHERE id = 1; UPDATE campaign_awards SET status = 'paid' WHERE id = 4; UPDATE campaign_awards SET status = 'won' WHERE id = 2;" });
    const odd = importOnce(copy);
    const kinds = (kind: string) => odd.report.notes.filter((n) => n.kind === kind).map((n) => n.key);
    expect(kinds("award_confirmed_order_paid")).toEqual(["1"]);
    expect(kinds("award_paid_order_unpaid")).toEqual(["4"]);
    expect(kinds("unknown_award_status")).toEqual(["2"]);
  });
});

describe("Story 2.4 review fixes", () => {
  it("a campaign whose start or end cannot be read gives no new slot and is listed as stopped with the reason", () => {
    const unreadable = importOnce(buildLiveCopy({ extraSql: "UPDATE campaigns SET starts_at = 'không rõ' WHERE campaign_id = 'trungthu2026';" }));
    expect(rows(unreadable.targetPath, "SELECT starts_at, accepts_awards FROM campaigns WHERE campaign_id = 'trungthu2026'")).toEqual([{ starts_at: null, accepts_awards: 0 }]);
    expect(unreadable.report.campaigns?.stopped).toEqual([
      { campaignId: "flash2026", reason: "stopped_live" },
      { campaignId: "trungthu2026", reason: "window_unreadable" },
    ]);
    expect(unreadable.report.timeProblems).toContainEqual({ table: "campaigns", key: "trungthu2026", column: "starts_at" });
    const inverted = importOnce(buildLiveCopy({ extraSql: "UPDATE campaigns SET ends_at = '2026-09-01T00:00' WHERE campaign_id = 'trungthu2026';" }));
    expect(inverted.report.campaigns?.stopped).toContainEqual({ campaignId: "trungthu2026", reason: "window_invalid" });
  });

  it("the receipt shows the last four of the account the transfer recorded, else the customer's at import (named in the report), never ''", () => {
    expect(run.report.payouts?.bankFromCustomerAtImport).toEqual([1, 2, 3]);
    const paidTo = importOnce(buildLiveCopy({ extraSql: "ALTER TABLE payment_transfers ADD COLUMN bank_account TEXT; UPDATE payment_transfers SET bank_account = '9999 8888 7777' WHERE id = 1; UPDATE customers SET bank_account = '---' WHERE customer_id = '1000000000000000002';" }));
    expect(rows(paidTo.targetPath, "SELECT payout_id, bank_last_four FROM payouts ORDER BY payout_id")).toEqual([
      { payout_id: 1, bank_last_four: "7777" },
      { payout_id: 2, bank_last_four: null },
      { payout_id: 3, bank_last_four: null },
    ]);
    expect(paidTo.report.payouts?.bankFromCustomerAtImport).toEqual([2, 3]);
  });

  it("two live awards holding one slot never abort the import: the earliest is kept and the other listed", () => {
    const copy = buildLiveCopy({
      extraSql: `DROP INDEX idx_award_order;
        INSERT INTO campaign_awards (id, campaign_id, customer_id, order_id, amount, status, created_at, notified_status) VALUES (7, 'trungthu2026', '1000000000000000002', '260919IIII0009', 20000, 'held', '2026-09-19T09:06:00+07:00', 'held');`,
    });
    const dup = importOnce(copy);
    expect(dup.report.outcome.ok).toBe(true);
    expect(rows(dup.targetPath, "SELECT award_id FROM campaign_awards WHERE order_id = '260919IIII0009'")).toEqual([{ award_id: 1 }]);
    expect(dup.report.notes).toContainEqual({ kind: "duplicate_live_award", table: "campaign_awards", key: "7", detail: "1" });
    expect(dup.report.comparison["campaign_awards"]?.mismatches).toEqual([]);
  });

  it("a repeated bill token stays on the earliest payout and a malformed one is kept but not counted, both listed", () => {
    const copy = buildLiveCopy({
      extraSql: `DROP INDEX idx_transfer_bill_token;
        UPDATE payment_transfers SET bill_token = 'Rk3vQ9xZtYw2mN8pL4sH6dF1gJ0aBcDe' WHERE id = 3;
        UPDATE payment_transfers SET bill_token = 'not a token' WHERE id = 2;`,
    });
    const odd = importOnce(copy);
    expect(odd.report.outcome.ok).toBe(true);
    expect(rows(odd.targetPath, "SELECT payout_id, receipt_token FROM payouts ORDER BY payout_id")).toEqual([
      { payout_id: 1, receipt_token: "Rk3vQ9xZtYw2mN8pL4sH6dF1gJ0aBcDe" },
      { payout_id: 2, receipt_token: "not a token" },
      { payout_id: 3, receipt_token: null },
    ]);
    expect(odd.report.notes).toContainEqual({ kind: "bill_token_duplicate", table: "payment_transfers", key: "3" });
    expect(odd.report.notes).toContainEqual({ kind: "bill_token_malformed", table: "payment_transfers", key: "2" });
    expect(odd.report.payouts?.receiptTokens).toBe(1);
  });

  it("findReceipt opens every token shape the live system issued (secrets.token_urlsafe(24)) and nothing else", () => {
    for (const token of ["Rk3vQ9xZtYw2mN8pL4sH6dF1gJ0aBcDe", "Zq8wE7rT6yU5iO4p-3sD2fG1hJ0kL9m_", "-_-_-_-_-_-_-_-_-_-_-_-_-_-_-_-_", "A".repeat(16), "A".repeat(128)]) expect(isReceiptToken(token)).toBe(true);
    for (const token of ["", "1", "12345678901234567890", "A".repeat(15), "A".repeat(129), "has space in it here!", "abc/def/ghi/jklmnop"]) expect(isReceiptToken(token)).toBe(false);
  });

  it("a loss told on an award that holds its slot again is not seeded; the win it owes is listed", () => {
    const reheld = importOnce(buildLiveCopy({ extraSql: "UPDATE campaign_awards SET status = 'held', voided_at = NULL WHERE id = 3;" }));
    expect(rows(reheld.targetPath, "SELECT dedup_key FROM outbox WHERE dedup_key LIKE 'campaign_award:3:%'")).toEqual([]);
    expect(reheld.report.notifications?.listed).toContain("campaign_award:3:held");
    expect(reheld.report.notifications?.listed).not.toContain("campaign_award:3:void");
  });
});

describe("Story 2.4: notifications the live system already sent (D46, left from Story 2.5)", () => {
  it("seeds a sent key for every told payout and award event, and lists the ones still owed", () => {
    const seeded = rows(run.targetPath, "SELECT dedup_key, customer_id, message_key, sent_at, due_at FROM outbox WHERE dedup_key LIKE 'payout:%' OR dedup_key LIKE 'campaign_award:%' ORDER BY dedup_key") as Row[];
    expect(seeded.map((r) => r["dedup_key"])).toEqual(["campaign_award:1:held", "campaign_award:2:held", "campaign_award:3:held", "campaign_award:3:void", "payout:1:recorded", "payout:3:recorded"]);
    expect(seeded.find((r) => r["dedup_key"] === "payout:1:recorded")).toMatchObject({ customer_id: "1000000000000000001", message_key: "payout_recorded", sent_at: "2026-10-05T03:00:05.000Z", due_at: null });
    expect(seeded.find((r) => r["dedup_key"] === "campaign_award:3:void")).toMatchObject({ message_key: "campaign_slot_lost", due_at: null });
    expect(run.report.notifications?.listed.filter((k) => k.startsWith("payout:") || k.startsWith("campaign_award:"))).toEqual(["campaign_award:4:held", "payout:2:recorded"]);
    expect(run.report.notifications?.seededByEvent).toMatchObject({ "payout:recorded": 2, "campaign_award:held": 3, "campaign_award:void": 1 });
  });
});

describe("Story 2.4: the import as one command", () => {
  it("writes one audit entry per module import, by the system actor cutover, ids and counts only (AD-17)", () => {
    expect(rows(run.targetPath, "SELECT actor_kind, actor_id, event, payload FROM audit_entries ORDER BY id")).toEqual([
      { actor_kind: "system", actor_id: "cutover", event: "identity.customers.imported", payload: '{"customers":9,"aliases":2,"bankAccounts":3,"counterLast":412}' },
      { actor_kind: "system", actor_id: "cutover", event: "linking.link_requests.imported", payload: '{"productOffers":3,"linkRequests":8,"shareCodes":3}' },
      { actor_kind: "system", actor_id: "cutover", event: "orders.orders.imported", payload: '{"orders":10,"items":10,"history":10,"settlementPeriods":2}' },
      { actor_kind: "system", actor_id: "cutover", event: "campaigns.campaigns.imported", payload: '{"campaigns":2,"awards":4}' },
      { actor_kind: "system", actor_id: "cutover", event: "payouts.payouts.imported", payload: '{"payouts":3,"items":3}' },
      { actor_kind: "system", actor_id: "cutover", event: "messaging.outbox.seeded", payload: '{"seeded":16}' },
    ]);
  });

  it("is deterministic: two imports of one source give identical payout and campaign tables", () => {
    const again = importOnce(source);
    for (const table of ["payouts", "payout_items", "campaigns", "campaign_awards", "audit_entries"]) {
      expect(rows(again.targetPath, `SELECT * FROM ${table}`)).toEqual(rows(run.targetPath, `SELECT * FROM ${table}`));
    }
  });
});
