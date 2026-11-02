/**
 * The admin desk's own screens for what the internal CLI did before (Stories 4.19, 4.20, 6.11
 * after cutover): staff accounts, campaigns and customer merges through the same commands, admin
 * only by path, every write audited, no password or hash in any answer; and the sidebar's counts,
 * which agree with the Payouts tab and the review queue.
 */
import { customerMergedResponseSchema, customerMergeProposalsSchema, deskCampaignPreviewSchema, deskCampaignsSchema, deskCountsSchema, deskMergePreviewSchema, staffIssuedPasswordSchema, staffListSchema } from "@cashback/contracts";
import { parseInstant } from "@cashback/core";
import { afterEach, describe, expect, it } from "vitest";

import { eventsOf } from "../src/admin/overview-business.query";
import { verifyPassword } from "../src/modules/identity/index";
import { openReviewCaseCount } from "../src/modules/orders/index";
import { getBalances, payoutQueueCounts } from "../src/modules/payouts/index";
import type { Ledger } from "../src/platform/db/ledger";
import { ADMIN_ONLY_PATHS } from "../src/platform/http/staff-routes";
import { close, type Servers } from "../src/platform/http/servers";
import { deskGet, deskPost, errorOf, staffCookie } from "./helpers/desk-http";
import { closeLedgers } from "./helpers/order-ledger";
import { addBank, addBonus, addOrder, CLOCK, payoutLedger } from "./helpers/payout-ledger";
import { deskServers } from "./helpers/staff-desk";

let servers: Servers | undefined;
afterEach(async () => {
  if (servers) await close(servers);
  servers = undefined;
  closeLedgers();
});

const rows = (ledger: Ledger, sql: string) => ledger.sqlite.prepare(sql).all() as Record<string, unknown>[];
const one = (ledger: Ledger, sql: string) => ledger.sqlite.prepare(sql).get() as Record<string, unknown> | undefined;

function desk(ledger: Ledger) {
  servers ??= deskServers(ledger, CLOCK);
  const s = servers;
  return {
    get: (staff: string, url: string) => deskGet(s, url, staffCookie(ledger, staff, CLOCK), CLOCK),
    post: (staff: string, url: string, body: unknown = {}) => deskPost(s, url, staffCookie(ledger, staff, CLOCK), body, CLOCK),
  };
}

/** minh is the root admin, tuan an employee. */
function staffLedger(): Ledger {
  const ledger = payoutLedger();
  ledger.sqlite.exec("UPDATE staff SET is_root = 1 WHERE staff_id = 'minh'");
  return ledger;
}

