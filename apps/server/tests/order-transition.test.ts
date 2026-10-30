/**
 * Story 2.6: the order transition function. The table-driven part reads the transition table of
 * docs/operations/status-flows.md itself and runs one scenario per row and source state; the
 * golden part runs packages/golden/fixtures/transition; the property part runs many generated
 * inputs and checks the rules that must hold for every one of them.
 */
import type { OrderStatus } from "@cashback/core";
import { loadTransitionFixtures } from "@cashback/golden/transition";
import { describe, expect, it } from "vitest";

import { readStatusFlows, sections } from "../../../packages/core/tests/status-flows-doc";
import { mapStatus, SHOPEE_STATUS_MAP } from "../src/modules/linking/index";
import {
  transition,
  TransitionError,
  type Observation,
  type ObservedItem,
  type ObservedStatus,
  type ReportObservation,
  type TransitionContext,
  type TransitionOrder,
} from "../src/modules/orders/index";

const SHOPEE: TransitionContext = { network: "shopee", withheld: true };
const CUSTOMER = { kind: "customer", customerId: "1000000000000000001", source: "both", guest: false, requestId: "26091200001", unmatchedRequest: null } as const;

const order = (status: OrderStatus, extra: Partial<TransitionOrder> = {}): TransitionOrder => ({
  status,
  paidAt: status === "PAID" ? "2026-10-05T03:00:00.000Z" : null,
  approvedCommission: status === "AWAITING_APPROVAL" ? null : 20000,
  cashback: status === "AWAITING_APPROVAL" ? null : 14243,
  guest: false,
  ...extra,
});
const row = (orderStatus: ObservedStatus | null, items: ObservedItem[], orderId = "260912BBBB0002"): ReportObservation => ({ orderId, orderStatus, items });
const item = (status: ObservedStatus, ...commissionParts: number[]): ObservedItem => ({ status, commissionParts });
const report = (r: ReportObservation): Observation => ({ kind: "report", row: r });

const APPROVED_ROW = row("APPROVED", [item("APPROVED", 20000)]);
const AWAITING_ROW = row("AWAITING", [item("AWAITING", 20000)]);
const CANCEL_ROW = row("CANCELLED", [item("CANCELLED", 0)]);
const UNKNOWN_ROW = row("UNKNOWN", [item("AWAITING", 20000)]);
const DROP_ROW = row("APPROVED", [item("APPROVED", 12000)]);

// ---- The transition table of status-flows.md ---------------------------------------------

const TOKEN = /\b[A-Z][A-Z_]{2,}\b/g;
const tokens = (text: string): string[] => text.match(TOKEN) ?? [];

/** Every (from, to) the table allows, "none" for a new order and PAID -> PAID for the clawback row. */
function docEdges(): string[] {
  const body = sections(readStatusFlows()).get("Order") ?? "";
  const lines = body.split("\n");
  const start = lines.findIndex((l) => l.startsWith("| From | To |"));
  const rows: { from: string; to: string }[] = [];
  for (const line of lines.slice(start + 2)) {
    if (!line.startsWith("|")) break;
    const [from = "", to = ""] = line.split("|").slice(1, -1).map((c) => c.trim());
    rows.push({ from, to });
  }
  const edges = new Set<string>();
  for (const r of rows) {
    const froms = r.from === "none" ? ["none"] : tokens(r.from);
    for (const f of froms) {
      const previous = /previous state/.test(r.to) ? rows.filter((o) => tokens(o.to).includes(f)).flatMap((o) => tokens(o.from)) : [];
      for (const t of [...previous, ...tokens(r.to)]) edges.add(`${f}->${t}`);
    }
  }
  return [...edges].sort();
}

const DOC_EDGES = docEdges();

