/**
 * Story 4.19: customer merge by admin command, preview then apply (FR-11, AD-23, AD-6, AD-17, D42,
 * INV-1, decision H8). The merge moves no order, award or ledger entry; balances, lists and
 * attribution resolve through the alias; the survivor's balance after the merge equals both
 * previews read together (golden: packages/golden/fixtures/money/merge-balance.json).
 */
import { randomBytes } from "node:crypto";
import { customerMergedResponseSchema, customerMergePreviewSchema, STAFF_TOKEN_HEADER } from "@cashback/contracts";
import { fixedClock } from "@cashback/core";
import { combinedBalance } from "@cashback/money";
import { afterEach, describe, expect, it } from "vitest";

import { runAdminCli, type CliIo } from "../src/admin/admin-cli";
import { adminCommandRoutes } from "../src/admin/admin-command.routes";
import { hashPassword, openSession, STAFF_SESSION_MS } from "../src/modules/identity/index";
import { getBalances } from "../src/modules/payouts/index";
import type { Ledger } from "../src/platform/db/ledger";
import { INTERNAL_TOKEN_HEADER } from "../src/platform/http/internal-token.guard";
import { buildServers, close, type Servers } from "../src/platform/http/servers";
import { approved, apply, closeLedgers } from "./helpers/order-ledger";
import { addBank, addBonus, addClawback, addOrder, payoutLedger } from "./helpers/payout-ledger";

const CLOCK = fixedClock("2026-10-30T12:00:00.000Z");
const TOKEN = randomBytes(24).toString("hex");

let servers: Servers | undefined;
afterEach(async () => {
  if (servers) await close(servers);
  servers = undefined;
  closeLedgers();
});

/** Lan's old record P1 (approved 79,216, a confirmed bonus, an awaiting order, a paid payout) and her new record P2 (approved 5,000, an open clawback of 9,263). */
function pair(): Ledger {
  const ledger = payoutLedger();
  addOrder(ledger, { id: "M1", customer: "P1", cashback: 79216 });
  addOrder(ledger, { id: "M2", customer: "P1", status: "AWAITING_APPROVAL", estimate: 15000 });
  addBonus(ledger, "P1", "M1", 20000);
  addOrder(ledger, { id: "M3", customer: "P2", cashback: 5000 });
  addClawback(ledger, "P2", "M4", 9263);
  ledger.sqlite.exec(`UPDATE customers SET zalo_user_id = '8812447100001' WHERE customer_id = 'P1'; UPDATE customers SET zalo_user_id = '8812447100002' WHERE customer_id = 'P2';
    INSERT INTO payouts (customer_id, status, transfer_amount, recorded_at, origin) VALUES ('P1', 'RECORDED', 50000, '2026-10-01T03:00:00.000Z', 'CONFIRM')`);
  return ledger;
}

function internal(ledger: Ledger) {
  servers = buildServers({ clock: CLOCK, internalToken: TOKEN, internal: [adminCommandRoutes({ ledger, clock: CLOCK })] });
  const app = servers.internalApp;
  const token = (staffId: string) => ledger.tx((db) => openSession(db, { kind: "STAFF", staffId }, CLOCK, STAFF_SESSION_MS)).token;
  const post = (path: string, body: unknown, staffToken: string | null, internalToken: string | null = TOKEN) =>
    app.inject({ method: "POST", url: path, headers: { ...(internalToken === null ? {} : { [INTERNAL_TOKEN_HEADER]: internalToken }), ...(staffToken === null ? {} : { [STAFF_TOKEN_HEADER]: staffToken }) }, payload: body as object });
  return { app, token, post };
}

const rows = (ledger: Ledger, sql: string) => ledger.sqlite.prepare(sql).all() as Record<string, unknown>[];
const ledgerFacts = (ledger: Ledger) => ({
  orders: rows(ledger, "SELECT * FROM orders ORDER BY order_id"),
  awards: rows(ledger, "SELECT * FROM campaign_awards ORDER BY award_id"),
  entries: rows(ledger, "SELECT * FROM ledger_entries ORDER BY entry_id"),
  payouts: rows(ledger, "SELECT payout_id, customer_id, status, transfer_amount FROM payouts ORDER BY payout_id"),
});
const figures = (b: { gross: number; payable: number; waiting: number; paid: number; deductedNext: number }) => ({ gross: b.gross, payable: b.payable, waiting: b.waiting, paid: b.paid, deductedNext: b.deductedNext });