describe("staff screen", () => {
  it("lists every account with role, status and last sign-in, the root admin first, and never a hash", async () => {
    const ledger = staffLedger();
    ledger.sqlite.exec("UPDATE staff SET last_sign_in_at = '2026-10-30T11:30:00.000Z' WHERE staff_id = 'tuan'");
    const res = await desk(ledger).get("minh", "/api/admin/staff");
    expect(res.statusCode, res.body).toBe(200);
    expect(staffListSchema.parse(res.json()).staff).toEqual([
      { staffId: "minh", username: "minh", role: "ADMIN", status: "ACTIVE", root: true, lastSignInAt: null, createdAt: CLOCK.now() },
      { staffId: "tuan", username: "tuan", role: "EMPLOYEE", status: "ACTIVE", root: false, lastSignInAt: "2026-10-30T11:30:00.000Z", createdAt: CLOCK.now() },
    ]);
    expect(res.body).not.toMatch(/argon2|password/i);
  });

  it("refuses every staff path to an employee with 403 and keeps them on the admin-only list", async () => {
    const ledger = staffLedger();
    const d = desk(ledger);
    expect((await d.get("tuan", "/api/admin/staff")).statusCode).toBe(403);
    expect((await d.post("tuan", "/api/admin/staff", { username: "lan", role: "EMPLOYEE" })).statusCode).toBe(403);
    expect((await d.post("tuan", "/api/admin/staff/minh/password")).statusCode).toBe(403);
    expect((await d.post("tuan", "/api/admin/staff/minh/access", { status: "DISABLED" })).statusCode).toBe(403);
    for (const path of ["/api/admin/staff", "/api/admin/campaigns", "/api/admin/merges/preview"]) expect(ADMIN_ONLY_PATHS.some((p) => p.test(path)), path).toBe(true);
  });

  it("adds a member with a password issued once: stored only as its hash, audited without it", async () => {
    const ledger = staffLedger();
    const res = await desk(ledger).post("minh", "/api/admin/staff", { username: "thao.nguyen", role: "EMPLOYEE" });
    expect(res.statusCode, res.body).toBe(200);
    const issued = staffIssuedPasswordSchema.parse(res.json());
    expect(issued).toMatchObject({ staffId: "s-thao-nguyen", username: "thao.nguyen" });
    expect(issued.password).toHaveLength(16);
    const row = one(ledger, "SELECT role, status, is_root, password_hash FROM staff WHERE staff_id = 's-thao-nguyen'");
    expect(row).toMatchObject({ role: "EMPLOYEE", status: "ACTIVE", is_root: 0 });
    expect(await verifyPassword(String(row?.["password_hash"]), issued.password)).toBe(true);
    const audit = rows(ledger, "SELECT actor_id, event, payload FROM audit_entries WHERE entity_id = 's-thao-nguyen'");
    expect(audit).toEqual([expect.objectContaining({ actor_id: "minh", event: "identity.staff.seeded" })]);
    expect(JSON.stringify(rows(ledger, "SELECT * FROM audit_entries"))).not.toContain(issued.password);
  });

  it("refuses a sign-in name already taken and writes nothing", async () => {
    const ledger = staffLedger();
    const before = rows(ledger, "SELECT * FROM audit_entries").length;
    const res = await desk(ledger).post("minh", "/api/admin/staff", { username: "tuan", role: "ADMIN" });
    expect(res.statusCode).toBe(409);
    expect(errorOf(res.body).messageKey).toBe("error.staff.username_taken");
    expect(rows(ledger, "SELECT * FROM audit_entries")).toHaveLength(before);
  });

  it("changes a role, disables a member (ending their sessions) and protects the root admin", async () => {
    const ledger = staffLedger();
    const d = desk(ledger);
    staffCookie(ledger, "tuan", CLOCK);
    expect((await d.post("minh", "/api/admin/staff/tuan/access", { role: "ADMIN" })).json()).toEqual({ staffId: "tuan", role: "ADMIN", status: "ACTIVE" });
    expect((await d.post("minh", "/api/admin/staff/tuan/access", { status: "DISABLED" })).json()).toEqual({ staffId: "tuan", role: "ADMIN", status: "DISABLED" });
    expect(rows(ledger, "SELECT end_reason FROM sessions WHERE staff_id = 'tuan' AND ended_at IS NOT NULL").length).toBeGreaterThan(0);
    const root = await d.post("minh", "/api/admin/staff/minh/access", { role: "EMPLOYEE" });
    expect(errorOf(root.body).messageKey).toBe("error.staff.root_protected");
    expect(rows(ledger, "SELECT event FROM audit_entries WHERE event = 'identity.staff.access_changed'")).toHaveLength(2);
  });

  it("resets a password: a new one answered once, the old sessions ended, the audit without it", async () => {
    const ledger = staffLedger();
    staffCookie(ledger, "tuan", CLOCK);
    const res = await desk(ledger).post("minh", "/api/admin/staff/tuan/password");
    const issued = staffIssuedPasswordSchema.parse(res.json());
    expect(issued).toMatchObject({ staffId: "tuan", username: "tuan", sessionsEnded: 1 });
    expect(await verifyPassword(String(one(ledger, "SELECT password_hash FROM staff WHERE staff_id = 'tuan'")?.["password_hash"]), issued.password)).toBe(true);
    expect(JSON.stringify(rows(ledger, "SELECT * FROM audit_entries WHERE event = 'identity.staff.password_reset'"))).not.toContain(issued.password);
    expect((await desk(ledger).post("minh", "/api/admin/staff/nobody/password")).statusCode).toBe(404);
  });
});

const CAMPAIGN = { campaignId: "NOV20", name: "20 don dau thang 11", startsAt: "15/11/2026 00:00", endsAt: "22/11/2026 00:00", slots: 20, bonus: 20000, minOrderValue: 150000, platforms: ["shopee"], perCustomer: 1, excludedCustomers: [] };

