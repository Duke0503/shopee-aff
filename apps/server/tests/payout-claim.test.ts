/**
 * Story 4.7: opening a customer's payout claims it for one staff member and shows the server's
 * preview with a VietQR for exactly the payable total (AD-9, D19, D39, INV-2, INV-4). A second
 * staff member sees who is paying and creates nothing; an idle claim becomes ABANDONED and is kept;
 * the next opening after an abandoned shown QR warns that a transfer may have been made.
 */
import { errorEnvelopeSchema, payoutClaimResponseSchema, type PayoutPreview } from "@cashback/contracts";
import { fixedClock } from "@cashback/core";
import { afterEach, describe, expect, it } from "vitest";

import { bankFingerprint, openSession, STAFF_SESSION_MS } from "../src/modules/identity/index";
import { commandAudit } from "../src/modules/operations/index";
import { coveredByOpenClaim, releasePayoutClaim, revealClaimAccount, runClaimExpiry, type ClaimOutcome, type ClaimedPayout } from "../src/modules/payouts/index";
import type { Ledger } from "../src/platform/db/ledger";
import { ACCESS_JWT_HEADER } from "../src/platform/http/access-jwt.guard";
import { close, type Servers } from "../src/platform/http/servers";
import { STAFF_SESSION_COOKIE } from "../src/platform/http/session-cookie";
import { apply, approved, cancelled, closeLedgers } from "./helpers/order-ledger";
import { addBank, addBonus, addClawback, addOrder, claimIds, claimRows, CLOCK, codeOf, FINGERPRINT_KEY, FIXTURE, MINH, NOW, openClaim, payoutLedger, TU } from "./helpers/payout-ledger";
import { accessJwt, ADMIN_HOST, deskServers, ORIGIN } from "./helpers/staff-desk";
import { tlv } from "./helpers/emv-tlv";

let servers: Servers | undefined;
afterEach(async () => {
  if (servers) await close(servers);
  servers = undefined;
  closeLedgers();
});

const at = (iso: string) => fixedClock(iso);
const claimed = (outcome: ClaimOutcome): ClaimedPayout => {
  if (outcome.kind !== "claimed") throw new Error(`expected a claim, got ${outcome.kind}`);
  return outcome;
};
const audits = (ledger: Ledger, event: string) => ledger.sqlite.prepare("SELECT actor_id, entity_id, payload FROM audit_entries WHERE event = ? ORDER BY id").all(event) as { actor_id: string; entity_id: string; payload: string }[];

/** Lan (P1): two approved orders with product snapshots and a bonus, a Vietcombank account. */
function lan(ledger: Ledger): void {
  ledger.sqlite.prepare("INSERT INTO link_requests (request_id, customer_id, network, platform, status, source_url, product_name, product_image_url, origin) VALUES ('REQP1', 'P1', 'shopee', 'shopee', 'CONVERTED', 'https://shopee.vn/p/9', 'Rice cooker 1.8L', 'https://cf.example.test/file/p1.jpg', 'REQUEST')").run();
  addOrder(ledger, { id: "261001A0001", customer: "P1", cashback: 79216, requestId: "REQP1", settled: true, approvedAt: "2026-10-10T03:00:00.000Z" });
  addOrder(ledger, { id: "261001A0002", customer: "P1", cashback: 36000 });
  addOrder(ledger, { id: "261001W0001", customer: "P1", status: "AWAITING_APPROVAL", estimate: 45000 });
  addBonus(ledger, "P1", "261001A0001", 20000);
  addBank(ledger, "P1", { number: "0071 0001-23456" });
}