/** One input per row of the table that must take exactly that edge. */
const SCENARIOS: Record<string, () => { order: TransitionOrder | null; observation: Observation; context: TransitionContext }> = {
  "none->AWAITING_APPROVAL": () => ({ order: null, observation: report(AWAITING_ROW), context: { ...SHOPEE, attribution: CUSTOMER } }),
  "AWAITING_APPROVAL->APPROVED": () => ({ order: order("AWAITING_APPROVAL"), observation: report(APPROVED_ROW), context: SHOPEE }),
  "AWAITING_APPROVAL->REJECTED": () => ({ order: order("AWAITING_APPROVAL"), observation: report(CANCEL_ROW), context: SHOPEE }),
  "AWAITING_APPROVAL->FROZEN": () => ({ order: order("AWAITING_APPROVAL"), observation: report(UNKNOWN_ROW), context: SHOPEE }),
  "APPROVED->FROZEN": () => ({ order: order("APPROVED"), observation: report(DROP_ROW), context: SHOPEE }),
  "FROZEN->AWAITING_APPROVAL": () => ({ order: order("FROZEN"), observation: report(AWAITING_ROW), context: { ...SHOPEE, review: { kind: "resolve_frozen", reason: "status understood", previous: "AWAITING_APPROVAL", outcome: "restore" } } }),
  "FROZEN->APPROVED": () => ({ order: order("FROZEN"), observation: report(APPROVED_ROW), context: { ...SHOPEE, review: { kind: "resolve_frozen", reason: "status understood", previous: "APPROVED", outcome: "restore" } } }),
  "FROZEN->REJECTED": () => ({ order: order("FROZEN"), observation: report(UNKNOWN_ROW), context: { ...SHOPEE, review: { kind: "resolve_frozen", reason: "fraud", previous: "APPROVED", outcome: "reject" } } }),
  "REJECTED->AWAITING_APPROVAL": () => ({ order: order("REJECTED"), observation: report(AWAITING_ROW), context: { ...SHOPEE, review: { kind: "wrong_rejection", reason: "rejected on UNPAID" } } }),
  "APPROVED->REVERSED": () => ({ order: order("APPROVED"), observation: report(CANCEL_ROW), context: SHOPEE }),
  "APPROVED->PAID": () => ({ order: order("APPROVED"), observation: { kind: "payout_confirmed" }, context: SHOPEE }),
  "PAID->PAID": () => ({ order: order("PAID"), observation: report(CANCEL_ROW), context: SHOPEE }),
  "PAID->APPROVED": () => ({ order: order("PAID"), observation: { kind: "payout_voided", latest: APPROVED_ROW }, context: SHOPEE }),
  "PAID->REVERSED": () => ({ order: order("PAID"), observation: { kind: "payout_voided", latest: CANCEL_ROW }, context: SHOPEE }),
};

describe("Story 2.6: one scenario per row of the status-flows transition table", () => {
  it("the scenarios cover exactly the edges the table lists", () => {
    expect(Object.keys(SCENARIOS).sort()).toEqual(DOC_EDGES);
  });

  for (const edge of DOC_EDGES) {
    it(`takes ${edge}`, () => {
      const [from, to] = edge.split("->") as [string, OrderStatus];
      const scenario = SCENARIOS[edge];
      if (!scenario) throw new Error(`no scenario for ${edge}`);
      const { order: o, observation, context } = scenario();
      const result = transition(o, observation, context);
      expect(result.next).toBe(to);
      if (from === to) expect(result.steps).toEqual([]);
      else expect(result.steps).toContainEqual([from === "none" ? null : from, to]);
    });
  }
});

describe("Story 2.6 golden cases", () => {
  for (const c of loadTransitionFixtures().cases) {
    it(`${c.story}: ${c.name}`, () => {
      const result = transition(c.order as TransitionOrder | null, c.observation as unknown as Observation, c.context as unknown as TransitionContext);
      expect({ next: result.next, steps: result.steps, effects: result.effects }).toEqual(c.expected);
    });
  }
});

