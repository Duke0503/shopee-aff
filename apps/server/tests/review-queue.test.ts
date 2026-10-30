/**
 * Story 4.15: the review queue and one case's panel on the admin desk (FR-14, UJ-6, FR-37, AD-7,
 * AD-12, D38, D58, D59), over the Story 3.9 commands and their server preview. The screen side
 * (the drawer on phone, the empty text, the refreshes after apply) is in
 * apps/admin/tests/review.test.tsx.
 */
import { readFileSync } from "node:fs";

import {
  DISMISS_ONLY_REASONS,
  REVIEW_CASE_REASONS,
  adminOrdersResponseSchema,
  reviewCaseDetailSchema,
  reviewCaseListSchema,
  reviewPreviewResponseSchema,
  type ReviewCaseReasonName,
} from "@cashback/contracts";
import { afterEach, describe, expect, expectTypeOf, it } from "vitest";

import {
  REVIEW_CASES_LIST,
  SETTLEMENT_CASE_REASONS,
  type CaseReason,
  type ReviewCaseErrorCode,
} from "../src/modules/orders/index";
import type { Ledger } from "../src/platform/db/ledger";
import { close, type Servers } from "../src/platform/http/servers";
import { deskGet, deskPost, errorOf, staffCookie } from "./helpers/desk-http";
import { apply, approved, awaiting, closeLedgers } from "./helpers/order-ledger";
import { CLOCK, payoutLedger } from "./helpers/payout-ledger";
import { deskServers } from "./helpers/staff-desk";

const ERRORS = JSON.parse(
  readFileSync(new URL("../../../packages/labels/vi/errors.json", import.meta.url), "utf8"),
) as Record<string, string>;

let servers: Servers | undefined;
afterEach(async () => {
  if (servers) await close(servers);
  servers = undefined;
  closeLedgers();
});

function desk(ledger: Ledger) {
  servers ??= deskServers(ledger, CLOCK);
  const s = servers;
  const cookie = staffCookie(ledger, "tuan", CLOCK);
  return {
    get: (url: string) => deskGet(s, url, cookie, CLOCK),
    post: (url: string, body: unknown) => deskPost(s, url, cookie, body, CLOCK),
  };
}

async function queue(ledger: Ledger, query = "?filter[status]=OPEN") {
  const res = await desk(ledger).get(`/api/admin/review-cases${query}`);
  expect(res.statusCode, res.body).toBe(200);
  return reviewCaseListSchema.parse(res.json());
}

async function detail(ledger: Ledger, caseId: number) {
  const res = await desk(ledger).get(`/api/admin/review-cases/${caseId}`);
  expect(res.statusCode, res.body).toBe(200);
  return reviewCaseDetailSchema.parse(res.json());
}

function addCase(
  ledger: Ledger,
  c: {
    subject: string;
    reason: string;
    at: string;
    orderId?: string | null;
    observation?: object;
    candidates?: string[];
    status?: "OPEN" | "RESOLVED";
  },
): number {
  const row = ledger.sqlite
    .prepare(
      "INSERT INTO review_cases (network, subject, order_id, reason, status, resolution, candidates, observation, opened_at, opened_by, resolved_at, resolved_by, resolution_reason) VALUES ('shopee', ?, ?, ?, ?, ?, ?, ?, ?, 'reconcile', ?, ?, ?) RETURNING case_id",
    )
    .get(
      c.subject,
      c.orderId ?? null,
      c.reason,
      c.status ?? "OPEN",
      c.status === "RESOLVED" ? "DISMISSED" : null,
      JSON.stringify(c.candidates ?? []),
      JSON.stringify(c.observation ?? {}),
      c.at,
      ...(c.status === "RESOLVED" ? [c.at, "minh", "checked"] : [null, null, null]),
    ) as { case_id: number };
  return row.case_id;
}

/** The D58 case of UJ-6: sub_id1 names nobody, the sub_id2 request belongs to C1, who is the one candidate. */
function unresolvedSubId1(ledger: Ledger): number {
  apply(ledger, awaiting("261027F3HQ", [8210], { subIds: ["C0042", "REQ1", "", "", ""] }), CLOCK);
  return (
    ledger.sqlite
      .prepare("SELECT case_id FROM review_cases WHERE reason = 'unattributed_sub_id1'")
      .get() as { case_id: number }
  ).case_id;
}