describe("campaign screen", () => {
  it("previews a campaign without writing and answers the exclusive end in Vietnam time", async () => {
    const ledger = staffLedger();
    const res = await desk(ledger).post("minh", "/api/admin/campaigns/preview", { campaign: CAMPAIGN });
    expect(res.statusCode, res.body).toBe(200);
    expect(deskCampaignPreviewSchema.parse(res.json())).toMatchObject({ campaignId: "NOV20", slots: 20, endsAt: "2026-11-21T17:00:00.000Z", endsBefore: { time: "00:00" } });
    expect(one(ledger, "SELECT * FROM campaigns WHERE campaign_id = 'NOV20'")).toBeUndefined();
  });

  it("creates it through the command with its audit entry, refuses a second one and a bad window", async () => {
    const ledger = staffLedger();
    const d = desk(ledger);
    expect((await d.post("minh", "/api/admin/campaigns", { campaign: CAMPAIGN })).statusCode).toBe(200);
    expect(one(ledger, "SELECT origin, slots, per_customer FROM campaigns WHERE campaign_id = 'NOV20'")).toEqual({ origin: "STAFF", slots: 20, per_customer: 1 });
    expect(one(ledger, "SELECT actor_id FROM audit_entries WHERE event = 'campaigns.campaign.created'")).toEqual({ actor_id: "minh" });
    expect(errorOf((await d.post("minh", "/api/admin/campaigns", { campaign: CAMPAIGN })).body).messageKey).toBe("error.campaign.campaign_exists");
    expect(errorOf((await d.post("minh", "/api/admin/campaigns/preview", { campaign: { ...CAMPAIGN, campaignId: "X", endsAt: "14/11/2026 00:00" } })).body).messageKey).toBe("error.campaign.bad_window");
    expect((await d.post("tuan", "/api/admin/campaigns", { campaign: { ...CAMPAIGN, campaignId: "Y" } })).statusCode).toBe(403);
  });

  it("lists each campaign with its state, slots used and the Overview's own event result", async () => {
    const ledger = staffLedger();
    ledger.sqlite.exec(`INSERT INTO campaigns (campaign_id, name, starts_at, ends_at, slots, bonus, origin) VALUES ('OCT', 'October run', '2026-09-30T17:00:00.000Z', '2026-11-07T17:00:00.000Z', 3, 20000, 'STAFF'), ('DEC', 'December', '2026-11-30T17:00:00.000Z', '2026-12-07T17:00:00.000Z', 5, 10000, 'STAFF')`);
    addOrder(ledger, { id: "O1", customer: "P1", cashback: 9263 });
    addOrder(ledger, { id: "O2", customer: "P2", cashback: 5000 });
    ledger.sqlite.exec(`INSERT INTO campaign_awards (campaign_id, customer_id, order_id, amount, status, created_at, origin) VALUES ('OCT', 'P1', 'O1', 20000, 'CONFIRMED', '2026-10-20T03:00:00.000Z', 'RULE'), ('OCT', 'P2', 'O2', 20000, 'HELD', '2026-10-21T03:00:00.000Z', 'RULE'), ('OCT', 'P2', 'O2', 20000, 'VOID', '2026-10-19T03:00:00.000Z', 'RULE')`);
    const list = deskCampaignsSchema.parse((await desk(ledger).get("minh", "/api/admin/campaigns")).json()).campaigns;
    expect(list.map((c) => [c.campaignId, c.state])).toEqual([["DEC", "UPCOMING"], ["OCT", "RUNNING"], ["CAMP1", "RUNNING"]]);
    const oct = list.find((c) => c.campaignId === "OCT");
    expect(oct).toMatchObject({ slotsUsed: 2, awards: { held: 1, confirmed: 1, paid: 0, void: 1 } });
    expect(oct?.latest.map((a) => [a.orderId, a.customerCode, a.status])).toEqual([["O2", "DP00031", "VOID"], ["O2", "DP00031", "HELD"], ["O1", "DP00012", "CONFIRMED"]]);
    const event = eventsOf(ledger.db, { from: parseInstant("2026-09-30T17:00:00.000Z"), to: parseInstant("2026-11-07T17:00:00.000Z") }, new Set()).find((e) => e.campaignId === "OCT");
    expect(oct?.result).toEqual({ cost: event?.bonus, commission: event?.commission, operatorShare: event?.operatorShare, result: event?.result });
    expect(oct?.result?.cost).toBe(20000);
    expect(list.find((c) => c.campaignId === "CAMP1")?.result).toBeNull();
  });
});

