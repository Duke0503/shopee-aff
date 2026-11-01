/**
 * Story 6.9 (server side): a bank account saved or changed from the Zalo private chat (AD-17,
 * AD-23, FR-10, M-7, INV-5, INV-9, INV-11). The details are read and the bank matched to one
 * VietQR bank; a save stores the consent time, which is the 72-hour flag of the Payouts desk; a
 * change writes an audit entry with fingerprints only and enqueues one change message with the new
 * last four digits; the group is refused before anything is read. The assistant side is in
 * apps/assistant/tests/bank-chat.test.ts.
 */
import { ASSISTANT_BANK_PATH } from "@cashback/contracts";
import { fixedClock } from "@cashback/core";
import { afterEach, describe, expect, it } from "vitest";

import { assistantBankRoutes } from "../src/links/assistant-bank.routes";
import { bankAccountsOf, bankFingerprint, readBankDetails, sharedBankFingerprints } from "../src/modules/identity/index";
import { payoutFlags, payoutSnapshot } from "../src/modules/payouts/index";
import type { Ledger } from "../src/platform/db/ledger";
import { ASSISTANT_TOKEN_HEADER } from "../src/platform/http/internal-token.guard";
import { buildServers, close, type Servers } from "../src/platform/http/servers";
import { createLogger } from "../src/platform/log/logger";
import { closeLedgers } from "./helpers/order-ledger";
import { addBank, addOrder, CLOCK, confirmClaim, FINGERPRINT_KEY, openClaim, payoutLedger } from "./helpers/payout-ledger";

const INTERNAL = "i".repeat(40);
const ASSISTANT = "a".repeat(40);

const opened: Servers[] = [];
afterEach(async () => {
  for (const s of opened.splice(0)) await close(s);
  closeLedgers();
});

function app(ledger: Ledger, options: { lines?: string[]; fingerprintKey?: string | null; clock?: typeof CLOCK } = {}) {
  const lines = options.lines ?? [];
  const logger = createLogger({ level: "debug", destination: { write: (line: string) => void lines.push(line) } });
  const clock = options.clock ?? CLOCK;
  const servers = buildServers({ clock, internalToken: INTERNAL, assistantToken: ASSISTANT, logger, internal: [assistantBankRoutes({ ledger, clock, fingerprintKey: options.fingerprintKey === undefined ? FINGERPRINT_KEY : options.fingerprintKey })], public: [] });
  opened.push(servers);
  return async (details: string, chat: "private" | "group" = "private", zaloUserId = "P1") => {
    const res = await servers.internalApp.inject({ method: "POST", url: ASSISTANT_BANK_PATH, headers: { [ASSISTANT_TOKEN_HEADER]: ASSISTANT }, payload: { zaloUserId, displayName: "Lan", chat, details } });
    return { status: res.statusCode, body: res.json() as Record<string, unknown>, raw: res.body };
  };
}

const bankRow = (ledger: Ledger, id = "P1") => ledger.sqlite.prepare("SELECT bank_name, account_number, holder_name, fingerprint, consent_at, pending_confirmation FROM bank_accounts WHERE customer_id = ?").get(id) as Record<string, unknown> | undefined;
const outboxRows = (ledger: Ledger) => ledger.sqlite.prepare("SELECT dedup_key, customer_id, message_key, params FROM outbox").all() as { dedup_key: string; message_key: string; params: string }[];
const auditRows = (ledger: Ledger) => ledger.sqlite.prepare("SELECT event, actor_kind, actor_id, payload FROM audit_entries WHERE event = 'identity.bank_account.saved'").all() as { actor_kind: string; payload: string }[];