describe("Story 4.15 acceptance criteria", () => {
  it("AC1: the chips count each reason over the same filtered set, the tabs carry their own totals, and rows are oldest first", async () => {
    const ledger = payoutLedger();
    const late = addCase(ledger, {
      subject: "261030LATE01",
      reason: "unknown_status",
      at: "2026-10-30T09:00:00.000Z",
    });
    const early = addCase(ledger, {
      subject: "261028EARLY1",
      reason: "unattributed",
      at: "2026-10-28T09:00:00.000Z",
    });
    const middle = addCase(ledger, {
      subject: "261029MID001",
      reason: "unknown_status",
      at: "2026-10-29T09:00:00.000Z",
    });
    addCase(ledger, {
      subject: "261020DONE01",
      reason: "unattributed",
      at: "2026-10-20T09:00:00.000Z",
      status: "RESOLVED",
    });
    const open = await queue(ledger);
    expect(open.rows.map((r) => r.caseId)).toEqual([early, middle, late]);
    expect(open.facets["reason"]).toEqual([
      { value: "unattributed", count: 1 },
      { value: "unknown_status", count: 2 },
    ]);
    expect(open.counts).toEqual({ open: 3, resolved: 1 });
    const filtered = await queue(ledger, "?filter[status]=OPEN&filter[reason]=unknown_status");
    expect([filtered.total, filtered.rows.map((r) => r.caseId)]).toEqual([2, [middle, late]]);
    expect(
      (await queue(ledger, "?filter[status]=OPEN&q=261029mid")).rows.map((r) => r.caseId),
    ).toEqual([middle]);
    expect(REVIEW_CASES_LIST.defaultSort).toEqual({ field: "openedAt", direction: "asc" });
  });

  it("AC2: the panel's report row is a read-only list of facts with the rule's candidate and recent orders; no field takes an amount or another customer", async () => {
    const ledger = payoutLedger();
    apply(ledger, approved("261020C1OLD1", [20000], { subIds: ["C1", "REQ1", "", "", ""] }), CLOCK);
    const caseId = unresolvedSubId1(ledger);
    const shown = await detail(ledger, caseId);
    expect(shown).toMatchObject({
      reason: "unattributed_sub_id1",
      status: "OPEN",
      applicable: true,
      frozen: false,
      order: null,
    });
    const facts = Object.fromEntries(shown.facts.map((f) => [f.key, [f.kind, f.value]]));
    expect(facts).toMatchObject({
      orderId: ["code", "261027F3HQ"],
      subId1: ["code", "C0042"],
      subId2: ["code", "REQ1"],
      reportedCommission: ["money", 8210],
      orderValue: ["money", 100000],
      networkStatus: ["orderStatus", "AWAITING_APPROVAL"],
    });
    expect(shown.candidates).toEqual([
      expect.objectContaining({
        customerId: "C1",
        customerCode: "DP00001",
        recentOrders: [expect.objectContaining({ orderId: "261020C1OLD1", status: "APPROVED" })],
      }),
    ]);
    const another = await desk(ledger).post(`/api/admin/review-cases/${caseId}/preview`, {
      reason: "link belongs to DP00002",
      customerId: "C2",
    });
    expect([another.statusCode, errorOf(another.body).messageKey]).toEqual([
      409,
      "error.review_case.not_a_candidate",
    ]);
    const amount = await desk(ledger).post(`/api/admin/review-cases/${caseId}/apply`, {
      reason: "x",
      amount: 1,
    });
    expect(amount.statusCode).toBe(400);
  });

  it("AC3: the preview names the resulting owner and state; after apply the case leaves the open list and counts, and the order is on the customer's orders", async () => {
    const ledger = payoutLedger();
    const caseId = unresolvedSubId1(ledger);
    const preview = await desk(ledger).post(`/api/admin/review-cases/${caseId}/preview`, {
      reason: "Link REQ1 is DP00001's",
    });
    expect(reviewPreviewResponseSchema.parse(preview.json())).toMatchObject({
      orderId: "261027F3HQ",
      customerId: "C1",
      customerCode: "DP00001",
      from: null,
      to: "AWAITING_APPROVAL",
    });
    expect((await queue(ledger)).counts.open).toBe(1);
    const applied = await desk(ledger).post(`/api/admin/review-cases/${caseId}/apply`, {
      reason: "Link REQ1 is DP00001's",
    });
    expect(applied.statusCode, applied.body).toBe(200);
    const after = await queue(ledger);
    expect([after.total, after.counts]).toEqual([0, { open: 0, resolved: 1 }]);
    const orders = adminOrdersResponseSchema.parse(
      (await desk(ledger).get("/api/admin/customers/DP00001/orders")).json(),
    );
    expect(orders.rows.map((r) => [r.orderId, r.status])).toContainEqual([
      "261027F3HQ",
      "AWAITING_APPROVAL",
    ]);
  });

  it("AC4: an apply the server refuses (a paid order) answers with a label-file reason and the case stays open; a network payout case offers dismiss only", async () => {
    const ledger = payoutLedger();
    apply(ledger, approved("261021PAID01", [20000], { subIds: ["C1", "REQ1", "", "", ""] }), CLOCK);
    ledger.sqlite
      .prepare(
        "UPDATE orders SET status = 'PAID', paid_at = '2026-10-25T03:00:00.000Z' WHERE order_id = '261021PAID01'",
      )
      .run();
    const observation = (
      ledger.sqlite
        .prepare("SELECT observation FROM order_observations WHERE order_id = '261021PAID01'")
        .get() as { observation: string }
    ).observation;
    const caseId = addCase(ledger, {
      subject: "261021PAID01",
      orderId: "261021PAID01",
      reason: "wrong_rejection",
      at: "2026-10-29T09:00:00.000Z",
      observation: JSON.parse(observation) as object,
      candidates: ["C1"],
    });
    const refused = await desk(ledger).post(`/api/admin/review-cases/${caseId}/apply`, {
      reason: "checked",
    });
    expect([refused.statusCode, errorOf(refused.body).messageKey]).toEqual([
      409,
      "error.review_case.order_paid",
    ]);
    expect(ERRORS["error.review_case.order_paid"]).toBeTruthy();
    expect((await queue(ledger)).rows.map((r) => r.caseId)).toEqual([caseId]);
    expect((await detail(ledger, caseId)).order).toEqual({
      status: "PAID",
      customerCode: "DP00001",
      cashback: expect.any(Number),
    });

    const payout = addCase(ledger, {
      subject: "payout:1033120",
      reason: "settlement_mismatch",
      at: "2026-10-29T10:00:00.000Z",
      observation: {
        networkPayoutId: "1033120",
        amount: 89020,
        eligible: 100000,
        withheld: true,
        matchedGross: 106000,
      },
    });
    const facts = await detail(ledger, payout);
    expect(facts.applicable).toBe(false);
    expect(facts.facts).toEqual([
      { key: "networkPayoutId", kind: "code", value: "1033120", detail: null },
      { key: "amount", kind: "money", value: 89020, detail: null },
      { key: "eligible", kind: "money", value: 100000, detail: null },
      { key: "withheld", kind: "flag", value: true, detail: null },
      { key: "matchedGross", kind: "money", value: 106000, detail: null },
    ]);
    const dismissed = await desk(ledger).post(`/api/admin/review-cases/${payout}/dismiss`, {
      reason: "checked against Shopee",
    });
    expect(dismissed.statusCode).toBe(200);
  });

  it("AC5: an empty queue answers no rows and zero counts; an unknown case is not found", async () => {
    const ledger = payoutLedger();
    const empty = await queue(ledger);
    expect([empty.total, empty.rows, empty.counts]).toEqual([0, [], { open: 0, resolved: 0 }]);
    const missing = await desk(ledger).get("/api/admin/review-cases/999");
    expect([missing.statusCode, errorOf(missing.body).messageKey]).toEqual([
      404,
      "error.review_case.case_not_found",
    ]);
  });
});