describe("Story 2.6 acceptance criteria", () => {
  it("AC1: AWAITING_APPROVAL with order status APPROVED and commission above 0 is APPROVED with store cashback; order CANCELLED with an APPROVED item is REJECTED", () => {
    const approved = transition(order("AWAITING_APPROVAL"), report(APPROVED_ROW), SHOPEE);
    expect(approved.next).toBe("APPROVED");
    expect(approved.effects).toContainEqual({ kind: "store_cashback", approvedCommission: 20000, cashback: 14243, fee: 196, tax: 2000, withheld: true });
    expect(transition(order("AWAITING_APPROVAL"), report(row("CANCELLED", [item("APPROVED", 20000)])), SHOPEE).next).toBe("REJECTED");
  });

  it("AC2: a PAID order and any cancel signal stays PAID with a clawback and a review case (D4, D30)", () => {
    for (const cancel of [CANCEL_ROW, row("APPROVED", [item("CANCELLED", 20000)]), row("APPROVED", [item("APPROVED", 0)])]) {
      const result = transition(order("PAID"), report(cancel), SHOPEE);
      expect(result.next).toBe("PAID");
      expect(result.effects).toContainEqual({ kind: "clawback", amount: 14243, partial: false });
      expect(result.effects).toContainEqual({ kind: "open_review_case", reason: "cancel_after_payout" });
    }
  });

  it("AC2: a cancel already clawed back is not clawed back again", () => {
    const again = transition(order("PAID"), report(CANCEL_ROW), { ...SHOPEE, alreadyClawedBack: 14243 });
    expect(again.effects).toEqual([{ kind: "store_observation", applied: true }]);
  });

  it("AC3: an APPROVED order under an OPEN payout claim and a cancel keeps its state; the row is stored and applied after the claim (D39)", () => {
    const result = transition(order("APPROVED"), report(CANCEL_ROW), { ...SHOPEE, coveredByOpenClaim: true });
    expect(result).toEqual({ next: "APPROVED", steps: [], effects: [{ kind: "store_observation", applied: false, reason: "open_payout_claim" }] });
    // After the claim ends the same row reverses it.
    expect(transition(order("APPROVED"), report(CANCEL_ROW), SHOPEE).next).toBe("REVERSED");
    // A row that changes nothing is applied as usual under the claim.
    expect(transition(order("APPROVED"), report(APPROVED_ROW), { ...SHOPEE, coveredByOpenClaim: true }).effects).toEqual([{ kind: "store_observation", applied: true }]);
  });

  it("AC4: an APPROVED unpaid order whose commission drops but stays above 0 is FROZEN with a review case; a PAID one gets a partial clawback (D55)", () => {
    const approved = transition(order("APPROVED"), report(DROP_ROW), SHOPEE);
    expect(approved.next).toBe("FROZEN");
    expect(approved.effects).toContainEqual({ kind: "open_review_case", reason: "commission_drop" });
    expect(approved.effects).toContainEqual({ kind: "awards", to: "SUSPENDED" });
    const paid = transition(order("PAID"), report(DROP_ROW), SHOPEE);
    expect(paid.next).toBe("PAID");
    expect(paid.effects).toContainEqual({ kind: "clawback", amount: 5697, partial: true });
  });

  it("AC5: an unknown status or a missing order id freezes with a review case", () => {
    const unknown = transition(order("AWAITING_APPROVAL"), report(UNKNOWN_ROW), SHOPEE);
    expect(unknown.next).toBe("FROZEN");
    expect(unknown.effects).toContainEqual({ kind: "open_review_case", reason: "unknown_status" });
    const missing = transition(order("APPROVED"), report(row("APPROVED", [item("APPROVED", 20000)], " ")), SHOPEE);
    expect(missing.next).toBe("FROZEN");
    expect(missing.effects).toContainEqual({ kind: "open_review_case", reason: "missing_order_id" });
    expect(transition(null, report(row("APPROVED", [item("APPROVED", 20000)], "")), { ...SHOPEE, attribution: CUSTOMER })).toEqual({
      next: null,
      steps: [],
      effects: [{ kind: "open_review_case", reason: "missing_order_id" }],
    });
  });

  it("AC5: a transition absent from the status-flows table throws", () => {
    const attempts: [TransitionOrder, Observation][] = [
      [order("AWAITING_APPROVAL"), { kind: "payout_confirmed" }],
      [order("REVERSED"), { kind: "payout_confirmed" }],
      [order("FROZEN"), { kind: "payout_confirmed" }],
      [order("REJECTED"), { kind: "payout_confirmed" }],
    ];
    for (const [o, observation] of attempts) expect(() => transition(o, observation, SHOPEE)).toThrow(expect.objectContaining({ code: "transition_not_allowed" }));
    expect(() => transition(order("APPROVED"), { kind: "payout_voided", latest: null }, SHOPEE)).toThrow(TransitionError);
    expect(() => transition(null, { kind: "payout_confirmed" }, SHOPEE)).toThrow(TransitionError);
  });

  it("AC6: a REJECTED order goes back to AWAITING_APPROVAL only through a review case whose latest row has no cancel signal (D38)", () => {
    const review = { ...SHOPEE, review: { kind: "wrong_rejection", reason: "rejected on UNPAID" } } as const;
    expect(transition(order("REJECTED"), report(AWAITING_ROW), review).next).toBe("AWAITING_APPROVAL");
    expect(transition(order("REJECTED"), report(AWAITING_ROW), SHOPEE)).toEqual({ next: "REJECTED", steps: [], effects: [{ kind: "store_observation", applied: true }] });
    const refused = transition(order("REJECTED"), report(CANCEL_ROW), review);
    expect(refused.next).toBe("REJECTED");
    expect(refused.effects).toContainEqual({ kind: "review_refused", reason: "cancel_signal_seen" });
    expect(() => transition(order("REJECTED"), report(AWAITING_ROW), { ...SHOPEE, review: { kind: "wrong_rejection", reason: " " } })).toThrow(expect.objectContaining({ code: "reason_missing" }));
  });
});

