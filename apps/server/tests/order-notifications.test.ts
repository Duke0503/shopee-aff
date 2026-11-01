/**
 * Story 6.6: order, clawback and payout notifications told once (FR-21, UJ-3, UJ-5, AD-16, D5,
 * D11, D35, D46). Producers enqueue in their own transaction under `<entity>:<id>:<event>`: an
 * approval seen in two runs, a run retried after a rollback, overlapping report windows, a cancel
 * after approval seen again, a freeze and its restore each leave one row per event, and a reopened
 * wrong rejection starts a new lifecycle of keys. The approved notice states the cashback and asks
 * for a bank account (or its confirmation) when there is none to pay to; a payout carries its
 * receipt link and a netting-only payout tells nothing; HOUSE and an erased customer hear nothing.
 * The texts themselves (keys, no dates, percentages with amounts) are checked here and, rendered by
 * the assistant, in apps/assistant/tests/order-notifications.test.ts.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { statusesOf } from "@cashback/core";
import { afterEach, describe, expect, it } from "vitest";

import { applyReviewCase, reportWrongRejection } from "../src/modules/orders/index";
import { ORDER_NOTICES } from "../src/modules/orders/order-steps.command";
import { CLAWBACK_MESSAGE_KEYS, PAYOUT_RECORDED_MESSAGE, PAYOUT_VOIDED_MESSAGE, type ClaimOutcome, type ConfirmOutcome } from "../src/modules/payouts/index";
import { REPOSITORY_ROOT } from "../src/platform/config/env.config";
import type { Ledger, LedgerDb } from "../src/platform/db/ledger";
import type { Actor } from "../src/platform/ports/audit.port";
import { applyDepsFor } from "../src/reconcile/apply-deps";
import { apply, approved, awaiting, cancelled, closeLedgers, freshLedger, HOUR, movingClock, reportRow, type Override } from "./helpers/order-ledger";
import { addBank, addClawback, addOrder, confirmClaim, openClaim, payoutLedger } from "./helpers/payout-ledger";

afterEach(closeLedgers);

const STAFF: Actor = { kind: "staff", id: "staff-anh", role: "EMPLOYEE" };
const staffTx = <T>(ledger: Ledger, clock: ReturnType<typeof movingClock>, fn: (db: LedgerDb, deps: ReturnType<typeof applyDepsFor>) => T): T => ledger.tx((db) => fn(db, applyDepsFor(db, clock, { production: true, actor: STAFF })));
const openCase = (ledger: Ledger, reason: string) => (ledger.sqlite.prepare("SELECT case_id FROM review_cases WHERE reason = ? AND status = 'OPEN'").get(reason) as { case_id: number }).case_id;
const MESSAGES = JSON.parse(readFileSync(join(REPOSITORY_ROOT, "packages/labels/vi/messages.json"), "utf8")) as Record<string, string>;
const all = (ledger: Ledger, sql: string, ...args: unknown[]) => ledger.sqlite.prepare(sql).all(...args) as Record<string, unknown>[];
interface Notice {
  dedup_key: string;
  customer_id: string;
  message_key: string;
  params: Record<string, unknown>;
}
const notices = (ledger: Ledger): Notice[] =>
  (ledger.sqlite.prepare("SELECT dedup_key, customer_id, message_key, params FROM outbox ORDER BY id").all() as (Omit<Notice, "params"> & { params: string })[]).map((r) => ({ ...r, params: JSON.parse(r.params) as Record<string, unknown> }));
const keys = (ledger: Ledger) => notices(ledger).map((n) => n.dedup_key);
const bank = (ledger: Ledger, customer: string, held = false) =>
  ledger.sqlite.prepare("INSERT INTO bank_accounts (customer_id, bank_name, account_number, holder_name, fingerprint, consent_at, pending_confirmation) VALUES (?, 'Vietcombank', '0071000123456', 'NGUYEN THI LAN', 'fp-test', '2026-09-01T03:00:00.000Z', ?)").run(customer, held ? 1 : 0);

/** The sentence with its placeholders filled the simple way, for reading what a customer gets. */
const fill = (key: string, values: Record<string, string>) => (MESSAGES[key] ?? "").replace(/\{(\w+)\}/g, (_w, name: string) => values[name] ?? `{${name}}`);