describe("Story 4.7 acceptance criteria", () => {
  it("AC1: opening a payable customer creates one OPEN claim and a preview of orders, bonuses, total, bank, holder, masked account, reference and a VietQR for exactly the total", () => {
    const ledger = payoutLedger();
    lan(ledger);
    const out = claimed(openClaim(ledger, "P1", MINH, CLOCK, claimIds("K7Q2M9XA")));
    expect(claimRows(ledger)).toEqual([expect.objectContaining({ claim_id: "K7Q2M9XA", customer_id: "P1", staff_id: "minh", status: "OPEN", amount: 135216, qr_shown_at: NOW, transfer_reference: `${codeOf("P1")} K7Q2M9XA`, order_ids: '["261001A0001","261001A0002"]', award_ids: "[1]", clawback_ids: "[]" })]);
    expect(out.snapshot.orders.map((o) => [o.orderId, o.cashback, o.settled, o.productName])).toEqual([
      ["261001A0001", 79216, true, "Rice cooker 1.8L"],
      ["261001A0002", 36000, false, null],
    ]);
    expect(out.snapshot.bonuses.map((b) => [b.awardId, b.amount, b.campaignName])).toEqual([[1, 20000, "October"]]);
    expect(out.snapshot.balance.payable).toBe(135216);
    expect(out.snapshot.bank).toMatchObject({ lastFour: "3456", holderName: FIXTURE.holder, vietQrBank: expect.objectContaining({ bin: "970436" }) });
    const fields = Object.fromEntries(tlv(out.qrPayload ?? ""));
    expect(fields["54"]).toBe("135216");
    expect(Object.fromEntries(tlv(fields["38"] ?? ""))["01"]).toBe("0006970436" + "0113" + "0071000123456");
    expect(Object.fromEntries(tlv(fields["62"] ?? ""))["08"]).toBe(`${codeOf("P1")} K7Q2M9XA`);
    expect(out.warning).toBeNull();
    expect(audits(ledger, "payouts.claim.opened")).toHaveLength(1);
  });

  it("AC1: the preview over HTTP has the masked account only, never the full number, and refuses a body with an amount or orders", async () => {
    const ledger = payoutLedger();
    lan(ledger);
    const cookie = staffCookie(ledger, "minh");
    servers = deskServers(ledger, CLOCK);
    const res = await post(servers, "/api/admin/payouts/P1/claim", cookie, {});
    expect(res.statusCode).toBe(200);
    const body = payoutClaimResponseSchema.parse(JSON.parse(res.body)) as PayoutPreview;
    expect(body).toMatchObject({ outcome: "claimed", amount: 135216, accountLastFour: "3456", bankName: "Vietcombank", holderName: FIXTURE.holder });
    const withoutQr = res.body.replace(body.qrPayload ?? "", "");
    expect(withoutQr).not.toContain("0071000123456");
    for (const extra of [{ amount: 1 }, { orderIds: ["261001W0001"] }]) {
      const refused = await post(servers, "/api/admin/payouts/P2/claim", cookie, extra);
      expect(refused.statusCode).toBe(400);
    }
    expect(claimRows(ledger)).toHaveLength(1);
  });

  it("AC2: with an OPEN claim by staff A, staff B sees 'A dang chuyen' and no claim is created", async () => {
    const ledger = payoutLedger();
    lan(ledger);
    claimed(openClaim(ledger, "P1", MINH));
    expect(openClaim(ledger, "P1", TU)).toEqual({ kind: "taken", staffName: "minh" });
    expect(claimRows(ledger)).toHaveLength(1);

    servers = deskServers(ledger, CLOCK);
    const res = await post(servers, "/api/admin/payouts/P1/claim", staffCookie(ledger, "tuan"), {});
    expect(JSON.parse(res.body)).toEqual({ outcome: "taken", staffName: "minh" });
    expect(claimRows(ledger)).toHaveLength(1);
  });

  it("AC3: an OPEN claim idle for 10 minutes becomes ABANDONED when the expiry job runs, and is never deleted", () => {
    const ledger = payoutLedger();
    lan(ledger);
    claimed(openClaim(ledger, "P1", MINH, at("2026-10-30T12:00:00.000Z")));
    const expire = (iso: string) => runClaimExpiry({ ledger, clock: at(iso), audit: (db, actor) => commandAudit(db, at(iso), actor) });
    expect(expire("2026-10-30T12:09:59.999Z")).toBe(0);
    expect(claimRows(ledger)[0]).toMatchObject({ status: "OPEN" });
    expect(expire("2026-10-30T12:10:00.000Z")).toBe(1);
    expect(claimRows(ledger)[0]).toMatchObject({ status: "ABANDONED", abandoned_at: "2026-10-30T12:10:00.000Z" });
    expect(audits(ledger, "payouts.claim.abandoned")).toEqual([expect.objectContaining({ actor_id: "claim-expiry" })]);
    expect(() => ledger.sqlite.prepare("DELETE FROM payout_claims").run()).toThrow(/never deleted/);
    expect(() => ledger.sqlite.prepare("UPDATE payout_claims SET status = 'OPEN'").run()).toThrow(/not allowed/);
  });

  it("AC3: opening the panel again restarts the idle clock", () => {
    const ledger = payoutLedger();
    lan(ledger);
    const first = claimed(openClaim(ledger, "P1", MINH, at("2026-10-30T12:00:00.000Z")));
    const again = claimed(openClaim(ledger, "P1", MINH, at("2026-10-30T12:08:00.000Z")));
    expect(again.claim.claimId).toBe(first.claim.claimId);
    expect(runClaimExpiry({ ledger, clock: at("2026-10-30T12:12:00.000Z"), audit: (db, actor) => commandAudit(db, CLOCK, actor) })).toBe(0);
    expect(claimRows(ledger)).toHaveLength(1);
  });

  it("AC4: after a claim abandoned once its QR was shown, the next opening warns with that amount and time", () => {
    const ledger = payoutLedger();
    lan(ledger);
    claimed(openClaim(ledger, "P1", MINH, at("2026-10-30T12:42:00.000Z")));
    runClaimExpiry({ ledger, clock: at("2026-10-30T12:53:00.000Z"), audit: (db, actor) => commandAudit(db, CLOCK, actor) });
    const next = claimed(openClaim(ledger, "P1", TU, at("2026-10-30T13:00:00.000Z")));
    expect(next.warning).toEqual({ amount: 135216, at: "2026-10-30T12:42:00.000Z" });
    expect(claimRows(ledger).map((c) => c.status)).toEqual(["ABANDONED", "OPEN"]);
  });

  it("AC4: no warning when the abandoned claim showed no QR, or the last claim was not abandoned", () => {
    const ledger = payoutLedger();
    addOrder(ledger, { id: "261001N0001", customer: "P2", cashback: 9263 });
    addBank(ledger, "P2", { bank: "Ngan hang cua toi" });
    const noQr = claimed(openClaim(ledger, "P2", MINH));
    expect(noQr).toMatchObject({ qrPayload: null, qrMissing: "no_single_bank" });
    ledger.tx((db) => releasePayoutClaim(db, noQr.claim.claimId, { clock: CLOCK, by: commandAudit(db, CLOCK, MINH) }));
    expect(claimed(openClaim(ledger, "P2", MINH)).warning).toBeNull();
  });

  it("AC5 (server half): while the panel stays open, reopening returns the same claim and snapshot; nothing new is written", () => {
    const ledger = payoutLedger();
    lan(ledger);
    const first = claimed(openClaim(ledger, "P1", MINH));
    const again = claimed(openClaim(ledger, "P1", MINH));
    expect(again.claim.claimId).toBe(first.claim.claimId);
    expect(again.snapshot.hash).toBe(first.snapshot.hash);
    expect(again.qrPayload).toBe(first.qrPayload);
    expect(claimRows(ledger)).toHaveLength(1);
  });
});

