/**
 * Story 4.21: network payout batches matched to exact orders (FR-19, D27, D59), on the facts of the
 * production backup: Shopee pays a batch every three or four days with its gross (eligible) and what
 * was received; the difference is the 0.98% fee and, in a withheld batch, 10% tax on the gross, so
 * withholding is read per batch (golden money/settlement-match.json). Batches also pay for orders
 * attributed to no customer, so the operator's orders cover part of a batch and the rest is
 * unattributed. A listed batch settles exactly its approved or paid orders; an unlisted one the
 * network's approved orders of its window. The code review items of Sprint 17 are tested by name.
 */
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { networkPayoutRecordResponseSchema, networkSettlementDetailSchema, networkSettlementListSchema, payoutClaimResponseSchema, type NetworkPayoutRecord } from "@cashback/contracts";
import { loadFixtureFile } from "@cashback/golden";
import { splitCommission } from "@cashback/money";
import { afterEach, describe, expect, it } from "vitest";

import { commandAudit } from "../src/modules/operations/index";
import { dismissReviewCase } from "../src/modules/orders/index";
import { NETWORK_SYNC_ACTOR, networkPayoutInternalRoutes, recordNetworkPayout } from "../src/modules/payouts/index";
import type { Ledger } from "../src/platform/db/ledger";
import { INTERNAL_TOKEN_HEADER } from "../src/platform/http/internal-token.guard";
import { buildServers, close, type Servers } from "../src/platform/http/servers";
import { deskGet, deskPost, staffCookie } from "./helpers/desk-http";
import { buildLiveCopy, importOnce, rows } from "./helpers/live-fixture";
import { closeLedgers } from "./helpers/order-ledger";
import { addBank, CLOCK, MINH, payoutLedger } from "./helpers/payout-ledger";
import { deskServers } from "./helpers/staff-desk";
import { applyDepsFor } from "../src/reconcile/apply-deps";

let servers: Servers | undefined;
afterEach(async () => {
  if (servers) await close(servers);
  servers = undefined;
  closeLedgers();
});

interface OrderSpec {
  readonly id: string;
  readonly customer?: string;
  readonly status?: "APPROVED" | "PAID" | "AWAITING_APPROVAL" | "REJECTED";
  readonly gross: number | null;
  readonly approvedAt?: string | null;
  readonly settledBy?: string;
  readonly request?: string;
  readonly origin?: "REPORT" | "CUTOVER";
  readonly estimate?: number | null;
  readonly paidAt?: string | null;
}

