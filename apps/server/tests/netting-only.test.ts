/**
 * Story 4.11: when open clawbacks reach the gross, the payout is netting only (transfer 0): the
 * panel opens with no QR, confirm marks the orders PAID and writes the netting entries, and
 * nothing is told to the customer; an admin can write off what a clawback still owes, with a
 * reason (AD-6, AD-9, AD-16, D42).
 */
import { errorEnvelopeSchema, payoutClaimResponseSchema, type PayoutPreview } from "@cashback/contracts";
import { bankFingerprint } from "../src/modules/identity/index";
import { afterEach, describe, expect, it } from "vitest";

import { outboxFor } from "../src/modules/messaging/index";
import { openSession, STAFF_SESSION_MS } from "../src/modules/identity/index";
import { commandAudit } from "../src/modules/operations/index";
import { clawbackOpen, getBalances, PAYOUT_RECORDED_MESSAGE, WriteOffError, writeOffClawback, type ClaimOutcome, type ClaimedPayout, type ConfirmOutcome, type RecordedPayout } from "../src/modules/payouts/index";
import type { Ledger } from "../src/platform/db/ledger";
import type { Actor } from "../src/platform/ports/audit.port";
import { ACCESS_JWT_HEADER } from "../src/platform/http/access-jwt.guard";
import { close, type Servers } from "../src/platform/http/servers";
import { STAFF_SESSION_COOKIE } from "../src/platform/http/session-cookie";
import { closeLedgers } from "./helpers/order-ledger";
import { addBank, addBonus, addClawback, addOrder, CLOCK, confirmClaim, FINGERPRINT_KEY, MINH, openClaim, payoutLedger, TU, writeCounts } from "./helpers/payout-ledger";
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
const CLAWBACK = "260901PAID07-1";

/** Ha (P2): gross 50,000 (an order of 30,000 and a bonus of 20,000 on it) against an open clawback of 80,000. */
function ha(ledger: Ledger, bank = true): void {
  addOrder(ledger, { id: "261002N0001", customer: "P2", cashback: 30000 });
  addBonus(ledger, "P2", "261002N0001", 20000);
  addClawback(ledger, "P2", "260901PAID07", 80000);
  if (bank) addBank(ledger, "P2");
}

const writeOff = (ledger: Ledger, actor: Actor, reason: string, clawbackId = CLAWBACK) => ledger.tx((db) => writeOffClawback(db, { clawbackId, reason }, { clock: CLOCK, by: commandAudit(db, CLOCK, actor) }));