/** A stored report row as reconciliation writes it, for a case added by hand. */
const rowJson = (orderId: string, subIds: string[]) => ({
  network: "shopee",
  orderId,
  rawOrderStatus: "UNPAID",
  orderStatus: "AWAITING",
  items: [
    {
      itemId: "I1",
      rawStatus: "UNPAID",
      status: "AWAITING",
      commissionParts: [8210],
      value: 100000,
    },
  ],
  subIds,
  problems: [],
  purchasedAt: "2026-10-26T13:20:00.000Z",
});

describe("Story 4.15 review fixes", () => {
  it("the guest account is never a candidate and an apply to it is refused (D5)", async () => {
    const ledger = payoutLedger();
    const caseId = addCase(ledger, {
      subject: "261027GUEST1",
      reason: "unattributed_sub_id1",
      at: "2026-10-29T09:00:00.000Z",
      observation: rowJson("261027GUEST1", ["NOBODY", "REQH", "", "", ""]),
      candidates: ["HOUSE"],
    });
    expect((await detail(ledger, caseId)).candidates).toEqual([]);
    const refused = await desk(ledger).post(`/api/admin/review-cases/${caseId}/apply`, {
      reason: "guest link",
      customerId: "HOUSE",
    });
    expect([refused.statusCode, errorOf(refused.body).messageKey]).toEqual([
      409,
      "error.review_case.guest_order",
    ]);
    expect(
      ledger.sqlite
        .prepare("SELECT COUNT(*) AS n FROM orders WHERE order_id = '261027GUEST1'")
        .get(),
    ).toEqual({ n: 0 });
  });

  it("a case with damaged stored JSON still opens, shows what can be read, refuses apply with a reason, and can be dismissed", async () => {
    const ledger = payoutLedger();
    const caseId = addCase(ledger, {
      subject: "261027BROKEN",
      reason: "unattributed",
      at: "2026-10-29T09:00:00.000Z",
    });
    ledger.sqlite
      .prepare(
        "UPDATE review_cases SET observation = '{not json', candidates = 'nope' WHERE case_id = ?",
      )
      .run(caseId);
    expect(await detail(ledger, caseId)).toMatchObject({
      facts: [],
      candidates: [],
      applicable: true,
    });
    const applied = await desk(ledger).post(`/api/admin/review-cases/${caseId}/apply`, {
      reason: "try",
    });
    expect([applied.statusCode, errorOf(applied.body).messageKey]).toEqual([
      409,
      "error.review_case.no_observation",
    ]);
    const dismissed = await desk(ledger).post(`/api/admin/review-cases/${caseId}/dismiss`, {
      reason: "unreadable row",
    });
    expect(dismissed.statusCode, dismissed.body).toBe(200);
  });

  it("the report row's status is given in the order words, the network's own word kept as a detail", async () => {
    const ledger = payoutLedger();
    const caseId = addCase(ledger, {
      subject: "261027STAT01",
      reason: "unattributed",
      at: "2026-10-29T09:00:00.000Z",
      observation: rowJson("261027STAT01", ["", "", "", "", ""]),
    });
    const facts = (await detail(ledger, caseId)).facts;
    expect(facts.find((f) => f.key === "networkStatus")).toEqual({
      key: "networkStatus",
      kind: "orderStatus",
      value: "AWAITING_APPROVAL",
      detail: "UNPAID",
    });
    expect(facts.map((f) => f.key)).not.toContain("rawOrderStatus");
  });
});

describe("Story 4.15 shared definitions", () => {
  it("every reason the server opens a case with is one the screen names, and the dismiss-only reasons are the settlement ones", () => {
    expectTypeOf<CaseReason>().toEqualTypeOf<ReviewCaseReasonName>();
    expect([...SETTLEMENT_CASE_REASONS].sort()).toEqual([...DISMISS_ONLY_REASONS].sort());
    expect(new Set(REVIEW_CASE_REASONS).size).toBe(REVIEW_CASE_REASONS.length);
  });

  it("every refusal of a review command has its sentence in the label file", () => {
    const codes: Record<ReviewCaseErrorCode, true> = {
      staff_only: true,
      reason_missing: true,
      case_not_found: true,
      case_resolved: true,
      order_paid: true,
      guest_order: true,
      candidate_required: true,
      not_a_candidate: true,
      cancel_signal_seen: true,
      no_observation: true,
      evidence_changed: true,
      review_not_applicable: true,
    };
    for (const code of Object.keys(codes))
      expect(ERRORS[`error.review_case.${code}`], code).toBeTruthy();
  });
});