describe("Story 2.6: the rest of the rules", () => {
  it("D38: Shopee UNPAID read through the status map keeps an order awaiting, never rejected", () => {
    const unpaid = mapStatus(SHOPEE_STATUS_MAP, "UNPAID");
    expect(unpaid).toBe("AWAITING");
    expect(transition(order("AWAITING_APPROVAL"), report(row(unpaid, [item(unpaid, 5000)])), SHOPEE).next).toBe("AWAITING_APPROVAL");
  });

  it("D30: an APPROVED order cancelled before payout is REVERSED with a review case, an owner alert and its awards voided", () => {
    expect(transition(order("APPROVED"), report(CANCEL_ROW), SHOPEE).effects).toEqual([
      { kind: "store_observation", applied: true },
      { kind: "open_review_case", reason: "cancel_after_approval" },
      { kind: "alert", alert: "order_reversed" },
      { kind: "awards", to: "VOID" },
    ]);
  });

  it("D32: payout confirm takes only an APPROVED unpaid order with commission above 0", () => {
    expect(transition(order("APPROVED"), { kind: "payout_confirmed" }, SHOPEE).effects).toEqual([{ kind: "set_paid_at" }, { kind: "awards", to: "PAID" }]);
    expect(() => transition(order("PAID"), { kind: "payout_confirmed" }, SHOPEE)).toThrow(expect.objectContaining({ code: "already_paid" }));
    expect(() => transition(order("APPROVED", { paidAt: "2026-10-05T03:00:00.000Z" }), { kind: "payout_confirmed" }, SHOPEE)).toThrow(expect.objectContaining({ code: "already_paid" }));
    expect(() => transition(order("APPROVED", { approvedCommission: 0 }), { kind: "payout_confirmed" }, SHOPEE)).toThrow(expect.objectContaining({ code: "not_payable" }));
  });

  it("D41: void returns the state the latest report row gives", () => {
    expect(transition(order("PAID"), { kind: "payout_voided", latest: CANCEL_ROW }, SHOPEE).next).toBe("REVERSED");
    expect(transition(order("PAID"), { kind: "payout_voided", latest: APPROVED_ROW }, SHOPEE).next).toBe("APPROVED");
    expect(transition(order("PAID"), { kind: "payout_voided", latest: null }, SHOPEE).next).toBe("APPROVED");
  });

  it("D55: a FROZEN order suspends its awards; leaving FROZEN resumes them, or voids them when rejected", () => {
    const restore = transition(order("FROZEN"), report(APPROVED_ROW), { ...SHOPEE, review: { kind: "resolve_frozen", reason: "ok", previous: "APPROVED", outcome: "restore" } });
    expect(restore.effects).toContainEqual({ kind: "awards", to: "RESUMED" });
    const reject = transition(order("FROZEN"), report(CANCEL_ROW), { ...SHOPEE, review: { kind: "resolve_frozen", reason: "ok", previous: "APPROVED", outcome: "restore" } });
    expect(reject.next).toBe("REJECTED");
    expect(reject.effects).toContainEqual({ kind: "awards", to: "VOID" });
  });

  it("a frozen, rejected or reversed order is not moved by a report row without a review case", () => {
    for (const status of ["FROZEN", "REJECTED", "REVERSED"] as const) {
      for (const r of [APPROVED_ROW, AWAITING_ROW, CANCEL_ROW, UNKNOWN_ROW]) expect(transition(order(status), report(r), SHOPEE).next).toBe(status);
    }
  });

  it("a first row that is already approved records the order and approves it in two steps; an unattributed one records nothing", () => {
    const first = transition(null, report(APPROVED_ROW), { ...SHOPEE, attribution: CUSTOMER });
    expect(first.steps).toEqual([
      [null, "AWAITING_APPROVAL"],
      ["AWAITING_APPROVAL", "APPROVED"],
    ]);
    expect(first.effects[0]).toEqual({ kind: "create_order", customerId: CUSTOMER.customerId, guest: false });
    const unattributed = transition(null, report(APPROVED_ROW), { ...SHOPEE, attribution: { kind: "review", reason: "unattributed", candidates: [] } });
    expect(unattributed).toEqual({ next: null, steps: [], effects: [{ kind: "open_review_case", reason: "unattributed" }] });
    expect(() => transition(null, report(APPROVED_ROW), SHOPEE)).toThrow(expect.objectContaining({ code: "attribution_missing" }));
  });

  it("a review case that does not fit the order's state throws", () => {
    expect(() => transition(order("APPROVED"), report(AWAITING_ROW), { ...SHOPEE, review: { kind: "wrong_rejection", reason: "x" } })).toThrow(expect.objectContaining({ code: "review_not_applicable" }));
  });
});

