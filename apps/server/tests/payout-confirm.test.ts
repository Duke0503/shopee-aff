/**
 * Story 4.8: confirming a transfer records the payout exactly once (AD-9, AD-6, AD-16, AD-17, D4,
 * D19, D32, D39, D42, INV-2, INV-3, INV-4). One transaction writes the payout, its items, every
 * covered order PAID with history, the bonuses PAID, the netting entries, the audit entry, the
 * outbox row and the CONFIRMED claim; a retry returns the same payout and writes nothing; any
 * change since the preview writes nothing and asks for a new preview.
 */
import { errorEnvelopeSchema, payoutClaimResponseSchema, payoutConfirmResponseSchema, type PayoutPreview } from "@cashback/contracts";
import { fixedClock } from "@cashback/core";
import { afterEach, describe, expect, it } from "vitest";

import { bankFingerprint, openSession, STAFF_SESSION_MS } from "../src/modules/identity/index";
import { commandAudit } from "../src/modules/operations/index";
import { clawbackOpen, getBalances, PayoutClaimError, runClaimExpiry, type ClaimOutcome, type ClaimedPayout, type ConfirmOutcome, type RecordedPayout } from "../src/modules/payouts/index";
import type { Ledger } from "../src/platform/db/ledger";
import { ACCESS_JWT_HEADER } from "../src/platform/http/access-jwt.guard";
import { close, type Servers } from "../src/platform/http/servers";
import { STAFF_SESSION_COOKIE } from "../src/platform/http/session-cookie";
import { apply, approved, cancelled, closeLedgers } from "./helpers/order-ledger";
import { addBank, addBonus, addClawback, addOrder, claimIds, CLOCK, confirmClaim, FINGERPRINT_KEY, MINH, NOW, openClaim, payoutLedger, TU, writeCounts } from "./helpers/payout-ledger";
import { accessJwt, ADMIN_HOST, deskServers, ORIGIN } from "./helpers/staff-desk";

let servers: Servers | undefined;
afterEach(async () => {
  if (servers) await close(servers);
  servers = undefined;
  closeLedgers();
});

const claimed = (outcome: ClaimOutcome): ClaimedPayout => {
  if (outcome.kind !== "claimed") throw new Error(`expected a claim, got ${outcome.kind}`);
  return outcome;
};
const recorded = (outcome: ConfirmOutcome): RecordedPayout => {
  if (outcome.kind !== "recorded") throw new Error(`expected a payout, got ${outcome.kind}`);
  return outcome.payout;
};
const all = (ledger: Ledger, sql: string) => ledger.sqlite.prepare(sql).all() as Record<string, unknown>[];
const at = (iso: string) => fixedClock(iso);
const expire = (ledger: Ledger, iso: string) => runClaimExpiry({ ledger, clock: at(iso), audit: (db, actor) => commandAudit(db, at(iso), actor) });

/** Lan (P1): two approved orders 79,216 and 36,000, a bonus of 20,000 on the first, an awaiting order, a Vietcombank account. */
function lan(ledger: Ledger): void {
  addOrder(ledger, { id: "261001A0001", customer: "P1", cashback: 79216 });
  addOrder(ledger, { id: "261001A0002", customer: "P1", cashback: 36000 });
  addOrder(ledger, { id: "261001W0001", customer: "P1", status: "AWAITING_APPROVAL", estimate: 45000 });
  addBonus(ledger, "P1", "261001A0001", 20000);
  addBank(ledger, "P1", { number: "0071000123456" });
}

