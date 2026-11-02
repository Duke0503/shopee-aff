/**
 * Story 7.5 (server side): the bank account and the password from the customer website. A
 * website save is held until the customer confirms it in the Zalo private chat (M-7): the Payouts
 * row moves to "needs action" and a message with the new last four digits is enqueued; the
 * confirmation lifts the hold and keeps the 72-hour flag; erase removes the account with an
 * audited fingerprint and a message; a chosen password has 8 characters or more and is not the
 * customer code. The website side is in apps/web/tests/account.test.tsx.
 */
import { BANK_LIST_PATH, bankAccountSavedSchema, bankListSchema, MY_BANK_ACCOUNT_PATH, MY_MONEY_PATH, MY_PASSWORD_PATH, myMoneySchema, passwordChangedSchema } from "@cashback/contracts";
import { afterEach, describe, expect, it } from "vitest";

import { bankReplyOf } from "../src/links/assistant-bank.routes";
import { bankFingerprint, customerBankState, hashPassword, openSession, signInBurstWatch, unknownSignInTally } from "../src/modules/identity/index";
import { alertsFor, auditFor } from "../src/modules/operations/index";
import { answerPayoutQueue, BANK_CHANGE_FLAG_MS } from "../src/modules/payouts/index";
import type { Ledger } from "../src/platform/db/ledger";
import { clientKeyer } from "../src/platform/http/client-key";
import { buildServers, close, type Servers } from "../src/platform/http/servers";
import { CUSTOMER_SESSION_COOKIE } from "../src/platform/http/session-cookie";
import { accountRoutes } from "../src/web/account.routes";
import { myMoneyRoutes } from "../src/web/my-money.routes";
import { closeLedgers } from "./helpers/order-ledger";
import { addBank, addOrder, CLOCK, FINGERPRINT_KEY, payoutLedger } from "./helpers/payout-ledger";

const ORIGIN = "https://hoantiendp.com";
const CHEAP = { memoryKiB: 1024, passes: 1, parallelism: 1 };
const VCB = "970436";
const opened: Servers[] = [];
afterEach(async () => {
  for (const s of opened.splice(0)) await close(s);
  closeLedgers();
});

async function site(options: { readonly fingerprintKey?: string | null } = {}) {
  const ledger = payoutLedger();
  ledger.sqlite.prepare("UPDATE customers SET password_hash = ? WHERE customer_id = 'P1'").run(await hashPassword("matkhau-cu-1", CHEAP));
  const deps = { ledger, clock: CLOCK, auditFor: (db: Parameters<typeof auditFor>[0]) => auditFor(db, CLOCK), alertsFor: (db: Parameters<typeof alertsFor>[0]) => alertsFor(db, CLOCK), burst: signInBurstWatch(), unknown: unknownSignInTally() };
  const routes = accountRoutes({ ...deps, fingerprintKey: options.fingerprintKey === undefined ? FINGERPRINT_KEY : options.fingerprintKey, origins: [ORIGIN], clientKey: clientKeyer("k".repeat(40)), hash: (p) => hashPassword(p, CHEAP) });
  const servers = buildServers({ clock: CLOCK, internalToken: "i".repeat(40), public: [routes, myMoneyRoutes({ ledger, clock: CLOCK })] });
  opened.push(servers);
  const cookieOf = (customerId: string): string => `${CUSTOMER_SESSION_COOKIE}=${ledger.tx((db) => openSession(db, { kind: "CUSTOMER", customerId }, CLOCK, null)).token}`;
  const call = async (method: "GET" | "POST" | "DELETE", url: string, cookie: string | null, payload?: unknown, origin: string | null = ORIGIN) => {
    const headers: Record<string, string> = { ...(cookie === null ? {} : { cookie }), ...(origin === null ? {} : { origin }) };
    const res = await servers.publicApp.inject({ method, url, headers, ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }) });
    return { status: res.statusCode, body: res.json() as Record<string, unknown> & { error?: { code: string; messageKey: string; fields?: Record<string, string> } } };
  };
  return { ledger, cookieOf, call };
}