const recordedPayout = (outcome: ConfirmOutcome) => {
  if (outcome.kind !== "recorded") throw new Error(`expected a payout, got ${outcome.kind}`);
  return outcome.payout;
};
const claimOf = (outcome: ClaimOutcome) => {
  if (outcome.kind !== "claimed") throw new Error(`expected a claim, got ${outcome.kind}`);
  return outcome;
};

describe("Story 6.6: order, clawback and payout notifications told once", () => {
  it("AC1: an order approved twice in the report, in two runs over overlapping windows, enqueues exactly one approved message", () => {
    const ledger = freshLedger();
    const clock = movingClock("2026-10-30T07:00:00.000Z");
    apply(ledger, awaiting("261020TOLD0001"), clock);
    clock.advance(HOUR);
    expect(apply(ledger, approved("261020TOLD0001"), clock).outcome).toBe("changed");
    clock.advance(HOUR);
    // The next window holds the same row again, then a row that differs only in the item value.
    expect(apply(ledger, approved("261020TOLD0001"), clock).outcome).toBe("skipped");
    clock.advance(HOUR);
    expect(apply(ledger, reportRow("261020TOLD0001", "APPROVED", [{ status: "APPROVED", parts: [20000], value: 100001 }]), clock).outcome).toBe("observed");
    expect(keys(ledger)).toEqual(["order:261020TOLD0001:recorded", "order:261020TOLD0001:approved"]);
  });

  it("AC1: told once across retries: a run rolled back after its enqueue tells nothing, and its retry tells once", () => {
    const ledger = freshLedger();
    apply(ledger, awaiting("261020RTRY0001"));
    const failing: Override = (deps) => ({
      outbox: {
        enqueue: (message) => {
          deps.outbox.enqueue(message);
          throw new Error("the run failed after the enqueue");
        },
      },
    });
    expect(() => apply(ledger, approved("261020RTRY0001"), undefined, failing)).toThrow("the run failed");
    expect(keys(ledger)).toEqual(["order:261020RTRY0001:recorded"]);
    apply(ledger, approved("261020RTRY0001"));
    apply(ledger, approved("261020RTRY0001"));
    expect(keys(ledger)).toEqual(["order:261020RTRY0001:recorded", "order:261020RTRY0001:approved"]);
  });

  it("AC1: told once after a cancel after approval: seen in two windows, the reversal is told once, with no second approval", () => {
    const ledger = freshLedger();
    const clock = movingClock("2026-10-30T07:00:00.000Z");
    apply(ledger, approved("261020CNCL0001"), clock);
    clock.advance(HOUR);
    apply(ledger, cancelled("261020CNCL0001"), clock);
    clock.advance(HOUR);
    apply(ledger, reportRow("261020CNCL0001", "CANCELLED", [{ status: "CANCELLED", parts: [0], value: 1 }]), clock);
    expect(notices(ledger).map((n) => [n.dedup_key, n.message_key])).toEqual([
      ["order:261020CNCL0001:recorded", ORDER_NOTICES.recorded],
      ["order:261020CNCL0001:approved", ORDER_NOTICES.approvedAddBank],
      ["order:261020CNCL0001:reversed", ORDER_NOTICES.plain],
    ]);
  });

  it("AC1: a freeze and its restore to approved tell nothing more: the approval keeps the key it was told under", () => {
    const ledger = freshLedger();
    apply(ledger, approved("261020FRZN0001"));
    apply(ledger, reportRow("261020FRZN0001", "UNKNOWN", [{ status: "APPROVED", parts: [20000] }]));
    expect(all(ledger, "SELECT status FROM orders")).toEqual([{ status: "FROZEN" }]);
    expect(keys(ledger)).toEqual(["order:261020FRZN0001:recorded", "order:261020FRZN0001:approved"]);
  });

  it("AC1: a cancel before approval is told once with its reason code, which the assistant writes in words", () => {
    const ledger = freshLedger();
    apply(ledger, awaiting("261020RJCT0001"));
    apply(ledger, cancelled("261020RJCT0001"));
    apply(ledger, cancelled("261020RJCT0001"));
    const rejected = notices(ledger).filter((n) => n.dedup_key === "order:261020RJCT0001:rejected");
    expect(rejected).toEqual([{ dedup_key: "order:261020RJCT0001:rejected", customer_id: "C1", message_key: ORDER_NOTICES.plain, params: { orderId: "261020RJCT0001", status: "REJECTED", reason: "order_cancelled" } }]);
    expect(MESSAGES["rejection_reason_order_cancelled"]).toBeTruthy();
  });

  it("AC2: an approved order of a customer without a bank account states the amount and asks for a bank account", () => {
    const ledger = freshLedger();
    apply(ledger, approved("261020NOBK0001", [10000]));
    const notice = notices(ledger).find((n) => n.dedup_key === "order:261020NOBK0001:approved");
    const cashback = all(ledger, "SELECT cashback FROM orders")[0]?.["cashback"];
    expect(notice).toMatchObject({ message_key: ORDER_NOTICES.approvedAddBank, params: { orderId: "261020NOBK0001", status: "APPROVED", cashback } });
    const detail = fill(ORDER_NOTICES.approvedAddBank, { cashback: `${String(cashback)}d` });
    expect(detail).toContain(`${String(cashback)}d`);
    expect(detail).toContain("/stk");
  });

  it("AC2: no account asks for one, an account waiting for confirmation is a reminder to confirm it, a confirmed one is the plain approval", () => {
    const ledger = freshLedger();
    bank(ledger, "C1", true);
    bank(ledger, "C2");
    apply(ledger, approved("261020HELD0001"));
    apply(ledger, approved("261020BANK0001", [20000], { subIds: ["C2", "REQ2", "", "", ""] }));
    expect(notices(ledger).filter((n) => n.dedup_key.endsWith(":approved")).map((n) => [n.customer_id, n.message_key])).toEqual([
      ["C1", ORDER_NOTICES.approvedBankHeld],
      ["C2", ORDER_NOTICES.approved],
    ]);
    expect(MESSAGES[ORDER_NOTICES.approvedBankHeld]).not.toContain("/stk");
    expect(MESSAGES[ORDER_NOTICES.approved]).not.toContain("/stk");
  });

  it("a rejection after a reopened wrong rejection is told once again, under the next lifecycle key", () => {
    const ledger = freshLedger();
    const clock = movingClock("2026-10-30T07:00:00.000Z");
    apply(ledger, awaiting("261020LIFE0001"), clock);
    apply(ledger, cancelled("261020LIFE0001"), clock);
    clock.advance(HOUR);
    apply(ledger, awaiting("261020LIFE0001"), clock);
    staffTx(ledger, clock, (db, deps) => reportWrongRejection(db, { orderId: "261020LIFE0001", reason: "customer shows the order delivered" }, deps));
    staffTx(ledger, clock, (db, deps) => applyReviewCase(db, { caseId: openCase(ledger, "wrong_rejection"), reason: "rejected on UNPAID" }, deps));
    clock.advance(HOUR);
    apply(ledger, reportRow("261020LIFE0001", "CANCELLED", [{ status: "CANCELLED", parts: [0], value: 2 }]), clock);
    clock.advance(HOUR);
    apply(ledger, reportRow("261020LIFE0001", "CANCELLED", [{ status: "CANCELLED", parts: [0], value: 3 }]), clock);
    expect(keys(ledger)).toEqual(["order:261020LIFE0001:recorded", "order:261020LIFE0001:rejected", "order:261020LIFE0001@1:reopened", "order:261020LIFE0001@1:rejected"]);
  });

  it("a rejection staff decide on a frozen order is told as not eligible, never as a cancel by the network", () => {
    const ledger = freshLedger();
    const clock = movingClock("2026-10-30T07:00:00.000Z");
    apply(ledger, approved("261020STAF0001"), clock);
    apply(ledger, reportRow("261020STAF0001", "UNKNOWN", [{ status: "APPROVED", parts: [20000] }]), clock);
    staffTx(ledger, clock, (db, deps) => applyReviewCase(db, { caseId: openCase(ledger, "unknown_status"), reason: "fraud", outcome: "reject" }, deps));
    expect(notices(ledger).find((n) => n.dedup_key === "order:261020STAF0001:rejected")?.params).toMatchObject({ orderId: "261020STAF0001", status: "REJECTED", reason: "not_eligible" });
    expect(MESSAGES["rejection_reason_not_eligible"]).toBeTruthy();
  });

  it("AC3: a recorded payout carries the receipt link /b/<token>; a netting-only payout enqueues nothing", () => {
    const ledger = payoutLedger();
    addOrder(ledger, { id: "261001A0001", customer: "P1", cashback: 79216 });
    addBank(ledger, "P1");
    const claim = claimOf(openClaim(ledger, "P1"));
    const payout = recordedPayout(confirmClaim(ledger, claim.claim.claimId, claim.snapshot.hash));
    const [notice] = notices(ledger);
    expect(notice).toMatchObject({ dedup_key: `payout:${payout.payoutId}:recorded`, message_key: PAYOUT_RECORDED_MESSAGE, params: { amount: 79216, receiptToken: "rcpt_test_token_0001" } });
    expect(fill(PAYOUT_RECORDED_MESSAGE, { amount: "79.216d", receiptToken: "rcpt_test_token_0001" })).toContain("/b/rcpt_test_token_0001");

    addOrder(ledger, { id: "261002N0001", customer: "P2", cashback: 30000 });
    addClawback(ledger, "P2", "260901C0001", 30000);
    const netting = claimOf(openClaim(ledger, "P2"));
    expect(recordedPayout(confirmClaim(ledger, netting.claim.claimId, netting.snapshot.hash))).toMatchObject({ amount: 0, nettingOnly: true });
    expect(notices(ledger)).toHaveLength(1);
  });

  it("AC4: every key the producers enqueue is in the message file, no notice repeats a status sentence, none names a date", () => {
    const producerKeys = [...Object.values(ORDER_NOTICES), ...Object.values(CLAWBACK_MESSAGE_KEYS), PAYOUT_RECORDED_MESSAGE, PAYOUT_VOIDED_MESSAGE];
    expect(producerKeys.filter((k) => typeof MESSAGES[k] !== "string")).toEqual([]);
    // Each status sentence is defined once, under its registry key; a notice names the status by `{state}`.
    const sentences = statusesOf("order").map((s) => (MESSAGES[s.messageKey ?? ""] ?? "").replace(": {reason}", ""));
    for (const key of Object.values(ORDER_NOTICES)) for (const sentence of sentences) expect(MESSAGES[key], key).not.toContain(sentence);
    expect(MESSAGES["notice_order"]).toContain("{state}");
    expect(MESSAGES["notice_order_detail"]).toContain("{state}");
    for (const key of producerKeys) expect(MESSAGES[key], key).not.toMatch(/\d{1,2}\/\d{1,2}|\{(date|day|days|payoutDate)\}/);
  });

  it("AC5: an event for HOUSE or for an erased customer enqueues nothing", () => {
    const ledger = freshLedger();
    const guest = { subIds: ["HOUSE", "REQH", "", "", ""] };
    apply(ledger, awaiting("261020HOUS0001", [20000], guest));
    apply(ledger, approved("261020HOUS0001", [20000], guest));
    expect(all(ledger, "SELECT customer_id, status FROM orders")).toEqual([{ customer_id: "HOUSE", status: "APPROVED" }]);
    ledger.sqlite.prepare("INSERT INTO orders (order_id, network, platform, customer_id, status, estimated_commission, origin) VALUES ('261020ERSD0001', 'shopee', 'shopee', 'CE', 'AWAITING_APPROVAL', 20000, 'CUTOVER')").run();
    apply(ledger, approved("261020ERSD0001", [20000], { subIds: ["CE", "", "", "", ""] }));
    expect(all(ledger, "SELECT status FROM orders WHERE order_id = '261020ERSD0001'")).toEqual([{ status: "APPROVED" }]);
    expect(notices(ledger)).toEqual([]);
  });
});