describe("Story 4.11 acceptance criteria", () => {
  it("AC1: with gross 50,000 and open clawbacks of 80,000 the panel opens the netting-only variant: transfer 0, no QR", async () => {
    const ledger = payoutLedger();
    ha(ledger);
    servers = deskServers(ledger, CLOCK);
    const res = await post(servers, "/api/admin/payouts/P2/claim", staffCookie(ledger, "tuan"), {});
    expect(res.statusCode).toBe(200);
    const preview = payoutClaimResponseSchema.parse(JSON.parse(res.body)) as PayoutPreview;
    expect(preview).toMatchObject({ amount: 0, gross: 50000, deductedNext: 80000, netted: 50000, carriedForward: 30000, qrPayload: null, qrMissing: "netting_only", flags: ["NETTING_ONLY"] });
    expect(all(ledger, "SELECT status, amount, qr_shown_at FROM payout_claims")).toEqual([{ status: "OPEN", amount: 0, qr_shown_at: null }]);
  });

  it("AC1: a netting-only payout needs no bank account, because no money moves", () => {
    const ledger = payoutLedger();
    ha(ledger, false);
    const out = claimed(openClaim(ledger, "P2"));
    expect(out).toMatchObject({ qrPayload: null, qrMissing: "netting_only" });
    expect(all(ledger, "SELECT amount, bank_fingerprint, bank_held FROM payout_claims")).toEqual([{ amount: 0, bank_fingerprint: null, bank_held: 0 }]);
    expect(() => ledger.sqlite.prepare("INSERT INTO payout_claims (claim_id, customer_id, staff_id, status, order_ids, award_ids, clawback_ids, amount, bank_held, snapshot_hash, transfer_reference, opened_at, last_active_at) VALUES ('AAAAAAAA', 'P1', 'minh', 'ABANDONED', '[]', '[]', '[]', 5, 0, ?, 'X', ?, ?)").run("a".repeat(64), CLOCK.now(), CLOCK.now())).toThrow(/CHECK/);
  });

  it("AC2 (golden): the netting-only confirm makes the orders PAID, writes a netting entry of +50,000, leaves the clawback open at -30,000 and creates no outbox row", () => {
    const ledger = payoutLedger();
    ha(ledger);
    const claim = claimed(openClaim(ledger, "P2"));
    const payout = recorded(confirmClaim(ledger, claim.claim.claimId, claim.snapshot.hash));
    expect(payout).toMatchObject({ amount: 0, netted: 50000, nettingOnly: true, orderCount: 1, awardCount: 1, receiptToken: null });
    expect(all(ledger, "SELECT order_id, status FROM orders WHERE order_id = '261002N0001'")).toEqual([{ order_id: "261002N0001", status: "PAID" }]);
    expect(all(ledger, "SELECT status FROM campaign_awards")).toEqual([{ status: "PAID" }]);
    expect(all(ledger, "SELECT kind, amount, payout_id FROM ledger_entries WHERE kind = 'NETTING'")).toEqual([{ kind: "NETTING", amount: 50000, payout_id: payout.payoutId }]);
    expect(clawbackOpen(ledger.db, CLAWBACK)).toBe(-30000);
    expect(all(ledger, "SELECT count(*) AS n FROM outbox")).toEqual([{ n: 0 }]);
    expect(all(ledger, "SELECT transfer_amount, transfer_reference, receipt_token, bank_last_four FROM payouts")).toEqual([{ transfer_amount: 0, transfer_reference: null, receipt_token: null, bank_last_four: null }]);
    expect(getBalances(ledger.db, ["P2"])[0]).toMatchObject({ gross: 0, payable: 0, deductedNext: 30000, paid: 0 });
  });

  it("AC2: the outbox itself refuses a payout message whose transfer is 0", () => {
    const ledger = payoutLedger();
    const result = ledger.tx((db) => outboxFor(db, CLOCK, commandAudit(db, CLOCK, MINH)).enqueue({ dedupKey: "payout:9:recorded", customerId: "P2", messageKey: PAYOUT_RECORDED_MESSAGE, params: { payoutId: 9, amount: 0 }, transferAmount: 0 }));
    expect(result).toBe("refused_netting_only");
    expect(all(ledger, "SELECT count(*) AS n FROM outbox")).toEqual([{ n: 0 }]);
  });

  it("AC3: an admin write-off with a reason adds one positive entry that closes the open amount, and the audit names the admin and the reason", () => {
    const ledger = payoutLedger();
    ha(ledger);
    const claim = claimed(openClaim(ledger, "P2"));
    recorded(confirmClaim(ledger, claim.claim.claimId, claim.snapshot.hash));
    expect(writeOff(ledger, MINH, "Customer left; owner agreed to drop it")).toEqual({ clawbackId: CLAWBACK, amount: 30000 });
    expect(all(ledger, "SELECT kind, amount, reason, created_by FROM ledger_entries WHERE kind = 'WRITE_OFF'")).toEqual([{ kind: "WRITE_OFF", amount: 30000, reason: "Customer left; owner agreed to drop it", created_by: "minh" }]);
    expect(clawbackOpen(ledger.db, CLAWBACK)).toBe(0);
    expect(all(ledger, "SELECT actor_kind, actor_id, actor_role, entity_id, reason FROM audit_entries WHERE event = 'payouts.clawback.written_off'")).toEqual([{ actor_kind: "staff", actor_id: "minh", actor_role: "ADMIN", entity_id: CLAWBACK, reason: "Customer left; owner agreed to drop it" }]);
    expect(getBalances(ledger.db, ["P2"])[0]).toMatchObject({ deductedNext: 0 });
    expect(() => writeOff(ledger, MINH, "again")).toThrow(expect.objectContaining({ code: "clawback_closed" }));
  });

  it("AC3: a write-off without a reason, or of an unknown clawback, is refused and writes nothing", () => {
    const ledger = payoutLedger();
    ha(ledger);
    const before = writeCounts(ledger);
    expect(() => writeOff(ledger, MINH, "   ")).toThrow(expect.objectContaining({ code: "reason_required" }));
    expect(() => writeOff(ledger, MINH, "typo", "NOPE-1")).toThrow(expect.objectContaining({ code: "clawback_not_found" }));
    expect(writeCounts(ledger)).toEqual(before);
  });

  it("AC4: an employee calling write-off gets 403 and nothing is written", async () => {
    const ledger = payoutLedger();
    ha(ledger);
    expect(() => writeOff(ledger, TU, "not mine to drop")).toThrow(WriteOffError);
    servers = deskServers(ledger, CLOCK);
    const before = writeCounts(ledger);
    const res = await post(servers, `/api/admin/clawbacks/${CLAWBACK}/write-off`, staffCookie(ledger, "tuan"), { reason: "not mine to drop" });
    expect(res.statusCode).toBe(403);
    expect(errorEnvelopeSchema.parse(JSON.parse(res.body)).error.messageKey).toBe("error.clawback.admin_only");
    expect(writeCounts(ledger)).toEqual(before);
    const admin = await post(servers, `/api/admin/clawbacks/${CLAWBACK}/write-off`, staffCookie(ledger, "minh"), { reason: "owner agreed" });
    expect(admin.statusCode).toBe(200);
    expect(JSON.parse(admin.body)).toEqual({ clawbackId: CLAWBACK, amount: 80000 });
    const extra = await post(servers, `/api/admin/clawbacks/${CLAWBACK}/write-off`, staffCookie(ledger, "minh"), { reason: "x", amount: 5 });
    expect(extra.statusCode).toBe(400);
  });
});