const FORM = { bankBin: VCB, accountNumber: "0071 0012-3456 789", holderName: "nguy\u1ec5n th\u1ecb lan", consent: true };
const outbox = (ledger: Ledger) => ledger.sqlite.prepare("SELECT customer_id, message_key, params FROM outbox ORDER BY rowid").all() as { customer_id: string; message_key: string; params: string }[];
const audits = (ledger: Ledger, event: string) => (ledger.sqlite.prepare("SELECT payload FROM audit_entries WHERE event = ? ORDER BY rowid").all(event) as { payload: string }[]).map((r) => JSON.parse(r.payload) as Record<string, unknown>);
const bankRow = (ledger: Ledger, id: string) => ledger.sqlite.prepare("SELECT bank_name, account_number, holder_name, consent_at, pending_confirmation FROM bank_accounts WHERE customer_id = ?").get(id) as Record<string, unknown> | undefined;

describe("Story 7.5: Account page manages the bank account and password", () => {
  it("AC1: a bank change on the website is held ('waiting for your confirmation on Zalo'), the Payouts row moves to needs action and a confirmation message is enqueued", async () => {
    const s = await site();
    addOrder(s.ledger, { id: "261001A0001", customer: "P1", cashback: 79216 });
    addBank(s.ledger, "P1", { number: "0011000999888" });
    const cookie = s.cookieOf("P1");
    expect(answerPayoutQueue(s.ledger, { pageSize: "100", "filter[queue]": "PAYABLE" }, CLOCK).rows.map((r) => r.customerId)).toEqual(["P1"]);
    const saved = await s.call("POST", MY_BANK_ACCOUNT_PATH, cookie, FORM);
    expect(saved.status).toBe(200);
    expect(bankAccountSavedSchema.parse(saved.body)).toEqual({ result: "changed", bank: { bankName: "Vietcombank", holderName: "NGUYEN THI LAN", lastFour: "6789", held: true } });
    expect(bankRow(s.ledger, "P1")).toMatchObject({ account_number: "007100123456789", holder_name: "NGUYEN THI LAN", pending_confirmation: 1, consent_at: CLOCK.now() });
    expect(myMoneySchema.parse((await s.call("GET", MY_MONEY_PATH, cookie)).body).bank).toEqual({ bankName: "Vietcombank", holderName: "NGUYEN THI LAN", lastFour: "6789", held: true });
    expect(customerBankState(s.ledger.db, "P1")).toBe("held");
    const action = answerPayoutQueue(s.ledger, { pageSize: "100", "filter[queue]": "ACTION" }, CLOCK).rows.find((r) => r.customerId === "P1");
    expect(action?.flags).toContain("BANK_HELD");
    expect(outbox(s.ledger)).toEqual([{ customer_id: "P1", message_key: "bank_changed_website", params: JSON.stringify({ bank: "Vietcombank", lastFour: "6789" }) }]);
    const [entry] = audits(s.ledger, "identity.bank_account.saved");
    expect(entry).toEqual({ customerId: "P1", bankFingerprint: bankFingerprint(FINGERPRINT_KEY, "007100123456789"), previousFingerprint: bankFingerprint(FINGERPRINT_KEY, "0011000999888"), via: "website", held: true });
    expect(JSON.stringify(entry)).not.toContain("6789");
  });

  it("AC2: the customer confirms in the Zalo private chat (\"/stk xacnhan 6789\"): the hold is lifted and the 72-hour flag stays", async () => {
    const s = await site();
    addOrder(s.ledger, { id: "261001A0001", customer: "P1", cashback: 79216 });
    await s.call("POST", MY_BANK_ACCOUNT_PATH, s.cookieOf("P1"), FORM);
    const consentBefore = bankRow(s.ledger, "P1")?.["consent_at"];
    const reply = s.ledger.tx((db) => bankReplyOf(db, { ledger: s.ledger, clock: CLOCK, fingerprintKey: FINGERPRINT_KEY }, "P1", "X\u00e1c nh\u1eadn 6789"));
    expect(reply).toEqual({ kind: "confirmed", bankName: "Vietcombank", lastFour: "6789" });
    expect(customerBankState(s.ledger.db, "P1")).toBe("confirmed");
    expect(bankRow(s.ledger, "P1")?.["consent_at"]).toBe(consentBefore);
    const flags = answerPayoutQueue(s.ledger, { pageSize: "100", "filter[queue]": "ACTION" }, CLOCK).rows.find((r) => r.customerId === "P1")?.flags;
    expect(flags).toBe("BANK_CHANGED");
    expect(BANK_CHANGE_FLAG_MS).toBe(72 * 3_600_000);
    expect(audits(s.ledger, "identity.bank_account.confirmed")).toEqual([{ customerId: "P1", bankFingerprint: bankFingerprint(FINGERPRINT_KEY, "007100123456789"), via: "zalo_private" }]);
  });

  it("AC2 (review): the confirmation names the account: after saving ...1234 then ...9999, confirming 1234 confirms nothing and names 9999; confirming 9999 confirms it", async () => {
    const s = await site();
    const cookie = s.cookieOf("P1");
    await s.call("POST", MY_BANK_ACCOUNT_PATH, cookie, { ...FORM, accountNumber: "0071001231234" });
    await s.call("POST", MY_BANK_ACCOUNT_PATH, cookie, { ...FORM, accountNumber: "0071009999999" });
    const confirm = (details: string) => s.ledger.tx((db) => bankReplyOf(db, { ledger: s.ledger, clock: CLOCK, fingerprintKey: FINGERPRINT_KEY }, "P1", details));
    expect(confirm("xacnhan 1234")).toEqual({ kind: "confirm_mismatch", lastFour: "9999" });
    expect(customerBankState(s.ledger.db, "P1")).toBe("held");
    expect(confirm("xacnhan")).toEqual({ kind: "confirm_mismatch", lastFour: "9999" });
    expect(confirm("xacnhan 99-99")).toEqual({ kind: "confirm_mismatch", lastFour: "9999" });
    expect(customerBankState(s.ledger.db, "P1")).toBe("held");
    expect(audits(s.ledger, "identity.bank_account.confirmed")).toEqual([]);
    expect(confirm("XACNHAN 9999")).toEqual({ kind: "confirmed", bankName: "Vietcombank", lastFour: "9999" });
    expect(customerBankState(s.ledger.db, "P1")).toBe("confirmed");
    expect(outbox(s.ledger).map((m) => JSON.parse(m.params) as unknown)).toEqual([{ bank: "Vietcombank", lastFour: "1234" }, { bank: "Vietcombank", lastFour: "9999" }]);
  });

  it("AC2 (review): \"/stk xacnhan\" with no account saved answers that there is nothing to confirm", async () => {
    const s = await site();
    expect(s.ledger.tx((db) => bankReplyOf(db, { ledger: s.ledger, clock: CLOCK, fingerprintKey: FINGERPRINT_KEY }, "P2", "xacnhan 1234"))).toEqual({ kind: "nothing_to_confirm" });
  });

  it("AC3: a password of 7 characters, or equal to the customer code, is refused with the field error", async () => {
    const s = await site();
    const cookie = s.cookieOf("P1");
    const short = await s.call("POST", MY_PASSWORD_PATH, cookie, { currentPassword: "matkhau-cu-1", newPassword: "1234567" });
    expect([short.status, short.body.error?.fields]).toEqual([400, { newPassword: "error.password.too_short" }]);
    // DP00012 has 7 characters, too short anyway; a longer code is refused as the code itself.
    s.ledger.sqlite.prepare("INSERT INTO customers (customer_id, customer_code, role, status, password_hash) SELECT 'P9', 'DP100012', 'USER', 'ACTIVE', password_hash FROM customers WHERE customer_id = 'P1'").run();
    const code = await s.call("POST", MY_PASSWORD_PATH, s.cookieOf("P9"), { currentPassword: "matkhau-cu-1", newPassword: " dp100012" });
    expect([code.status, code.body.error?.fields]).toEqual([400, { newPassword: "error.password.is_code" }]);
    expect(audits(s.ledger, "identity.customer.password_changed")).toEqual([]);
  });

  it("AC3: a good password is stored, other sessions end, this one stays signed in; a wrong current password counts like a wrong sign-in", async () => {
    const s = await site();
    const other = s.cookieOf("P1");
    const mine = s.cookieOf("P1");
    const wrong = await s.call("POST", MY_PASSWORD_PATH, mine, { currentPassword: "nham-mat-khau", newPassword: "matkhau-moi-2" });
    expect([wrong.status, wrong.body.error?.fields]).toEqual([400, { currentPassword: "error.password.wrong_current" }]);
    expect(s.ledger.sqlite.prepare("SELECT failures FROM customer_sign_in_throttles WHERE customer_code = 'DP00012'").get()).toEqual({ failures: 1 });
    const ok = await s.call("POST", MY_PASSWORD_PATH, mine, { currentPassword: "matkhau-cu-1", newPassword: "matkhau-moi-2" });
    expect(passwordChangedSchema.parse(ok.body)).toEqual({ changed: true, otherSessionsEnded: 1 });
    expect((await s.call("GET", MY_MONEY_PATH, mine)).status).toBe(200);
    expect((await s.call("GET", MY_MONEY_PATH, other)).status).toBe(401);
    expect(audits(s.ledger, "identity.customer.password_changed")).toEqual([{ customerId: "P1", sessionsEnded: 1, via: "website" }]);
  });

  it("AC4: erasing the bank details, confirmed once, removes the account, audits its fingerprint and tells the customer in Zalo", async () => {
    const s = await site();
    addBank(s.ledger, "P1", { number: "0011000999888" });
    const erased = await s.call("DELETE", MY_BANK_ACCOUNT_PATH, s.cookieOf("P1"));
    expect(erased.body).toEqual({ erased: true });
    expect(bankRow(s.ledger, "P1")).toBeUndefined();
    expect(audits(s.ledger, "identity.bank_account.erased")).toEqual([{ customerId: "P1", bankFingerprint: bankFingerprint(FINGERPRINT_KEY, "0011000999888"), via: "website", wasHeld: false }]);
    expect(outbox(s.ledger)).toEqual([{ customer_id: "P1", message_key: "bank_erased", params: JSON.stringify({ bank: "Vietcombank", lastFour: "9888" }) }]);
    expect((await s.call("DELETE", MY_BANK_ACCOUNT_PATH, s.cookieOf("P1"))).body).toEqual({ erased: false });
  });

  it("AC5: with the consent box unchecked the form is refused under that field, and nothing is saved", async () => {
    const s = await site();
    const refused = await s.call("POST", MY_BANK_ACCOUNT_PATH, s.cookieOf("P1"), { ...FORM, consent: false });
    expect([refused.status, refused.body.error?.fields]).toEqual([400, { consent: "error.bank.consent_required" }]);
    expect(bankRow(s.ledger, "P1")).toBeUndefined();
    expect(outbox(s.ledger)).toEqual([]);
  });

  it("each broken rule is said under its field: an unknown bank, a number outside 4 to 30, a holder that is not letters", async () => {
    const s = await site();
    const refused = await s.call("POST", MY_BANK_ACCOUNT_PATH, s.cookieOf("P1"), { bankBin: "999999", accountNumber: "12", holderName: "LAN 123", consent: true });
    expect(refused.body.error?.fields).toEqual({ bankBin: "error.bank.bank_unknown", accountNumber: "error.bank.number_rule", holderName: "error.bank.holder_rule" });
  });

  it("the same account sent again is unchanged: nothing is written, nothing is held again, no message", async () => {
    const s = await site();
    addBank(s.ledger, "P1", { number: "007100123456789", holder: "NGUYEN THI LAN" });
    const again = await s.call("POST", MY_BANK_ACCOUNT_PATH, s.cookieOf("P1"), FORM);
    expect(bankAccountSavedSchema.parse(again.body)).toMatchObject({ result: "unchanged", bank: { held: false } });
    expect(bankRow(s.ledger, "P1")).toMatchObject({ pending_confirmation: 0, consent_at: "2026-09-01T03:00:00.000Z" });
    expect(outbox(s.ledger)).toEqual([]);
  });

  it("needs a session and the website's Origin; without a fingerprint key nothing is saved; the bank list is the VietQR list", async () => {
    const s = await site();
    expect((await s.call("POST", MY_BANK_ACCOUNT_PATH, null, FORM)).status).toBe(401);
    expect((await s.call("POST", MY_BANK_ACCOUNT_PATH, s.cookieOf("P1"), FORM, "https://evil.example")).status).toBe(403);
    expect((await s.call("POST", MY_PASSWORD_PATH, s.cookieOf("P1"), { currentPassword: "matkhau-cu-1", newPassword: "matkhau-moi-2" }, null)).status).toBe(403);
    const keyless = await site({ fingerprintKey: null });
    expect((await keyless.call("POST", MY_BANK_ACCOUNT_PATH, keyless.cookieOf("P1"), FORM)).body.error?.messageKey).toBe("error.bank.unavailable");
    const banks = bankListSchema.parse((await s.call("GET", BANK_LIST_PATH, null)).body).banks;
    expect(banks.find((b) => b.bin === VCB)?.shortName).toBe("Vietcombank");
    expect(banks.length).toBeGreaterThan(50);
  });
});