describe("Story 4.8 acceptance criteria", () => {
  it("AC1 (golden): confirming an unchanged OPEN claim records the payout, makes every covered order PAID with paid_at and history, confirms the claim and enqueues one outbox row", () => {
    const ledger = payoutLedger();
    lan(ledger);
    const claim = claimed(openClaim(ledger, "P1", MINH, CLOCK, claimIds("K7Q2M9XA")));
    const payout = recorded(confirmClaim(ledger, claim.claim.claimId, claim.snapshot.hash));

    expect(payout).toMatchObject({ claimId: "K7Q2M9XA", customerId: "P1", amount: 135216, netted: 0, nettingOnly: false, orderCount: 2, awardCount: 1, receiptToken: "rcpt_test_token_0001", recordedAt: NOW });
    expect(all(ledger, "SELECT customer_id, status, transfer_amount, transfer_reference, receipt_token, bank_last_four, claim_id, recorded_by, recorded_at, origin FROM payouts")).toEqual([
      { customer_id: "P1", status: "RECORDED", transfer_amount: 135216, transfer_reference: claim.claim.transferReference, receipt_token: "rcpt_test_token_0001", bank_last_four: "3456", claim_id: "K7Q2M9XA", recorded_by: "minh", recorded_at: NOW, origin: "CONFIRM" },
    ]);
    expect(all(ledger, "SELECT line_no, kind, order_id, award_id, amount FROM payout_items ORDER BY line_no")).toEqual([
      { line_no: 1, kind: "ORDER", order_id: "261001A0001", award_id: null, amount: 79216 },
      { line_no: 2, kind: "ORDER", order_id: "261001A0002", award_id: null, amount: 36000 },
      { line_no: 3, kind: "AWARD", order_id: "261001A0001", award_id: 1, amount: 20000 },
    ]);
    expect(all(ledger, "SELECT order_id, status, paid_at FROM orders ORDER BY order_id")).toEqual([
      { order_id: "261001A0001", status: "PAID", paid_at: NOW },
      { order_id: "261001A0002", status: "PAID", paid_at: NOW },
      { order_id: "261001W0001", status: "AWAITING_APPROVAL", paid_at: null },
    ]);
    expect(all(ledger, "SELECT order_id, from_status, to_status, actor FROM order_status_history ORDER BY order_id")).toEqual([
      { order_id: "261001A0001", from_status: "APPROVED", to_status: "PAID", actor: "minh" },
      { order_id: "261001A0002", from_status: "APPROVED", to_status: "PAID", actor: "minh" },
    ]);
    expect(all(ledger, "SELECT status, paid_at FROM campaign_awards")).toEqual([{ status: "PAID", paid_at: NOW }]);
    expect(all(ledger, "SELECT status, confirmed_at FROM payout_claims")).toEqual([{ status: "CONFIRMED", confirmed_at: NOW }]);
    const outbox = all(ledger, "SELECT dedup_key, customer_id, message_key, params, due_at FROM outbox");
    expect(outbox).toEqual([{ dedup_key: `payout:${payout.payoutId}:recorded`, customer_id: "P1", message_key: "payout_recorded", params: JSON.stringify({ payoutId: payout.payoutId, amount: 135216, receiptToken: "rcpt_test_token_0001" }), due_at: NOW }]);
    expect(all(ledger, "SELECT actor_id, actor_role FROM audit_entries WHERE event = 'payouts.payout.recorded'")).toEqual([{ actor_id: "minh", actor_role: "ADMIN" }]);
    expect(getBalances(ledger.db, ["P1"])[0]).toMatchObject({ gross: 0, payable: 0, paid: 135216, waiting: expect.any(Number) });
  });

  it("AC2: a retried confirm of a CONFIRMED claim returns the same payout and writes nothing", () => {
    const ledger = payoutLedger();
    lan(ledger);
    const claim = claimed(openClaim(ledger, "P1"));
    const first = confirmClaim(ledger, claim.claim.claimId, claim.snapshot.hash);
    const before = writeCounts(ledger);
    const again = confirmClaim(ledger, claim.claim.claimId, claim.snapshot.hash, MINH, at("2026-10-30T12:05:00.000Z"));
    expect(again).toEqual({ kind: "recorded", payout: recorded(first), replay: true });
    expect(writeCounts(ledger)).toEqual(before);
  });

  it("AC2: a double click over HTTP records one payout and answers both clicks with it", async () => {
    const ledger = payoutLedger();
    lan(ledger);
    servers = deskServers(ledger, CLOCK);
    const cookie = staffCookie(ledger, "tuan");
    const open = payoutClaimResponseSchema.parse(JSON.parse((await post(servers, "/api/admin/payouts/P1/claim", cookie, {})).body)) as PayoutPreview;
    const url = `/api/admin/payout-claims/${open.claimId}/confirm`;
    const [a, b] = await Promise.all([post(servers, url, cookie, { snapshotHash: open.snapshotHash }), post(servers, url, cookie, { snapshotHash: open.snapshotHash })]);
    const answers = [a, b].map((r) => payoutConfirmResponseSchema.parse(JSON.parse(r.body)));
    expect(answers.map((r) => r.payoutId)).toEqual([answers[0]?.payoutId, answers[0]?.payoutId]);
    expect(answers.map((r) => r.replay).sort()).toEqual([false, true]);
    expect(all(ledger, "SELECT count(*) AS n FROM payouts")).toEqual([{ n: 1 }]);
    expect(all(ledger, "SELECT count(*) AS n FROM outbox")).toEqual([{ n: 1 }]);
  });

  it("AC3: a covered order that became REVERSED since the preview writes nothing and answers 'changed'", () => {
    const ledger = payoutLedger();
    apply(ledger, approved("261001C0001", [30000]));
    apply(ledger, approved("261001C0002", [20000]));
    addBank(ledger, "C1");
    const claim = claimed(openClaim(ledger, "C1", MINH, at("2026-10-30T12:00:00.000Z")));
    expect(expire(ledger, "2026-10-30T12:10:00.000Z")).toBe(1);
    apply(ledger, cancelled("261001C0001"));
    expect(all(ledger, "SELECT status FROM orders WHERE order_id = '261001C0001'")).toEqual([{ status: "REVERSED" }]);
    const before = writeCounts(ledger);
    expect(confirmClaim(ledger, claim.claim.claimId, claim.snapshot.hash)).toEqual({ kind: "changed", previousAmount: claim.claim.amount });
    expect(writeCounts(ledger)).toEqual(before);
    expect(all(ledger, "SELECT status FROM payout_claims")).toEqual([{ status: "ABANDONED" }]);
    expect(all(ledger, "SELECT status FROM orders WHERE order_id = '261001C0002'")).toEqual([{ status: "APPROVED" }]);
  });

  it("AC3: a bank account or hold changed since the preview writes nothing; over HTTP it is 409 'So tien da thay doi, xem lai' and a re-open shows the new preview", async () => {
    const changes = [
      (l: Ledger) => l.sqlite.prepare("UPDATE bank_accounts SET account_number = '9704999988887777', fingerprint = ? WHERE customer_id = 'P1'").run(bankFingerprint(FINGERPRINT_KEY, "9704999988887777")),
      (l: Ledger) => l.sqlite.prepare("UPDATE bank_accounts SET pending_confirmation = 1 WHERE customer_id = 'P1'").run(),
    ];
    for (const change of changes) {
      const ledger = payoutLedger();
      lan(ledger);
      const claim = claimed(openClaim(ledger, "P1"));
      change(ledger);
      const before = writeCounts(ledger);
      expect(confirmClaim(ledger, claim.claim.claimId, claim.snapshot.hash)).toMatchObject({ kind: "changed" });
      expect(writeCounts(ledger)).toEqual(before);
      expect(all(ledger, "SELECT status FROM orders WHERE status = 'PAID'")).toEqual([]);
      closeLedgers();
    }

    const ledger = payoutLedger();
    lan(ledger);
    servers = deskServers(ledger, CLOCK);
    const cookie = staffCookie(ledger, "minh");
    const open = payoutClaimResponseSchema.parse(JSON.parse((await post(servers, "/api/admin/payouts/P1/claim", cookie, {})).body)) as PayoutPreview;
    addOrder(ledger, { id: "261001A0003", customer: "P1", cashback: 9263 });
    const res = await post(servers, `/api/admin/payout-claims/${open.claimId}/confirm`, cookie, { snapshotHash: open.snapshotHash });
    expect(res.statusCode).toBe(409);
    expect(errorEnvelopeSchema.parse(JSON.parse(res.body)).error).toMatchObject({ code: "conflict", messageKey: "error.payout.amount_changed" });
    expect(all(ledger, "SELECT count(*) AS n FROM payouts")).toEqual([{ n: 0 }]);
    const fresh = payoutClaimResponseSchema.parse(JSON.parse((await post(servers, "/api/admin/payouts/P1/claim", cookie, {})).body)) as PayoutPreview;
    expect(fresh.amount).toBe(144479);
    expect(fresh.claimId).not.toBe(open.claimId);
  });

  it("AC4: an ABANDONED claim with unchanged orders and no other OPEN claim confirms (the transfer already left the bank)", () => {
    const ledger = payoutLedger();
    lan(ledger);
    const claim = claimed(openClaim(ledger, "P1", TU, at("2026-10-30T12:00:00.000Z")));
    expect(expire(ledger, "2026-10-30T12:30:00.000Z")).toBe(1);
    const payout = recorded(confirmClaim(ledger, claim.claim.claimId, claim.snapshot.hash, TU, at("2026-10-30T12:40:00.000Z")));
    expect(payout.amount).toBe(135216);
    expect(all(ledger, "SELECT status, confirmed_at FROM payout_claims")).toEqual([{ status: "CONFIRMED", confirmed_at: "2026-10-30T12:40:00.000Z" }]);
  });

  it("AC4: an ABANDONED claim is refused while another claim of the customer is OPEN", () => {
    const ledger = payoutLedger();
    lan(ledger);
    const first = claimed(openClaim(ledger, "P1", TU, at("2026-10-30T12:00:00.000Z")));
    expire(ledger, "2026-10-30T12:30:00.000Z");
    claimed(openClaim(ledger, "P1", MINH, at("2026-10-30T12:31:00.000Z")));
    const before = writeCounts(ledger);
    expect(() => confirmClaim(ledger, first.claim.claimId, first.snapshot.hash, TU)).toThrow(expect.objectContaining({ code: "other_claim_open" }));
    expect(writeCounts(ledger)).toEqual(before);
  });

  it("AC5: a confirm body carrying an amount or an order list is rejected by the contract, and no route pays an order directly", async () => {
    const ledger = payoutLedger();
    lan(ledger);
    servers = deskServers(ledger, CLOCK);
    const cookie = staffCookie(ledger, "minh");
    const open = payoutClaimResponseSchema.parse(JSON.parse((await post(servers, "/api/admin/payouts/P1/claim", cookie, {})).body)) as PayoutPreview;
    const url = `/api/admin/payout-claims/${open.claimId}/confirm`;
    for (const body of [{ snapshotHash: open.snapshotHash, amount: 1 }, { snapshotHash: open.snapshotHash, orderIds: ["261001W0001"] }, { amount: 135216 }, {}]) {
      const res = await post(servers, url, cookie, body);
      expect(res.statusCode).toBe(400);
    }
    for (const path of ["/api/admin/orders/261001W0001/pay", "/api/admin/payouts/P1/pay", "/api/admin/payouts/P1/confirm"]) {
      expect((await post(servers, path, cookie, { orderIds: ["261001W0001"] })).statusCode).toBe(404);
    }
    expect(all(ledger, "SELECT count(*) AS n FROM payouts")).toEqual([{ n: 0 }]);
    expect(all(ledger, "SELECT status FROM orders WHERE order_id = '261001W0001'")).toEqual([{ status: "AWAITING_APPROVAL" }]);
  });

  it("AC5: a snapshot hash other than the claim's is refused as changed and writes nothing", () => {
    const ledger = payoutLedger();
    lan(ledger);
    const claim = claimed(openClaim(ledger, "P1"));
    const before = writeCounts(ledger);
    expect(confirmClaim(ledger, claim.claim.claimId, "0".repeat(64))).toMatchObject({ kind: "changed" });
    expect(writeCounts(ledger)).toEqual(before);
  });

  it("AC6 (golden): open clawbacks below the gross are netted in full and the rest is transferred", () => {
    const ledger = payoutLedger();
    lan(ledger);
    addClawback(ledger, "P1", "260901PAID04", 49216);
    const claim = claimed(openClaim(ledger, "P1"));
    const payout = recorded(confirmClaim(ledger, claim.claim.claimId, claim.snapshot.hash));
    expect(payout).toMatchObject({ amount: 86000, netted: 49216, nettingOnly: false });
    expect(all(ledger, "SELECT clawback_id, kind, amount, order_id, payout_id FROM ledger_entries WHERE kind = 'NETTING'")).toEqual([{ clawback_id: "260901PAID04-1", kind: "NETTING", amount: 49216, order_id: "260901PAID04", payout_id: payout.payoutId }]);
    expect(clawbackOpen(ledger.db, "260901PAID04-1")).toBe(0);
    expect(getBalances(ledger.db, ["P1"])[0]).toMatchObject({ gross: 0, payable: 0, deductedNext: 0, paid: 86000 });
  });

  it("AC6 (golden): two clawbacks against one payout net in clawback order, and what is left of the payable is transferred", () => {
    const ledger = payoutLedger();
    lan(ledger);
    addClawback(ledger, "P1", "260901PAID05", 20000);
    addClawback(ledger, "P1", "260901PAID06", 15216);
    const claim = claimed(openClaim(ledger, "P1"));
    const payout = recorded(confirmClaim(ledger, claim.claim.claimId, claim.snapshot.hash));
    expect(payout).toMatchObject({ amount: 100000, netted: 35216 });
    expect(all(ledger, "SELECT clawback_id, amount FROM ledger_entries WHERE kind = 'NETTING' ORDER BY entry_id")).toEqual([
      { clawback_id: "260901PAID05-1", amount: 20000 },
      { clawback_id: "260901PAID06-1", amount: 15216 },
    ]);
  });
});