describe("Story 4.19: customer merge by admin command", () => {
  it("AC1: two customers with different bank accounts are refused at preview and at apply, naming the difference", async () => {
    const ledger = pair();
    addBank(ledger, "P1", { number: "0071000111111", bank: "Vietcombank" });
    addBank(ledger, "P2", { number: "0071000222222", bank: "Techcombank" });
    const { token, post } = internal(ledger);
    const admin = token("minh");
    for (const path of ["/internal/admin/customers/merge/preview", "/internal/admin/customers/merge"]) {
      const res = await post(path, { merged: "DP00012", survivor: "DP00031" }, admin);
      expect(res.statusCode, path).toBe(409);
      const error = (res.json() as { error: { messageKey: string; fields: Record<string, string> } }).error;
      expect(error.messageKey).toBe("error.merge.bank_differs");
      expect(error.fields["mergedBank"]).toMatch(/1111$/);
      expect(error.fields["survivorBank"]).toMatch(/2222$/);
      expect(JSON.stringify(error)).not.toMatch(/0071000111111|0071000222222/);
    }
    expect(rows(ledger, "SELECT status FROM customers WHERE customer_id IN ('P1', 'P2')")).toEqual([{ status: "ACTIVE" }, { status: "ACTIVE" }]);
  });

  it("AC2: the preview shows both customers, the survivor and the resulting balances from getBalances, and writes nothing", async () => {
    const ledger = pair();
    addBank(ledger, "P1", { number: "0071000111111" });
    const { token, post } = internal(ledger);
    const before = ledgerFacts(ledger);
    const audits = rows(ledger, "SELECT count(*) AS n FROM audit_entries");
    const res = await post("/internal/admin/customers/merge/preview", { merged: "8812447100001", survivor: "DP00031" }, token("minh"));
    expect(res.statusCode, res.body).toBe(200);
    const preview = customerMergePreviewSchema.parse(res.json());
    const [p1, p2] = getBalances(ledger.db, ["P1", "P2"]);
    expect(preview).toMatchObject({ survivorId: "P2", bankMoves: true, merged: { customerId: "P1", customerCode: "DP00012", bank: { lastFour: "1111" }, balance: figures(p1!) }, survivor: { customerId: "P2", customerCode: "DP00031", bank: null, balance: figures(p2!) } });
    expect(preview.result).toEqual(combinedBalance([p1!, p2!]));
    expect(ledgerFacts(ledger)).toEqual(before);
    expect(rows(ledger, "SELECT count(*) AS n FROM audit_entries")).toEqual(audits);
    expect(rows(ledger, "SELECT status FROM customers WHERE customer_id = 'P1'")).toEqual([{ status: "ACTIVE" }]);
  });

  it("AC3: apply marks the merged customer MERGED with an alias to the survivor, changes no order row, and the survivor's balance is both previews together (golden)", async () => {
    const ledger = pair();
    const { token, post } = internal(ledger);
    const admin = token("minh");
    const preview = customerMergePreviewSchema.parse((await post("/internal/admin/customers/merge/preview", { merged: "P1", survivor: "P2" }, admin)).json());
    const before = ledgerFacts(ledger);
    const res = await post("/internal/admin/customers/merge", { merged: "P1", survivor: "P2" }, admin);
    expect(res.statusCode, res.body).toBe(200);
    const merged = customerMergedResponseSchema.parse(res.json());
    expect(rows(ledger, "SELECT customer_id, status FROM customers WHERE customer_id IN ('P1', 'P2') ORDER BY customer_id")).toEqual([{ customer_id: "P1", status: "MERGED" }, { customer_id: "P2", status: "ACTIVE" }]);
    expect(rows(ledger, "SELECT alias, customer_id FROM customer_aliases WHERE alias = 'P1'")).toEqual([{ alias: "P1", customer_id: "P2" }]);
    expect(ledgerFacts(ledger)).toEqual(before);
    // Golden: P1 gross 99,216 (79,216 + bonus 20,000), waiting 13,354, paid 50,000; P2 gross 5,000 less a clawback of 9,263.
    const expected = { gross: 104216, deductedNext: 9263, payable: 94953, waiting: preview.merged.balance.waiting, paid: 50000 };
    expect(merged.balance).toEqual(expected);
    expect(figures(getBalances(ledger.db, ["P2"])[0]!)).toEqual(expected);
    expect(merged.balance).toEqual(preview.result);
    expect(getBalances(ledger.db, ["DP00012"])[0]?.customerId).toBe("P2");
    const audit = rows(ledger, "SELECT actor_id, entity_id, payload FROM audit_entries WHERE event = 'identity.customer.merged'");
    expect(audit).toEqual([{ actor_id: "minh", entity_id: "P1", payload: JSON.stringify({ mergedId: "P1", survivorId: "P2", bankMoves: false }) }]);
  });

  it("AC4: a later report row with the merged customer's id in sub_id1 attributes to the survivor", async () => {
    const ledger = pair();
    const { token, post } = internal(ledger);
    expect((await post("/internal/admin/customers/merge", { merged: "P1", survivor: "P2" }, token("minh"))).statusCode).toBe(200);
    apply(ledger, approved("261101MRG", [20000], { subIds: ["P1", "", "", "", ""] }));
    expect(rows(ledger, "SELECT customer_id FROM orders WHERE order_id = '261101MRG'")).toEqual([{ customer_id: "P2" }]);
  });

  it("AC5: without an admin staff token the internal listener refuses it; an employee is forbidden; without the internal token nothing answers", async () => {
    const ledger = pair();
    const { token, post } = internal(ledger);
    const body = { merged: "P1", survivor: "P2" };
    for (const path of ["/internal/admin/customers/merge/preview", "/internal/admin/customers/merge"]) {
      expect((await post(path, body, null)).statusCode, path).toBe(401);
      expect((await post(path, body, token("tuan"))).statusCode, path).toBe(403);
      expect((await post(path, body, token("minh"), null)).statusCode, path).toBe(401);
    }
    expect(rows(ledger, "SELECT status FROM customers WHERE customer_id = 'P1'")).toEqual([{ status: "ACTIVE" }]);
  });

  it("refuses the same customer twice, an unknown key and the guest account", async () => {
    const ledger = pair();
    const { token, post } = internal(ledger);
    const admin = token("minh");
    const key = async (merged: string, survivor: string) => (((await post("/internal/admin/customers/merge/preview", { merged, survivor }, admin)).json()) as { error: { messageKey: string } }).error.messageKey;
    expect(await key("P1", "DP00012")).toBe("error.merge.same_customer");
    expect(await key("NOBODY", "P2")).toBe("error.merge.customer_not_found");
    expect(await key("HOUSE", "P2")).toBe("error.merge.not_a_customer");
  });

  it("the CLI previews by default, merges with --apply, and prints one JSON line without secrets", async () => {
    const ledger = pair();
    const { app } = internal(ledger);
    const password = "correct horse battery";
    ledger.sqlite.prepare("UPDATE staff SET password_hash = ? WHERE staff_id = 'minh'").run(await hashPassword(password));
    const lines: Record<string, unknown>[] = [];
    const io: CliIo = {
      async call(method, path, body, headers) {
        const res = await app.inject({ method, url: path, headers: { [INTERNAL_TOKEN_HEADER]: TOKEN, ...headers }, ...(body === undefined ? {} : { payload: body as object }) });
        return { status: res.statusCode, body: JSON.parse(res.body) as unknown };
      },
      secret: async () => password,
      readJson: () => ({}),
      print: (line) => void lines.push(line),
    };
    expect(await runAdminCli(["customer-merge", "DP00012", "--into", "DP00031", "--as", "minh"], io)).toBe(0);
    expect(lines.at(-1)).toMatchObject({ ok: true, command: "customer-merge", applied: false, preview: { survivorId: "P2" } });
    expect(rows(ledger, "SELECT status FROM customers WHERE customer_id = 'P1'")).toEqual([{ status: "ACTIVE" }]);
    expect(await runAdminCli(["customer-merge", "DP00012", "--into", "DP00031", "--as", "minh", "--apply"], io)).toBe(0);
    expect(lines.at(-1)).toMatchObject({ ok: true, applied: true, merged: { mergedId: "P1", survivorId: "P2" } });
    expect(JSON.stringify(lines)).not.toContain(password);
    expect(await runAdminCli(["customer-merge", "DP00012", "--as", "minh"], io)).toBe(1);
    expect(lines.at(-1)).toMatchObject({ ok: false, reason: "usage" });
  });
});