describe("customer merge on the desk", () => {
  it("lists the proposals: a code claim, admin only", async () => {
    const ledger = staffLedger();
    ledger.sqlite.exec("INSERT INTO merge_claims (claimant_id, claimed_id, claimed_at) VALUES ('P2', 'P1', '2026-10-30T10:00:00.000Z')");
    const d = desk(ledger);
    const res = customerMergeProposalsSchema.parse((await d.get("minh", "/api/admin/merges/proposals")).json());
    expect(res.proposals).toEqual([expect.objectContaining({ reason: "code_claimed", merged: expect.objectContaining({ customerId: "P2" }), survivor: expect.objectContaining({ customerId: "P1" }) })]);
    expect((await d.get("tuan", "/api/admin/merges/proposals")).statusCode).toBe(403);
  });

  it("previews both sides with balances, orders and bank, and the survivor's balance after", async () => {
    const ledger = staffLedger();
    addOrder(ledger, { id: "M1", customer: "P1", cashback: 24860 });
    addOrder(ledger, { id: "M2", customer: "P2", cashback: 9263 });
    addBank(ledger, "P1", { bank: "MB", number: "0071000000921" });
    const res = await desk(ledger).post("minh", "/api/admin/merges/preview", { merged: "P2", survivor: "DP00012" });
    expect(res.statusCode, res.body).toBe(200);
    const preview = deskMergePreviewSchema.parse(res.json());
    expect(preview.survivor).toMatchObject({ customerCode: "DP00012", orders: 1, balance: { payable: 24860 }, bank: { lastFour: "0921" } });
    expect(preview.merged).toMatchObject({ customerId: "P2", orders: 1, balance: { payable: 9263 }, bank: null });
    expect(preview.plan).toEqual({ bankMoves: false, result: expect.objectContaining({ payable: 24860 + 9263 }) });
    expect(preview.refusal).toBeNull();
  });

  it("shows both sides with the refusal when the bank accounts differ, and apply refuses the same", async () => {
    const ledger = staffLedger();
    addBank(ledger, "P1", { number: "0071000000921" });
    addBank(ledger, "P2", { number: "0071000000555" });
    const d = desk(ledger);
    const preview = deskMergePreviewSchema.parse((await d.post("minh", "/api/admin/merges/preview", { merged: "P2", survivor: "P1" })).json());
    expect(preview.plan).toBeNull();
    expect(preview.refusal).toMatchObject({ code: "conflict", messageKey: "error.merge.bank_differs" });
    expect(preview.merged.bank?.lastFour).toBe("0555");
    const applied = await d.post("minh", "/api/admin/merges", { merged: "P2", survivor: "P1" });
    expect(errorOf(applied.body).messageKey).toBe("error.merge.bank_differs");
    expect(one(ledger, "SELECT status FROM customers WHERE customer_id = 'P2'")).toEqual({ status: "ACTIVE" });
  });

  it("applies the merge through the command: alias, audit, and the survivor's balance read again", async () => {
    const ledger = staffLedger();
    addOrder(ledger, { id: "M1", customer: "P1", cashback: 24860 });
    addOrder(ledger, { id: "M2", customer: "P2", cashback: 9263 });
    addBonus(ledger, "P2", "M2", 20000);
    const d = desk(ledger);
    expect((await d.post("tuan", "/api/admin/merges", { merged: "P2", survivor: "P1" })).statusCode).toBe(403);
    const res = customerMergedResponseSchema.parse((await d.post("minh", "/api/admin/merges", { merged: "P2", survivor: "P1" })).json());
    expect(res).toMatchObject({ mergedId: "P2", survivorId: "P1", balance: { payable: getBalances(ledger.db, ["P1"])[0]?.payable } });
    expect(one(ledger, "SELECT customer_id FROM customer_aliases WHERE alias = 'P2'")).toEqual({ customer_id: "P1" });
    expect(one(ledger, "SELECT actor_id FROM audit_entries WHERE event = 'identity.customer.merged'")).toEqual({ actor_id: "minh" });
  });
});

describe("sidebar counts", () => {
  it("answers the Payouts payable tab's count and the open review cases to any staff member", async () => {
    const ledger = staffLedger();
    addOrder(ledger, { id: "C1", customer: "P1", cashback: 9263 });
    addOrder(ledger, { id: "C2", customer: "P2", cashback: 5000 });
    addBank(ledger, "P1");
    ledger.sqlite.exec(`INSERT INTO review_cases (network, subject, order_id, reason, status, candidates, observation, opened_at, opened_by) VALUES ('shopee', 'C1', 'C1', 'unknown_status', 'OPEN', '[]', '{}', '2026-10-01T00:00:00.000Z', 'reconcile')`);
    const res = await desk(ledger).get("tuan", "/api/admin/counts");
    expect(res.statusCode, res.body).toBe(200);
    expect(deskCountsSchema.parse(res.json())).toEqual({ payable: payoutQueueCounts(ledger.db, CLOCK).payable, openReviewCases: openReviewCaseCount(ledger.db) });
    expect(res.json()).toEqual({ payable: 1, openReviewCases: 1 });
  });
});