describe("Sprint 15 code review: netting only", () => {
  it("review 2: a bank edit after a netting-only claim was opened does not make its confirm 'changed', because no money moves", () => {
    const ledger = payoutLedger();
    ha(ledger);
    const claim = claimed(openClaim(ledger, "P2"));
    ledger.sqlite.prepare("UPDATE bank_accounts SET account_number = '9704999988887777', fingerprint = ?, holder_name = 'SOMEONE ELSE', pending_confirmation = 1 WHERE customer_id = 'P2'").run(bankFingerprint(FINGERPRINT_KEY, "9704999988887777"));
    expect(recorded(confirmClaim(ledger, claim.claim.claimId, claim.snapshot.hash))).toMatchObject({ amount: 0, netted: 50000 });
  });

  it("review 2: for a transfer above 0 the same bank edit still makes the confirm 'changed'", () => {
    const ledger = payoutLedger();
    addOrder(ledger, { id: "261002T0001", customer: "P2", cashback: 30000 });
    addBank(ledger, "P2");
    const claim = claimed(openClaim(ledger, "P2"));
    ledger.sqlite.prepare("UPDATE bank_accounts SET holder_name = 'SOMEONE ELSE' WHERE customer_id = 'P2'").run();
    expect(confirmClaim(ledger, claim.claim.claimId, claim.snapshot.hash)).toMatchObject({ kind: "changed" });
  });

  it("review 3: a clawback stored under a merged customer's old id keeps every netting and write-off entry under that same id", () => {
    const ledger = payoutLedger();
    ledger.sqlite.exec("INSERT INTO customers (customer_id, role, status) VALUES ('POLD', 'USER', 'MERGED'); INSERT INTO customer_aliases (alias, customer_id) VALUES ('POLD', 'P2');");
    addOrder(ledger, { id: "261002N0002", customer: "P2", cashback: 50000 });
    addClawback(ledger, "POLD", "260901PAID08", 80000);
    const claim = claimed(openClaim(ledger, "P2"));
    expect(claim.snapshot.clawbacks).toEqual([{ clawbackId: "260901PAID08-1", customerId: "POLD", orderId: "260901PAID08", open: 80000 }]);
    recorded(confirmClaim(ledger, claim.claim.claimId, claim.snapshot.hash));
    writeOff(ledger, MINH, "owner agreed", "260901PAID08-1");
    expect(all(ledger, "SELECT kind, customer_id, amount FROM ledger_entries WHERE clawback_id = '260901PAID08-1' ORDER BY entry_id")).toEqual([
      { kind: "CLAWBACK", customer_id: "POLD", amount: -80000 },
      { kind: "NETTING", customer_id: "POLD", amount: 50000 },
      { kind: "WRITE_OFF", customer_id: "POLD", amount: 30000 },
    ]);
    expect(clawbackOpen(ledger.db, "260901PAID08-1")).toBe(0);
    expect(getBalances(ledger.db, ["P2"])[0]).toMatchObject({ gross: 0, deductedNext: 0 });
  });
});

function staffCookie(ledger: Ledger, staffId: string): string {
  const session = ledger.tx((db) => openSession(db, { kind: "STAFF", staffId }, CLOCK, STAFF_SESSION_MS));
  return `${STAFF_SESSION_COOKIE}=${session.token}`;
}

function post(s: Servers, url: string, cookie: string, body: unknown) {
  return s.publicApp.inject({ method: "POST", url, headers: { host: ADMIN_HOST, origin: ORIGIN, cookie, [ACCESS_JWT_HEADER]: accessJwt(CLOCK) }, payload: body as object });
}