describe("Story 4.8 context: who confirms, the go/no-go window, the protected set", () => {
  it("only the claim's own staff member confirms it; an employee may confirm their own", () => {
    const ledger = payoutLedger();
    lan(ledger);
    const claim = claimed(openClaim(ledger, "P1", TU));
    expect(() => confirmClaim(ledger, claim.claim.claimId, claim.snapshot.hash, MINH)).toThrow(expect.objectContaining({ code: "not_your_claim" }));
    expect(recorded(confirmClaim(ledger, claim.claim.claimId, claim.snapshot.hash, TU)).amount).toBe(135216);
    expect(() => confirmClaim(ledger, claim.claim.claimId, claim.snapshot.hash, { kind: "system", id: "reconcile" })).toThrow(PayoutClaimError);
  });

  it("during the go/no-go window (Story 8.8 flag) confirm is refused and writes nothing", () => {
    const ledger = payoutLedger();
    lan(ledger);
    const claim = claimed(openClaim(ledger, "P1"));
    const before = writeCounts(ledger);
    expect(() => confirmClaim(ledger, claim.claim.claimId, claim.snapshot.hash, MINH, CLOCK, { confirmPaused: () => true })).toThrow(expect.objectContaining({ code: "confirm_paused" }));
    expect(writeCounts(ledger)).toEqual(before);
  });

  it("an order paid by the confirm is never reversed by a later cancel; it gets a clawback instead (D4)", () => {
    const ledger = payoutLedger();
    apply(ledger, approved("261001C0003", [30000]));
    addBank(ledger, "C1");
    const claim = claimed(openClaim(ledger, "C1"));
    recorded(confirmClaim(ledger, claim.claim.claimId, claim.snapshot.hash));
    apply(ledger, cancelled("261001C0003"));
    expect(all(ledger, "SELECT status FROM orders WHERE order_id = '261001C0003'")).toEqual([{ status: "PAID" }]);
    expect(all(ledger, "SELECT kind FROM ledger_entries")).toEqual([{ kind: "CLAWBACK" }]);
  });

  it("the audit entry carries ids and the account fingerprint only, never the account number or holder", () => {
    const ledger = payoutLedger();
    lan(ledger);
    const claim = claimed(openClaim(ledger, "P1"));
    recorded(confirmClaim(ledger, claim.claim.claimId, claim.snapshot.hash));
    const payload = JSON.stringify(all(ledger, "SELECT payload FROM audit_entries WHERE event = 'payouts.payout.recorded'"));
    expect(payload).toContain(claim.snapshot.bank?.fingerprint ?? "missing");
    expect(payload).not.toContain("0071000123456");
  });
});