// ---- Properties over generated inputs ----------------------------------------------------

/** A small deterministic generator (mulberry32), so a failing case can be replayed by seed. */
function generator(seed: number) {
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pick = <T>(values: readonly T[]): T => values[Math.floor(next() * values.length)] as T;
  return { next, pick, int: (max: number) => Math.floor(next() * (max + 1)) };
}

const STATUSES: OrderStatus[] = ["AWAITING_APPROVAL", "FROZEN", "APPROVED", "REVERSED", "PAID", "REJECTED"];
const OBSERVED: ObservedStatus[] = ["AWAITING", "APPROVED", "CANCELLED", "UNKNOWN"];

function randomInput(g: ReturnType<typeof generator>, guest: boolean) {
  const status = g.pick(STATUSES);
  const approved = status === "AWAITING_APPROVAL" ? null : g.int(60000);
  const o: TransitionOrder = {
    status,
    paidAt: status === "PAID" ? "2026-10-05T03:00:00.000Z" : null,
    approvedCommission: approved,
    cashback: guest ? 0 : approved === null ? null : g.int(approved),
    guest,
  };
  const items = Array.from({ length: g.int(3) }, () => item(g.pick(OBSERVED), ...Array.from({ length: g.int(2) }, () => g.int(40000))));
  const r = row(g.pick([...OBSERVED, null]), items, g.next() < 0.05 ? "" : "260912BBBB0002");
  const context: TransitionContext = {
    network: g.pick(["shopee", "accesstrade"] as const),
    withheld: g.next() < 0.5,
    coveredByOpenClaim: g.next() < 0.3,
    paidBonus: guest ? 0 : g.pick([0, 20000]),
    alreadyClawedBack: g.pick([0, 0, 5000]),
  };
  return { o, r, context };
}

const allowed = new Set(DOC_EDGES);

describe("Story 2.6 properties over 20,000 generated inputs", () => {
  const g = generator(20261030);
  const cases = Array.from({ length: 20000 }, (_, i) => randomInput(g, i % 4 === 0));

  it("every step taken is an edge of the status-flows table", () => {
    for (const { o, r, context } of cases) {
      for (const [from, to] of transition(o, report(r), context).steps) expect(allowed.has(`${from ?? "none"}->${to}`)).toBe(true);
    }
  });

  it("no report row moves a PAID order out of PAID; only a payout void does (D4)", () => {
    for (const { o, r, context } of cases.filter((c) => c.o.status === "PAID")) {
      const result = transition(o, report(r), context);
      expect(result.next).toBe("PAID");
      expect(result.steps).toEqual([]);
      expect(result.effects.some((e) => e.kind === "clear_paid_at" || e.kind === "set_paid_at")).toBe(false);
      expect(() => transition(o, { kind: "payout_confirmed" }, context)).toThrow(TransitionError);
    }
  });

  it("HOUSE never gets cashback: no stored cashback above 0 and no clawback, from any input (D5)", () => {
    for (const { o, r, context } of cases.filter((c) => c.o.guest)) {
      const results = [transition(o, report(r), context), transition(null, report(r), { ...context, attribution: { ...CUSTOMER, guest: true } })];
      for (const result of results) {
        for (const effect of result.effects) {
          if (effect.kind === "store_cashback") expect(effect.cashback).toBe(0);
          expect(effect.kind).not.toBe("clawback");
        }
      }
    }
  });

  it("an approved unpaid order under an OPEN claim never changes state by a report row (D39)", () => {
    for (const { o, r, context } of cases.filter((c) => c.o.status === "APPROVED" && c.context.coveredByOpenClaim === true)) {
      expect(transition(o, report(r), context).next).toBe("APPROVED");
    }
  });

  it("every clawback amount is a whole dong above 0", () => {
    for (const { o, r, context } of cases) {
      for (const effect of transition(o, report(r), context).effects) {
        if (effect.kind === "clawback") expect(Number.isSafeInteger(effect.amount) && effect.amount > 0).toBe(true);
      }
    }
  });
});