describe("Story 6.9: bank account saved or changed from the Zalo private chat", () => {
  it("AC1: \"Vietcombank 0123-456-789 nguyen thi lan\" in a private chat saves 0123456789, holder NGUYEN THI LAN, consent time set, and the reply shows only 6789", async () => {
    const ledger = payoutLedger();
    const res = await app(ledger)("Vietcombank 0123-456-789 nguyen thi lan");
    expect(res).toMatchObject({ status: 200, body: { registered: false, reply: { kind: "saved", bankName: "Vietcombank", lastFour: "6789", changed: false } } });
    expect(res.raw).not.toContain("0123456789");
    expect(res.raw).not.toContain("NGUYEN");
    expect(bankRow(ledger)).toEqual({ bank_name: "Vietcombank", account_number: "0123456789", holder_name: "NGUYEN THI LAN", fingerprint: bankFingerprint(FINGERPRINT_KEY, "0123456789"), consent_at: CLOCK.now(), pending_confirmation: 0 });
    expect(outboxRows(ledger)).toEqual([]);
  });

  it("AC1: the number may come first, as live customers wrote it; diacritics in the holder are folded", () => {
    expect(readBankDetails("0123456789 MB Nguy\u1ec5n V\u0103n \u0110\u1ee9c")).toMatchObject({ kind: "ok", bank: { shortName: "MBBank" }, accountNumber: "0123456789", holderName: "NGUYEN VAN DUC" });
    expect(readBankDetails("Ngan hang Vietcombank 0123 456 789 NGUYEN THI LAN")).toMatchObject({ kind: "ok", bank: { shortName: "Vietcombank" }, accountNumber: "0123456789" });
  });

  it("AC2: a bank name matching two VietQR banks lists both to choose from and saves nothing", async () => {
    const ledger = payoutLedger();
    const res = await app(ledger)("Cake by VPBank 0123456789 NGUYEN THI LAN");
    expect(res.body["reply"]).toEqual({ kind: "choose_bank", banks: ["VPBank", "CAKE"] });
    expect(bankRow(ledger)).toBeUndefined();
    expect(auditRows(ledger)).toEqual([]);
  });

  it("AC3: a number of 3 characters, or with characters outside letters and digits, is refused with the number rule and nothing is saved", async () => {
    const ledger = payoutLedger();
    const post = app(ledger);
    for (const details of ["Vietcombank 123 NGUYEN THI LAN", "Vietcombank 0123.456.789 NGUYEN THI LAN", "Vietcombank 0123456789012345678901234567890 NGUYEN THI LAN"]) {
      expect((await post(details)).body["reply"], details).toEqual({ kind: "invalid", rule: "number" });
    }
    expect((await post("Vietcombank NGUYEN THI LAN")).body["reply"]).toEqual({ kind: "invalid", rule: "format" });
    expect((await post("Vietcombank 0123456789")).body["reply"]).toEqual({ kind: "invalid", rule: "format" });
    expect((await post("Khongcobank 0123456789 NGUYEN THI LAN")).body["reply"]).toEqual({ kind: "invalid", rule: "bank" });
    expect((await post("Vietcombank 0123456789 NGUYEN @@")).body["reply"]).toEqual({ kind: "invalid", rule: "holder" });
    expect(bankRow(ledger)).toBeUndefined();
  });

  it("AC4: a bank change raises the 72-hour flag, writes an audit entry with only the fingerprint and enqueues one change message with the new last four digits", async () => {
    const ledger = payoutLedger();
    addBank(ledger, "P1", { number: "0071000123456" });
    addOrder(ledger, { id: "261001A0001", customer: "P1", cashback: 79216 });
    const old = bankAccountsOf(ledger.db, ["P1"]).get("P1") ?? null;
    expect(payoutFlags({ bank: old, sharedFingerprints: new Set(), payable: 79216, gross: 79216, now: CLOCK.now() })).not.toContain("BANK_CHANGED");
    const lines: string[] = [];
    const res = await app(ledger, { lines })("Techcombank 1903-5555-6789 NGUYEN THI LAN");
    expect(res.body["reply"]).toEqual({ kind: "saved", bankName: "Techcombank", lastFour: "6789", changed: true });
    const now = bankAccountsOf(ledger.db, ["P1"]).get("P1") ?? null;
    expect(payoutFlags({ bank: now, sharedFingerprints: sharedBankFingerprints(ledger.db), payable: 79216, gross: 79216, now: CLOCK.now() })).toContain("BANK_CHANGED");
    const audit = auditRows(ledger);
    expect(audit).toHaveLength(1);
    expect(audit[0]?.actor_kind).toBe("customer");
    expect(JSON.parse(audit[0]?.payload ?? "{}")).toEqual({ customerId: "P1", bankFingerprint: bankFingerprint(FINGERPRINT_KEY, "190355556789"), previousFingerprint: bankFingerprint(FINGERPRINT_KEY, "0071000123456"), via: "zalo_private", wasHeld: false });
    expect(audit[0]?.payload).not.toMatch(/190355556789|0071000123456|NGUYEN/);
    const told = outboxRows(ledger);
    expect(told).toHaveLength(1);
    expect(told[0]).toMatchObject({ message_key: "bank_changed", params: JSON.stringify({ bank: "Techcombank", lastFour: "6789" }) });
    expect(told[0]?.dedup_key).toMatch(/^bank_account:P1\.\d+:changed$/);
    expect(lines.join("\n")).not.toMatch(/190355556789|1903-5555-6789|NGUYEN/);
  });

  it("AC4: the same account sent again changes nothing; a change never lets an open claim pay the old account", async () => {
    const ledger = payoutLedger();
    addBank(ledger, "P1", { number: "0071000123456" });
    addOrder(ledger, { id: "261001A0001", customer: "P1", cashback: 79216 });
    const claim = openClaim(ledger, "P1");
    expect(claim.kind).toBe("claimed");
    const before = payoutSnapshot(ledger.db, "P1")?.hash;
    await app(ledger, { clock: fixedClock("2026-10-30T12:01:00.000Z") })("Techcombank 190355556789 NGUYEN THI LAN");
    expect(payoutSnapshot(ledger.db, "P1")?.hash).not.toBe(before);
    if (claim.kind !== "claimed") throw new Error("no claim");
    expect(confirmClaim(ledger, claim.claim.claimId, claim.snapshot.hash).kind).toBe("changed");
    const again = app(ledger, { clock: fixedClock("2026-10-30T12:05:00.000Z") });
    expect((await again("Techcombank 190355556789 NGUYEN THI LAN")).body["reply"]).toEqual({ kind: "saved", bankName: "Techcombank", lastFour: "6789", changed: false });
    expect(outboxRows(ledger)).toHaveLength(1);
    expect(auditRows(ledger)).toHaveLength(1);
  });

  it("AC4: a website change held for confirmation is settled by the same account sent in the private chat", async () => {
    const ledger = payoutLedger();
    addBank(ledger, "P1", { bank: "Vietcombank", number: "0123456789", holder: "NGUYEN THI LAN", held: true });
    expect((await app(ledger)("Vietcombank 0123456789 NGUYEN THI LAN")).body["reply"]).toMatchObject({ kind: "saved", changed: true });
    expect(bankRow(ledger)).toMatchObject({ pending_confirmation: 0, consent_at: CLOCK.now() });
    expect(JSON.parse(auditRows(ledger)[0]?.payload ?? "{}")).toMatchObject({ wasHeld: true });
  });

  it("AC5: bank details sent in the group are refused and nothing is stored, no one is registered", async () => {
    const ledger = payoutLedger();
    const count = () => (ledger.sqlite.prepare("SELECT count(*) AS n FROM customers").get() as { n: number }).n;
    const before = count();
    const res = await app(ledger)("Vietcombank 0123456789 NGUYEN THI LAN", "group", "70000000000000001");
    expect(res.body).toEqual({ registered: false, customerCode: null, reply: { kind: "private_only" } });
    expect((await app(ledger)("Vietcombank 0123456789 NGUYEN THI LAN", "group")).body["reply"]).toEqual({ kind: "private_only" });
    expect(bankRow(ledger)).toBeUndefined();
    expect(count()).toBe(before);
  });

  it("the guest account gets no reply; without a fingerprint key nothing is saved and the customer is sent to an admin", async () => {
    const ledger = payoutLedger();
    expect((await app(ledger)("Vietcombank 0123456789 NGUYEN THI LAN", "private", "HOUSE")).body["reply"]).toEqual({ kind: "none" });
    expect((await app(ledger, { fingerprintKey: null })("Vietcombank 0123456789 NGUYEN THI LAN")).body["reply"]).toEqual({ kind: "contact_admin" });
    expect((await app(ledger, { fingerprintKey: "short" })("Vietcombank 0123456789 NGUYEN THI LAN")).body["reply"]).toEqual({ kind: "contact_admin" });
    expect(bankRow(ledger)).toBeUndefined();
  });

  it("review 1: the same account stored in another spelling (holder with accents, the bank as free text) is unchanged: no notice, consent kept, an open claim still confirms", async () => {
    const ledger = payoutLedger();
    addBank(ledger, "P1", { bank: "ngan hang Vietcombank", number: "0123456789", holder: "Nguy\u1ec5n Th\u1ecb Lan" });
    addOrder(ledger, { id: "261001A0001", customer: "P1", cashback: 79216 });
    const claim = openClaim(ledger, "P1");
    if (claim.kind !== "claimed") throw new Error("no claim");
    const before = bankRow(ledger);
    expect((await app(ledger)("VCB 0123-456-789 nguyen thi lan")).body["reply"]).toEqual({ kind: "saved", bankName: "Vietcombank", lastFour: "6789", changed: false });
    expect(bankRow(ledger)).toEqual(before);
    expect(outboxRows(ledger)).toEqual([]);
    expect(auditRows(ledger)).toEqual([]);
    expect(confirmClaim(ledger, claim.claim.claimId, claim.snapshot.hash).kind).toBe("recorded");
  });

  it("review 2: with the number first, the bank's filler words never end up in the holder (common live forms)", () => {
    const forms: [string, string, string][] = [
      ["0123456789 MB Bank Nguyen Van A", "MBBank", "NGUYEN VAN A"],
      ["0123456789 MB NGUYEN VAN A", "MBBank", "NGUYEN VAN A"],
      ["0123456789 Vietcombank Nguyen Thi Lan", "Vietcombank", "NGUYEN THI LAN"],
      ["0123456789 ngan hang Vietcombank NGUYEN THI LAN", "Vietcombank", "NGUYEN THI LAN"],
      ["0123456789 Techcombank TCB NGUYEN VAN A", "Techcombank", "TCB NGUYEN VAN A"],
      ["0123456789 VCB nh NGUYEN THI HANG", "Vietcombank", "NGUYEN THI HANG"],
      ["MB Bank 0123456789 Nguyen Van A", "MBBank", "NGUYEN VAN A"],
      ["Vietcombank 0123456789 ngan hang Nguyen Thi Hang", "Vietcombank", "NGUYEN THI HANG"],
    ];
    for (const [text, bank, holder] of forms) expect(readBankDetails(text), text).toMatchObject({ kind: "ok", bank: { shortName: bank }, holderName: holder });
  });

  it("review 4: a quoted reply is saved only when a bank and a number were read; anything else is not bank details and saves nothing", async () => {
    const ledger = payoutLedger();
    const servers = buildServers({ clock: CLOCK, internalToken: INTERNAL, assistantToken: ASSISTANT, internal: [assistantBankRoutes({ ledger, clock: CLOCK, fingerprintKey: FINGERPRINT_KEY })], public: [] });
    opened.push(servers);
    const quoted = async (details: string) => (await servers.internalApp.inject({ method: "POST", url: ASSISTANT_BANK_PATH, headers: { [ASSISTANT_TOKEN_HEADER]: ASSISTANT }, payload: { zaloUserId: "P1", chat: "private", details, quoted: true } })).json() as { reply: unknown };
    expect((await quoted("don 2611010001 shopee giao chua")).reply).toEqual({ kind: "not_bank_details" });
    expect((await quoted("Vietcombank 0123456789 @@")).reply).toEqual({ kind: "not_bank_details" });
    expect(bankRow(ledger)).toBeUndefined();
    expect((await quoted("Cake by VPBank 0123456789 NGUYEN THI LAN")).reply).toEqual({ kind: "choose_bank", banks: ["VPBank", "CAKE"] });
    expect((await quoted("Vietcombank 0123456789 NGUYEN THI LAN")).reply).toMatchObject({ kind: "saved" });
  });
});