describe("Story 4.7 context: refusals, netting only, the protected set, the audited copy", () => {
  it("refuses a customer without a bank account, with a held website change, or with nothing to pay; no claim is written", () => {
    const ledger = payoutLedger();
    addOrder(ledger, { id: "261001R0001", customer: "P1", cashback: 1000 });
    addOrder(ledger, { id: "261001R0002", customer: "P2", cashback: 1000 });
    addBank(ledger, "P2", { held: true });
    addOrder(ledger, { id: "261001R0003", customer: "P3", status: "AWAITING_APPROVAL", estimate: 1000 });
    addBank(ledger, "P3");
    expect(openClaim(ledger, "P1")).toEqual({ kind: "refused", code: "no_bank" });
    expect(openClaim(ledger, "P2")).toEqual({ kind: "refused", code: "bank_held" });
    expect(openClaim(ledger, "P3")).toEqual({ kind: "refused", code: "nothing_to_pay" });
    expect(openClaim(ledger, "HOUSE")).toEqual({ kind: "refused", code: "customer_not_found" });
    expect(claimRows(ledger)).toEqual([]);
  });

  it("review 11: a netting-only customer (payable 0) is never opened as a transfer of 0", () => {
    const ledger = payoutLedger();
    addOrder(ledger, { id: "261001N0002", customer: "P1", cashback: 9263 });
    addClawback(ledger, "P1", "260901PAID03", 20000);
    addBank(ledger, "P1");
    expect(openClaim(ledger, "P1")).toEqual({ kind: "refused", code: "netting_only" });
    expect(claimRows(ledger)).toEqual([]);
  });

  it("the QR amount nets open clawbacks and never includes awaiting money (list-defects 'QR amount falls back')", () => {
    const ledger = payoutLedger();
    lan(ledger);
    addClawback(ledger, "P1", "260901PAID04", 49216);
    const out = claimed(openClaim(ledger, "P1"));
    expect(out.snapshot.balance).toMatchObject({ gross: 135216, payable: 86000, deductedNext: 49216 });
    expect(Object.fromEntries(tlv(out.qrPayload ?? ""))["54"]).toBe("86000");
  });

  it("two awards on one order are both covered (list-defects 'only one campaign award per order')", () => {
    const ledger = payoutLedger();
    lan(ledger);
    ledger.sqlite.prepare("INSERT INTO campaigns (campaign_id, name, slots, bonus, origin) VALUES ('CAMP2', 'November', 5, 10000, 'STAFF')").run();
    ledger.sqlite.prepare("INSERT INTO campaign_awards (campaign_id, customer_id, order_id, amount, status, origin) VALUES ('CAMP2', 'P1', '261001A0001', 10000, 'CONFIRMED', 'RULE')").run();
    const out = claimed(openClaim(ledger, "P1"));
    expect(out.snapshot.bonuses.map((b) => b.amount)).toEqual([20000, 10000]);
    expect(out.snapshot.balance.payable).toBe(145216);
  });

  it("an order in an OPEN claim is protected from a cancel until the claim ends (D39, AD-7)", () => {
    const ledger = payoutLedger();
    lan(ledger);
    const out = claimed(openClaim(ledger, "P1"));
    expect(coveredByOpenClaim(ledger.db, "261001A0001")).toBe(true);
    expect(coveredByOpenClaim(ledger.db, "261001W0001")).toBe(false);
    ledger.tx((db) => releasePayoutClaim(db, out.claim.claimId, { clock: CLOCK, by: commandAudit(db, CLOCK, MINH) }));
    expect(coveredByOpenClaim(ledger.db, "261001A0001")).toBe(false);
  });

  it("a cancel in the next report run leaves a claimed APPROVED order approved until the claim ends (D39)", () => {
    const ledger = payoutLedger();
    apply(ledger, approved("261001C0001", [30000]));
    expect(ledger.sqlite.prepare("SELECT status FROM orders WHERE order_id = '261001C0001'").get()).toEqual({ status: "APPROVED" });
    addBank(ledger, "C1");
    const out = claimed(openClaim(ledger, "C1"));
    apply(ledger, cancelled("261001C0001"));
    expect(ledger.sqlite.prepare("SELECT status FROM orders WHERE order_id = '261001C0001'").get()).toEqual({ status: "APPROVED" });
    ledger.tx((db) => releasePayoutClaim(db, out.claim.claimId, { clock: CLOCK, by: commandAudit(db, CLOCK, MINH) }));
    apply(ledger, cancelled("261001C0001"));
    expect(ledger.sqlite.prepare("SELECT status FROM orders WHERE order_id = '261001C0001'").get()).toEqual({ status: "REVERSED" });
  });

  it("a changed set while the own claim is open supersedes it: the old one is ABANDONED and a new one holds the new amount", () => {
    const ledger = payoutLedger();
    lan(ledger);
    claimed(openClaim(ledger, "P1"));
    addOrder(ledger, { id: "261001A0003", customer: "P1", cashback: 9263 });
    const next = claimed(openClaim(ledger, "P1"));
    expect(claimRows(ledger).map((c) => [c.status, c.amount])).toEqual([
      ["ABANDONED", 135216],
      ["OPEN", 144479],
    ]);
    expect(next.warning).toEqual({ amount: 135216, at: NOW });
  });

  it("copying the full account number is only for the claim's own staff member and is audited by fingerprint", () => {
    const ledger = payoutLedger();
    lan(ledger);
    const out = claimed(openClaim(ledger, "P1"));
    expect(ledger.tx((db) => revealClaimAccount(db, out.claim.claimId, { clock: CLOCK, by: commandAudit(db, CLOCK, MINH) }))).toBe("0071000123456");
    expect(() => ledger.tx((db) => revealClaimAccount(db, out.claim.claimId, { clock: CLOCK, by: commandAudit(db, CLOCK, TU) }))).toThrow(expect.objectContaining({ code: "not_your_claim" }));
    const entries = audits(ledger, "payouts.claim.account_revealed");
    expect(entries).toHaveLength(1);
    expect(entries[0]?.payload).toContain(out.snapshot.bank?.fingerprint ?? "missing");
    const everyAudit = JSON.stringify(ledger.sqlite.prepare("SELECT payload FROM audit_entries").all());
    expect(everyAudit).not.toContain("0071000123456");
    expect(everyAudit).not.toContain(FIXTURE.holder);
  });

  it("over HTTP an employee may open, copy and release; another staff member may not release it", async () => {
    const ledger = payoutLedger();
    lan(ledger);
    servers = deskServers(ledger, CLOCK);
    const tuan = staffCookie(ledger, "tuan");
    const open = payoutClaimResponseSchema.parse(JSON.parse((await post(servers, "/api/admin/payouts/P1/claim", tuan, {})).body)) as PayoutPreview;
    const copy = await post(servers, `/api/admin/payout-claims/${open.claimId}/account`, tuan, {});
    expect(JSON.parse(copy.body)).toEqual({ accountNumber: "0071000123456" });
    const stranger = await post(servers, `/api/admin/payout-claims/${open.claimId}/release`, staffCookie(ledger, "minh"), {});
    expect(errorEnvelopeSchema.parse(JSON.parse(stranger.body)).error).toMatchObject({ code: "forbidden", messageKey: "error.payout.not_your_claim" });
    const release = await post(servers, `/api/admin/payout-claims/${open.claimId}/release`, tuan, {});
    expect(JSON.parse(release.body)).toEqual({ claimId: open.claimId, status: "ABANDONED" });
    const blocked = await post(servers, "/api/admin/payouts/P2/claim", tuan, {});
    expect(blocked.statusCode).toBe(409);
    expect(errorEnvelopeSchema.parse(JSON.parse(blocked.body)).error.messageKey).toBe("error.payout.nothing_to_pay");
  });
});