describe("Sprint 15 code review: confirm", () => {
  it("review 6: an internal disagreement (a CONFIRMED claim without its payout) is refused as snapshot_mismatch with its detail, never a 500", async () => {
    const ledger = payoutLedger();
    lan(ledger);
    const claim = claimed(openClaim(ledger, "P1"));
    ledger.sqlite.prepare("UPDATE payout_claims SET status = 'CONFIRMED', confirmed_at = ?").run(NOW);
    expect(() => confirmClaim(ledger, claim.claim.claimId, claim.snapshot.hash)).toThrow(expect.objectContaining({ code: "snapshot_mismatch", detail: `claim ${claim.claim.claimId} is CONFIRMED without a payout` }));
    servers = deskServers(ledger, CLOCK);
    const res = await post(servers, `/api/admin/payout-claims/${claim.claim.claimId}/confirm`, staffCookie(ledger, "minh"), { snapshotHash: claim.snapshot.hash });
    expect(res.statusCode).toBe(409);
    expect(errorEnvelopeSchema.parse(JSON.parse(res.body)).error.messageKey).toBe("error.payout.snapshot_mismatch");
  });

  it("review 8: the answer of a recorded confirm, built from the values in hand, equals what a replay reads back", () => {
    const ledger = payoutLedger();
    lan(ledger);
    addClawback(ledger, "P1", "260901PAID09", 1000);
    const claim = claimed(openClaim(ledger, "P1"));
    const first = recorded(confirmClaim(ledger, claim.claim.claimId, claim.snapshot.hash));
    expect(recorded(confirmClaim(ledger, claim.claim.claimId, claim.snapshot.hash))).toEqual(first);
    expect(first).toMatchObject({ amount: 134216, netted: 1000, orderCount: 2, awardCount: 1 });
  });
});

function staffCookie(ledger: Ledger, staffId: string): string {
  const session = ledger.tx((db) => openSession(db, { kind: "STAFF", staffId }, CLOCK, STAFF_SESSION_MS));
  return `${STAFF_SESSION_COOKIE}=${session.token}`;
}

function post(s: Servers, url: string, cookie: string, body: unknown) {
  return s.publicApp.inject({ method: "POST", url, headers: { host: ADMIN_HOST, origin: ORIGIN, cookie, [ACCESS_JWT_HEADER]: accessJwt(CLOCK) }, payload: body as object });
}