function addOrder(ledger: Ledger, o: OrderSpec): void {
  const status = o.status ?? "APPROVED";
  const paidAt = o.paidAt !== undefined ? o.paidAt : status === "PAID" ? "2026-10-01T03:00:00.000Z" : null;
  ledger.sqlite
    .prepare("INSERT INTO orders (order_id, network, platform, customer_id, request_id, status, estimated_commission, approved_commission, cashback, approved_at, paid_at, network_batch_id, settled_at, origin) VALUES (?, 'shopee', 'shopee', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(o.id, o.customer ?? "P1", o.request ?? null, status, o.estimate ?? null, o.gross, o.gross === null ? null : 1000, o.approvedAt === undefined ? "2026-09-25T03:00:00.000Z" : o.approvedAt, paidAt, o.settledBy ?? null, o.settledBy === undefined ? null : "2026-09-30T03:00:00.000Z", o.origin ?? "REPORT");
}

/** A withheld batch's received amount for a gross, as the network computes it (FR-13 split). */
const withheldNet = (gross: number): number => splitCommission({ approvedCommission: gross, network: "shopee", withheld: true }).net;

const batch = (overrides: Partial<NetworkPayoutRecord> = {}): NetworkPayoutRecord => ({ network: "shopee", networkPayoutId: "1034567", status: "PAID", amount: withheldNet(100000), eligibleAmount: 100000, createdAt: "2026-09-28T03:00:00.000Z", paidAt: "2026-10-01T03:00:00.000Z", ...overrides });
const record = (ledger: Ledger, input: NetworkPayoutRecord) => ledger.tx((db) => recordNetworkPayout(db, input, { clock: CLOCK, by: commandAudit(db, CLOCK, NETWORK_SYNC_ACTOR) }));
const settledOf = (ledger: Ledger) => ledger.sqlite.prepare("SELECT order_id, network_batch_id FROM orders ORDER BY order_id").all();
const openCases = (ledger: Ledger) => ledger.sqlite.prepare("SELECT reason, subject, order_id FROM review_cases WHERE status = 'OPEN' ORDER BY case_id").all();
const lines = (ledger: Ledger) => ledger.sqlite.prepare("SELECT order_id, outcome, gross, net FROM network_settlement_orders ORDER BY order_id").all();
const audits = (ledger: Ledger, event: string) => (ledger.sqlite.prepare("SELECT count(*) AS n FROM audit_entries WHERE event = ?").get(event) as { n: number }).n;

const GOLDEN = loadFixtureFile(fileURLToPath(new URL("../../../packages/golden/fixtures/money/settlement-match.json", import.meta.url)));
const goldenInput = (i: number) => GOLDEN.cases[i]?.input as { eligible: number; received: number };

describe("Story 4.21 acceptance criteria", () => {
  it("AC1: a listed batch settles exactly its approved or paid orders; one another batch settled is refused and opens a review case", () => {
    const ledger = payoutLedger();
    addOrder(ledger, { id: "L1", gross: 60000 });
    addOrder(ledger, { id: "L2", gross: 40000, status: "PAID" });
    addOrder(ledger, { id: "L3", gross: 30000 });
    addOrder(ledger, { id: "L4", gross: 5000, settledBy: "1000001" });
    const answer = record(ledger, batch({ orderIds: ["L1", "L2", "L4"] }));
    expect(answer).toMatchObject({ match: "MATCHED", withheld: true, settled: 2, conflicts: 1, matchedGross: 100000, unattributed: 0, replay: false });
    expect(settledOf(ledger)).toEqual([
      { order_id: "L1", network_batch_id: "1034567" },
      { order_id: "L2", network_batch_id: "1034567" },
      { order_id: "L3", network_batch_id: null },
      { order_id: "L4", network_batch_id: "1000001" },
    ]);
    expect(openCases(ledger)).toEqual([{ reason: "settlement_conflict", subject: "L4", order_id: "L4" }]);
  });

  it("AC2 (golden, real batches): the batch's withholding, fee and tax are read from its gross and what it paid", () => {
    const ledger = payoutLedger();
    const real = [0, 1, 2].map(goldenInput);
    real.forEach((r, i) => record(ledger, batch({ networkPayoutId: `R${i}`, amount: r.received, eligibleAmount: r.eligible, createdAt: `2026-09-2${4 + i}T03:00:00.000Z` })));
    expect(ledger.sqlite.prepare("SELECT network_payout_id, withheld, fee, tax FROM network_settlements ORDER BY network_payout_id").all()).toEqual(
      [0, 1, 2].map((i) => {
        const e = GOLDEN.cases[i]?.expected as { withheld: boolean; fee: number; tax: number };
        return { network_payout_id: `R${i}`, withheld: e.withheld ? 1 : 0, fee: e.fee, tax: e.tax };
      }),
    );
  });

  it("AC2: an unlisted batch settles the network's approved orders of its window and records the rest of its gross as unattributed", () => {
    const ledger = payoutLedger();
    addOrder(ledger, { id: "W0", gross: 20000, approvedAt: "2026-09-23T03:00:00.000Z" });
    addOrder(ledger, { id: "W1", gross: 30000, approvedAt: "2026-09-25T03:00:00.000Z" });
    addOrder(ledger, { id: "W2", gross: 40000, status: "PAID", approvedAt: "2026-09-27T03:00:00.000Z" });
    addOrder(ledger, { id: "W3", gross: 9000, approvedAt: "2026-09-28T03:00:00.000Z" });
    addOrder(ledger, { id: "WX", gross: null, status: "AWAITING_APPROVAL", approvedAt: null });
    record(ledger, batch({ networkPayoutId: "B1", amount: withheldNet(25000), eligibleAmount: 25000, createdAt: "2026-09-24T03:00:00.000Z" }));
    const answer = record(ledger, batch({ networkPayoutId: "B2", createdAt: "2026-09-28T03:00:00.000Z" }));
    expect(answer).toMatchObject({ match: "MATCHED", settled: 2, matchedGross: 70000, unattributed: 30000, caseIds: [] });
    expect(settledOf(ledger)).toEqual([
      { order_id: "W0", network_batch_id: "B1" },
      { order_id: "W1", network_batch_id: "B2" },
      { order_id: "W2", network_batch_id: "B2" },
      { order_id: "W3", network_batch_id: null },
      { order_id: "WX", network_batch_id: null },
    ]);
    expect(ledger.sqlite.prepare("SELECT window_from, unattributed FROM network_settlements WHERE network_payout_id = 'B2'").get()).toEqual({ window_from: "2026-09-24T03:00:00.000Z", unattributed: 30000 });
  });

  it("AC3: when the window's orders exceed the batch nothing is settled, the candidates are kept and a settlement_mismatch case opens", () => {
    const ledger = payoutLedger();
    addOrder(ledger, { id: "M1", gross: 80000 });
    addOrder(ledger, { id: "M2", gross: 30000 });
    const answer = record(ledger, batch());
    expect(answer).toMatchObject({ match: "MISMATCH", settled: 0, matchedGross: 110000, unattributed: -10000 });
    expect((settledOf(ledger) as { network_batch_id: string | null }[]).every((o) => o.network_batch_id === null)).toBe(true);
    expect(lines(ledger)).toEqual([
      { order_id: "M1", outcome: "CANDIDATE", gross: 80000, net: withheldNet(80000) },
      { order_id: "M2", outcome: "CANDIDATE", gross: 30000, net: withheldNet(30000) },
    ]);
    expect(openCases(ledger)).toEqual([{ reason: "settlement_mismatch", subject: "payout:1034567", order_id: null }]);
  });

  it("AC4: staff open a batch and see gross, fee, tax, received, their orders' gross and the unattributed rest, and its orders with thumbnails, from the server", async () => {
    const ledger = payoutLedger();
    ledger.sqlite.prepare("INSERT INTO link_requests (request_id, customer_id, network, platform, status, source_url, origin, product_name, product_image_url) VALUES ('RQ1', 'P1', 'shopee', 'shopee', 'DELIVERED', 'https://shopee.vn/p/1', 'REQUEST', 'Noi com', 'https://cf.example.test/a.jpg')").run();
    addOrder(ledger, { id: "D1", gross: 60000, request: "RQ1" });
    addOrder(ledger, { id: "D2", gross: 20000, customer: "P2" });
    record(ledger, batch());
    servers = deskServers(ledger, CLOCK);
    const cookie = staffCookie(ledger, "tuan", CLOCK);
    const list = networkSettlementListSchema.parse((await deskGet(servers, "/api/admin/network-settlements", cookie, CLOCK)).json());
    expect(list.rows).toEqual([expect.objectContaining({ networkPayoutId: "1034567", match: "MATCHED", eligibleAmount: 100000, withheld: true, fee: 980, tax: 10000, amount: 89020, matchedGross: 80000, unattributed: 20000, orderCount: 2 })]);
    expect(list.summary).toMatchObject({ eligibleAmount: 100000, amount: 89020, fee: 980, tax: 10000, matchedGross: 80000 });
    expect(networkSettlementListSchema.parse((await deskGet(servers, "/api/admin/network-settlements?q=10345", cookie, CLOCK)).json()).total).toBe(1);
    const detail = networkSettlementDetailSchema.parse((await deskGet(servers, `/api/admin/network-settlements/${list.rows[0]?.settlementId}`, cookie, CLOCK)).json());
    expect(detail).toMatchObject({ listed: false, windowFrom: null, openCaseIds: [] });
    expect(detail.orders).toEqual([
      { orderId: "D1", outcome: "SETTLED", gross: 60000, net: withheldNet(60000), customerCode: "DP00012", customerName: expect.any(String), productName: "Noi com", productImageUrl: "https://cf.example.test/a.jpg", status: "APPROVED", settledBy: "1034567" },
      { orderId: "D2", outcome: "SETTLED", gross: 20000, net: withheldNet(20000), customerCode: "DP00031", customerName: expect.any(String), productName: null, productImageUrl: null, status: "APPROVED", settledBy: "1034567" },
    ]);
    expect((await deskGet(servers, "/api/admin/network-settlements/999", cookie, CLOCK)).statusCode).toBe(404);
    expect((await deskPost(servers, "/api/admin/network-settlements", cookie, {}, CLOCK)).statusCode).toBe(404);
  });

  it("AC5: the payout panel's covered orders each say whether the network paid them and by which batch", async () => {
    const ledger = payoutLedger();
    addBank(ledger, "P1");
    addOrder(ledger, { id: "C1", gross: 100000 });
    addOrder(ledger, { id: "C2", gross: 10000, approvedAt: "2026-10-15T03:00:00.000Z" });
    record(ledger, batch({ orderIds: ["C1"] }));
    servers = deskServers(ledger, CLOCK);
    const claim = payoutClaimResponseSchema.parse((await deskPost(servers, "/api/admin/payouts/P1/claim", staffCookie(ledger, "minh", CLOCK), {}, CLOCK)).json());
    if (claim.outcome !== "claimed") throw new Error("expected a claim");
    expect(claim.orders.map((o) => [o.orderId, o.settled, o.settledBy])).toEqual([
      ["C1", true, "1034567"],
      ["C2", false, null],
    ]);
  });
});

describe("Sprint 17 code review", () => {
  it("review 1: an order list that arrives while the batch is PROCESSING is kept, and the later PAID record without it settles those orders", () => {
    const ledger = payoutLedger();
    addOrder(ledger, { id: "P1A", gross: 100000 });
    addOrder(ledger, { id: "P1B", gross: 30000 });
    expect(record(ledger, batch({ status: "PROCESSING", paidAt: null, orderIds: ["P1A"] }))).toMatchObject({ match: "PENDING", settled: 0 });
    expect(record(ledger, batch())).toMatchObject({ match: "MATCHED", settled: 1 });
    expect(settledOf(ledger)).toEqual([
      { order_id: "P1A", network_batch_id: "1034567" },
      { order_id: "P1B", network_batch_id: null },
    ]);
  });

  it("review 2 (revised at cutover review): a batch imported at cutover stays HISTORIC when the network later reports it PAID: its status moves, no order is matched", () => {
    const ledger = payoutLedger();
    addOrder(ledger, { id: "I1", gross: 100000 });
    ledger.sqlite.prepare("INSERT INTO network_settlements (network, network_payout_id, status, amount, eligible_amount, withheld, fee, tax, created_at, match, origin, recorded_at, updated_at) VALUES ('shopee', '1034567', 'PROCESSING', 89020, 100000, 1, 980, 10000, '2026-09-28T03:00:00.000Z', 'HISTORIC', 'CUTOVER', ?, ?)").run(CLOCK.now(), CLOCK.now());
    expect(record(ledger, batch())).toMatchObject({ match: "HISTORIC", settled: 0, caseIds: [] });
    expect(ledger.sqlite.prepare("SELECT status, match FROM network_settlements").get()).toEqual({ status: "PAID", match: "HISTORIC" });
    expect(settledOf(ledger)).toEqual([{ order_id: "I1", network_batch_id: null }]);
    expect(() => ledger.sqlite.prepare("UPDATE network_settlements SET match = 'MATCHED'").run()).toThrow(/network_settlements:/);
  });

  it("review 3: a mismatch case staff dismissed is not reopened by the same facts on every sync, and is reopened when the facts change", () => {
    const ledger = payoutLedger();
    addOrder(ledger, { id: "M1", gross: 120000 });
    const [caseId] = record(ledger, batch()).caseIds;
    ledger.tx((db) => dismissReviewCase(db, { caseId: caseId as number, reason: "checked with Shopee" }, applyDepsFor(db, CLOCK, { production: true, actor: MINH })));
    expect(record(ledger, batch()).caseIds).toEqual([]);
    expect(openCases(ledger)).toEqual([]);
    addOrder(ledger, { id: "M2", gross: 5000 });
    expect(record(ledger, batch()).caseIds).toHaveLength(1);
    expect(openCases(ledger)).toEqual([{ reason: "settlement_mismatch", subject: "payout:1034567", order_id: null }]);
  });

  it("review 4: a later record with another amount, gross or creation time is audited and opens a case; the stored facts stay", () => {
    const ledger = payoutLedger();
    addOrder(ledger, { id: "F1", gross: 100000 });
    record(ledger, batch());
    const answer = record(ledger, batch({ amount: 89000 }));
    expect(answer).toMatchObject({ factsChanged: true, replay: false });
    expect(ledger.sqlite.prepare("SELECT amount FROM network_settlements").get()).toEqual({ amount: 89020 });
    expect(audits(ledger, "payouts.network_settlement.facts_changed")).toBe(1);
    expect(openCases(ledger)).toEqual([{ reason: "settlement_facts_changed", subject: "payout:1034567", order_id: null }]);
    expect(() => ledger.sqlite.prepare("UPDATE network_settlements SET eligible_amount = 1").run()).toThrow(/network_settlements:/);
  });

  it("review 5: an order's net follows the batch's withholding: a batch without tax pays 99.02% of the order's gross", () => {
    const ledger = payoutLedger();
    addOrder(ledger, { id: "N1", gross: 100000 });
    const notWithheld = splitCommission({ approvedCommission: 100000, network: "shopee", withheld: false }).net;
    expect(record(ledger, batch({ amount: notWithheld }))).toMatchObject({ withheld: false, match: "MATCHED" });
    expect(lines(ledger)).toEqual([{ order_id: "N1", outcome: "SETTLED", gross: 100000, net: notWithheld }]);
  });

  it("review 6: a listed order that is rejected or still awaiting is not settled; each opens a case naming the order", () => {
    const ledger = payoutLedger();
    addOrder(ledger, { id: "A1", gross: 100000 });
    addOrder(ledger, { id: "R1", gross: null, status: "REJECTED" });
    addOrder(ledger, { id: "W1", gross: null, status: "AWAITING_APPROVAL" });
    expect(record(ledger, batch({ orderIds: ["A1", "R1", "W1"] }))).toMatchObject({ settled: 1, notApproved: 2 });
    expect(settledOf(ledger)).toEqual([
      { order_id: "A1", network_batch_id: "1034567" },
      { order_id: "R1", network_batch_id: null },
      { order_id: "W1", network_batch_id: null },
    ]);
    expect(openCases(ledger)).toEqual([
      { reason: "settlement_not_approved", subject: "R1", order_id: "R1" },
      { reason: "settlement_not_approved", subject: "W1", order_id: "W1" },
    ]);
  });

  it("review 7: an unchanged re-record rewrites nothing and writes no audit entry; a real change writes exactly one", () => {
    const ledger = payoutLedger();
    addOrder(ledger, { id: "U1", gross: 120000 });
    record(ledger, batch());
    const before = { rows: ledger.sqlite.prepare("SELECT rowid, * FROM network_settlement_orders").all(), updated: ledger.sqlite.prepare("SELECT updated_at FROM network_settlements").get(), audits: audits(ledger, "payouts.network_settlement.recorded") };
    expect(record(ledger, batch()).replay).toBe(true);
    expect({ rows: ledger.sqlite.prepare("SELECT rowid, * FROM network_settlement_orders").all(), updated: ledger.sqlite.prepare("SELECT updated_at FROM network_settlements").get(), audits: audits(ledger, "payouts.network_settlement.recorded") }).toEqual(before);
    ledger.sqlite.prepare("UPDATE orders SET approved_commission = 90000 WHERE order_id = 'U1'").run();
    const all = (ledger.sqlite.prepare("SELECT count(*) AS n FROM audit_entries").get() as { n: number }).n;
    expect(record(ledger, batch())).toMatchObject({ match: "MATCHED", settled: 1, replay: false });
    expect((ledger.sqlite.prepare("SELECT count(*) AS n FROM audit_entries").get() as { n: number }).n).toBe(all + 1);
  });

  it("review 8: the window's candidates are filtered in SQL: only orders this system approved, never an imported order (no approval time; its paid time is after the network paid)", () => {
    const ledger = payoutLedger();
    addOrder(ledger, { id: "C1", gross: null, estimate: 60000, status: "PAID", approvedAt: null, paidAt: "2026-09-26T03:00:00.000Z", origin: "CUTOVER" });
    addOrder(ledger, { id: "C2", gross: 7000, status: "PAID", approvedAt: "2026-09-25T03:00:00.000Z", paidAt: "2026-09-26T03:00:00.000Z", origin: "CUTOVER" });
    addOrder(ledger, { id: "C3", gross: 30000, approvedAt: "2026-09-27T03:00:00.000Z" });
    addOrder(ledger, { id: "C4", gross: null, estimate: 9000, status: "APPROVED", approvedAt: "2026-09-27T03:00:00.000Z" });
    expect(record(ledger, batch())).toMatchObject({ match: "MATCHED", settled: 1, matchedGross: 30000, unattributed: 70000 });
    expect(lines(ledger)).toEqual([{ order_id: "C3", outcome: "SETTLED", gross: 30000, net: withheldNet(30000) }]);
  });

  it("the first batch recorded after go-live starts its window at the cutover import, not at the last historic batch", () => {
    const ledger = payoutLedger();
    ledger.sqlite.prepare("INSERT INTO network_settlements (network, network_payout_id, status, amount, eligible_amount, withheld, fee, tax, created_at, match, origin, recorded_at, updated_at) VALUES ('shopee', 'H1', 'PAID', 89020, 100000, 1, 980, 10000, '2026-09-20T03:00:00.000Z', 'HISTORIC', 'CUTOVER', '2026-09-26T00:00:00.000Z', '2026-09-26T00:00:00.000Z')").run();
    addOrder(ledger, { id: "G1", gross: 30000, approvedAt: "2026-09-25T03:00:00.000Z" });
    addOrder(ledger, { id: "G2", gross: 40000, approvedAt: "2026-09-27T03:00:00.000Z" });
    expect(record(ledger, batch())).toMatchObject({ match: "MATCHED", settled: 1, matchedGross: 40000 });
    expect(ledger.sqlite.prepare("SELECT window_from FROM network_settlements WHERE network_payout_id = '1034567'").get()).toEqual({ window_from: "2026-09-26T00:00:00.000Z" });
    expect(settledOf(ledger)).toEqual([
      { order_id: "G1", network_batch_id: null },
      { order_id: "G2", network_batch_id: "1034567" },
    ]);
  });
});

describe("Story 4.21: the internal listener and the status flow", () => {
  it("a PROCESSING batch is recorded and not matched; once PAID it is matched; a status never goes back; the route needs the internal token", async () => {
    const ledger = payoutLedger();
    addOrder(ledger, { id: "P1A", gross: 100000 });
    const token = randomBytes(24).toString("hex");
    servers = buildServers({ clock: CLOCK, internalToken: token, internal: [networkPayoutInternalRoutes({ ledger, clock: CLOCK, audit: (db, actor) => commandAudit(db, CLOCK, actor) })] });
    const send = (body: unknown, withToken = true) => (servers as Servers).internalApp.inject({ method: "POST", url: "/internal/network-payouts", headers: withToken ? { [INTERNAL_TOKEN_HEADER]: token } : {}, payload: body as object });
    expect((await send(batch({ status: "PROCESSING" }), false)).statusCode).toBe(401);
    expect(networkPayoutRecordResponseSchema.parse((await send(batch({ status: "PROCESSING", paidAt: null }))).json())).toMatchObject({ match: "PENDING", settled: 0, matchedGross: null });
    expect(networkPayoutRecordResponseSchema.parse((await send(batch())).json())).toMatchObject({ match: "MATCHED", settled: 1 });
    expect((await send(batch({ status: "PROCESSING" }))).statusCode).toBe(409);
    expect((await send({ ...batch(), amount: 1.5 })).statusCode).toBe(400);
    expect((await send({ ...batch(), billingPeriod: "2026-09" })).statusCode).toBe(400);
    expect(ledger.sqlite.prepare("SELECT DISTINCT actor_kind, actor_id FROM audit_entries WHERE event = 'payouts.network_settlement.recorded'").all()).toEqual([{ actor_kind: "system", actor_id: "network-sync" }]);
  });

  it("a batch whose amounts fit neither split is a mismatch that names it, and settles nothing", () => {
    const ledger = payoutLedger();
    addOrder(ledger, { id: "X1", gross: 50000 });
    expect(record(ledger, batch({ amount: 95000 }))).toMatchObject({ withheld: null, match: "MISMATCH", settled: 0 });
    expect(openCases(ledger)).toEqual([{ reason: "settlement_mismatch", subject: "payout:1034567", order_id: null }]);
  });

  it("a settlement case is never applied, only dismissed: it changes no order", async () => {
    const ledger = payoutLedger();
    addOrder(ledger, { id: "M1", gross: 200000 });
    const [caseId] = record(ledger, batch()).caseIds;
    servers = deskServers(ledger, CLOCK);
    const res = await deskPost(servers, `/api/admin/review-cases/${caseId}/apply`, staffCookie(ledger, "minh", CLOCK), { reason: "checked" }, CLOCK);
    expect(res.statusCode).not.toBe(200);
    expect(ledger.sqlite.prepare("SELECT network_batch_id FROM orders").get()).toEqual({ network_batch_id: null });
  });
});

describe("Story 4.21 at cutover: live payout batches", () => {
  /** Eleven batches shaped like the production backup: every three or four days, two without tax, the rest withheld. */
  const REAL = [
    ["1001", "2026-09-24", 168347, 166698],
    ["1002", "2026-09-28", 434665, 386938],
    ["1003", "2026-10-01", 100000, 99020],
    ["1004", "2026-10-04", 120970, withheldNet(120970)],
    ["1005", "2026-10-08", 60743, 54073],
    ["1006", "2026-10-12", 98000, withheldNet(98000)],
    ["1007", "2026-10-15", 75500, withheldNet(75500)],
    ["1008", "2026-10-18", 150400, withheldNet(150400)],
    ["1009", "2026-10-21", 88000, withheldNet(88000)],
    ["1010", "2026-10-26", 112394, withheldNet(112394)],
    ["1011", "2026-10-29", 100000, 89020],
  ] as const;

  it("the import stores every live batch as HISTORIC with its withholding read from its amounts, matches no order and opens no review case", () => {
    const values = REAL.map(([id, day, eligible, received]) => `('${id}', 'shopee', 'paid', ${received}, ${eligible}, '${day}T10:00:00+07:00', '${day}T15:00:00+07:00', '{}', '${day}T10:00:00+07:00', '${day}T10:00:00+07:00')`).join(",\n");
    const extra = `('BLZ1', 'lazada', 'paid', 10, 10, NULL, NULL, '{}', '2026-10-20T09:00:00+07:00', '2026-10-20T09:00:00+07:00'), ('BODD', 'shopee', 'refunded', 10, 10, NULL, NULL, '{}', '2026-10-20T09:00:00+07:00', '2026-10-20T09:00:00+07:00')`;
    const source = buildLiveCopy({ extraSql: `INSERT INTO payout_batches (batch_id, platform, status, amount, eligible_amount, created_time, paid_time, raw_json, created_at, updated_at) VALUES ${values}, ${extra};` });
    const run = importOnce(source);
    expect(run.report.outcome.ok, JSON.stringify(run.report.outcome)).toBe(true);
    const batches = rows(run.targetPath, "SELECT network_payout_id, withheld, match, origin, matched_gross FROM network_settlements ORDER BY created_at") as { network_payout_id: string; withheld: number; match: string; origin: string; matched_gross: number | null }[];
    expect(batches.map((b) => b.network_payout_id)).toEqual(REAL.map(([id]) => id));
    expect(batches.every((b) => b.match === "HISTORIC" && b.origin === "CUTOVER" && b.matched_gross === null)).toBe(true);
    expect(batches.map((b) => b.withheld)).toEqual([0, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1]);
    expect(rows(run.targetPath, "SELECT count(*) AS n FROM network_settlement_orders")).toEqual([{ n: 0 }]);
    expect(rows(run.targetPath, "SELECT count(*) AS n FROM review_cases WHERE reason LIKE 'settlement_%'")).toEqual([{ n: 0 }]);
    expect(rows(run.targetPath, "SELECT count(*) AS n FROM orders WHERE network_batch_id IS NOT NULL AND network_batch_id IN (SELECT network_payout_id FROM network_settlements)")).toEqual([{ n: 0 }]);
    expect(rows(run.targetPath, "SELECT withheld, network_payout_id FROM network_withholding")).toEqual([{ withheld: 1, network_payout_id: "1011" }]);
    expect(run.report.networkPayouts?.imported).toBe(11);
    expect(run.report.networkPayouts?.batches.every((b) => b.match === "HISTORIC")).toBe(true);
    expect(run.report.notes.filter((n) => n.table === "payout_batches").map((n) => [n.kind, n.key])).toEqual([
      ["network_payout_unknown_platform", "BLZ1"],
      ["network_payout_unknown_status", "BODD"],
    ]);
  });
});