describe("Story 4.7 code review: claims never hand out or keep a stale account", () => {
  const changeAccount = (ledger: Ledger, number: string) => ledger.sqlite.prepare("UPDATE bank_accounts SET account_number = ?, fingerprint = ? WHERE customer_id = 'P1'").run(number, bankFingerprint(FINGERPRINT_KEY, number));
  const reveal = (ledger: Ledger, claimId: string) => ledger.tx((db) => revealClaimAccount(db, claimId, { clock: CLOCK, by: commandAudit(db, CLOCK, MINH) }));

  it("review 1: copying the account refuses account_changed when the saved account is no longer the one the claim showed", () => {
    const ledger = payoutLedger();
    lan(ledger);
    const out = claimed(openClaim(ledger, "P1"));
    changeAccount(ledger, "9704999988887777");
    expect(() => reveal(ledger, out.claim.claimId)).toThrow(expect.objectContaining({ code: "account_changed" }));
    expect(audits(ledger, "payouts.claim.account_revealed")).toEqual([]);
  });

  it("review 1: copying the account refuses account_changed when the same account is now held for confirmation", () => {
    const ledger = payoutLedger();
    lan(ledger);
    const out = claimed(openClaim(ledger, "P1"));
    ledger.sqlite.prepare("UPDATE bank_accounts SET pending_confirmation = 1 WHERE customer_id = 'P1'").run();
    expect(() => reveal(ledger, out.claim.claimId)).toThrow(expect.objectContaining({ code: "account_changed" }));
  });

  it("review 2: a change of bank name, BIN or holder alone makes a new snapshot, a new claim and the may-have-transferred warning", () => {
    const ledger = payoutLedger();
    lan(ledger);
    const changes = ["UPDATE bank_accounts SET bank_name = 'BIDV' WHERE customer_id = 'P1'", "UPDATE bank_accounts SET holder_name = 'NGUYEN THI LANH' WHERE customer_id = 'P1'"];
    let last = claimed(openClaim(ledger, "P1"));
    for (const change of changes) {
      ledger.sqlite.prepare(change).run();
      const next = claimed(openClaim(ledger, "P1"));
      expect(next.snapshot.hash).not.toBe(last.snapshot.hash);
      expect(next.claim.claimId).not.toBe(last.claim.claimId);
      expect(next.warning).toEqual({ amount: 135216, at: NOW });
      last = next;
    }
    expect(Object.fromEntries(tlv(Object.fromEntries(tlv(last.qrPayload ?? ""))["38"] ?? ""))["01"]?.slice(4, 10)).toBe("970418");
    expect(claimRows(ledger).map((c) => c.status)).toEqual(["ABANDONED", "ABANDONED", "OPEN"]);
  });

  it("review 4: a refusal on reopening still commits the abandon of the stale own claim", () => {
    const ledger = payoutLedger();
    lan(ledger);
    claimed(openClaim(ledger, "P1"));
    ledger.sqlite.prepare("UPDATE bank_accounts SET pending_confirmation = 1 WHERE customer_id = 'P1'").run();
    expect(openClaim(ledger, "P1")).toEqual({ kind: "refused", code: "bank_held" });
    expect(claimRows(ledger).map((c) => c.status)).toEqual(["ABANDONED"]);
    expect(coveredByOpenClaim(ledger.db, "261001A0001")).toBe(false);
  });

  it("review 4: over HTTP the refusal is 409 and the stale claim is abandoned all the same", async () => {
    const ledger = payoutLedger();
    lan(ledger);
    servers = deskServers(ledger, CLOCK);
    const cookie = staffCookie(ledger, "minh");
    expect((await post(servers, "/api/admin/payouts/P1/claim", cookie, {})).statusCode).toBe(200);
    ledger.sqlite.prepare("DELETE FROM bank_accounts WHERE customer_id = 'P1'").run();
    const res = await post(servers, "/api/admin/payouts/P1/claim", cookie, {});
    expect(res.statusCode).toBe(409);
    expect(errorEnvelopeSchema.parse(JSON.parse(res.body)).error.messageKey).toBe("error.payout.no_bank");
    expect(claimRows(ledger).map((c) => c.status)).toEqual(["ABANDONED"]);
  });

  it("review 5: an account a VietQR cannot carry degrades to a preview without QR (qr_failed), never a 500", async () => {
    const ledger = payoutLedger();
    addOrder(ledger, { id: "261001Q0001", customer: "P2", cashback: 9263 });
    addBank(ledger, "P2", { number: "0071.000.9999" });
    servers = deskServers(ledger, CLOCK);
    const res = await post(servers, "/api/admin/payouts/P2/claim", staffCookie(ledger, "minh"), {});
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({ outcome: "claimed", amount: 9263, qrPayload: null, qrMissing: "qr_failed" });
    expect(claimRows(ledger)[0]).toMatchObject({ status: "OPEN", qr_shown_at: null });
  });

  it("review 7: reopening an own claim that carries a QR sets qr_shown_at when it was not set", () => {
    const ledger = payoutLedger();
    lan(ledger);
    const first = claimed(openClaim(ledger, "P1", MINH, at("2026-10-30T12:00:00.000Z")));
    ledger.sqlite.prepare("UPDATE payout_claims SET qr_shown_at = NULL").run();
    const again = claimed(openClaim(ledger, "P1", MINH, at("2026-10-30T12:05:00.000Z")));
    expect(again.claim.claimId).toBe(first.claim.claimId);
    expect(claimRows(ledger)[0]).toMatchObject({ qr_shown_at: "2026-10-30T12:05:00.000Z" });
  });
});

function staffCookie(ledger: Ledger, staffId: string): string {
  const session = ledger.tx((db) => openSession(db, { kind: "STAFF", staffId }, CLOCK, STAFF_SESSION_MS));
  return `${STAFF_SESSION_COOKIE}=${session.token}`;
}

function post(s: Servers, url: string, cookie: string, body: unknown) {
  return s.publicApp.inject({ method: "POST", url, headers: { host: ADMIN_HOST, origin: ORIGIN, cookie, [ACCESS_JWT_HEADER]: accessJwt(CLOCK) }, payload: body as object });
}
