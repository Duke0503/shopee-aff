/**
 * Story 3.6: a cancel after payout keeps the order PAID and opens a clawback, a series of
 * insert-only ledger entries whose open amount is their sum (D30, D35, D42, D55), told to the
 * customer once with the status-flows.md §2 sentence.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { CLAWBACK_MESSAGE_KEYS, clawbackOpen } from "../src/modules/payouts/index";
import { REPOSITORY_ROOT } from "../src/platform/config/env.config";
import type { Ledger } from "../src/platform/db/ledger";
import { TEST_CLOCK } from "./helpers/live-fixture";
import { apply, approved, cancelled, closeLedgers, freshLedger, HOUR, movingClock, reportRow } from "./helpers/order-ledger";

afterEach(closeLedgers);

const all = (ledger: Ledger, sql: string, ...args: unknown[]) => ledger.sqlite.prepare(sql).all(...args) as Record<string, unknown>[];
const count = (ledger: Ledger, sql: string) => (ledger.sqlite.prepare(`SELECT count(*) AS n FROM ${sql}`).get() as { n: number }).n;

function paidOrder(ledger: Ledger, id: string, o: { approved: number; cashback: number; bonus?: number; customer?: string }): void {
  ledger.sqlite
    .prepare(
      "INSERT INTO orders (order_id, network, platform, customer_id, status, approved_commission, cashback, approved_at, paid_at, origin) VALUES (?, 'shopee', 'shopee', ?, 'PAID', ?, ?, '2026-09-10T03:00:00.000Z', '2026-10-05T03:00:00.000Z', 'CUTOVER')",
    )
    .run(id, o.customer ?? "C1", o.approved, o.cashback);
  if (o.bonus !== undefined) {
    ledger.sqlite.prepare("INSERT INTO campaign_awards (campaign_id, customer_id, order_id, amount, status, origin) VALUES ('CAMP1', ?, ?, ?, 'PAID', 'RULE')").run(o.customer ?? "C1", id, o.bonus);
  }
}

const messages = JSON.parse(readFileSync(join(REPOSITORY_ROOT, "packages/labels/vi/messages.json"), "utf8")) as Record<string, string>;

describe("Story 3.6 acceptance criteria", () => {
  it("AC1 (golden): a PAID order with cashback 79,216 and a paid bonus of 20,000 opens one clawback at -99,216 and stays PAID", () => {
    const ledger = freshLedger();
    paidOrder(ledger, "260910CLAW0001", { approved: 100000, cashback: 79216, bonus: 20000 });
    apply(ledger, cancelled("260910CLAW0001"));
    expect(all(ledger, "SELECT status, cashback, paid_at FROM orders")).toEqual([{ status: "PAID", cashback: 79216, paid_at: "2026-10-05T03:00:00.000Z" }]);
    expect(all(ledger, "SELECT clawback_id, customer_id, kind, amount, reason FROM ledger_entries")).toEqual([
      {
        clawback_id: "260910CLAW0001-1",
        customer_id: "C1",
        kind: "CLAWBACK",
        amount: -99216,
        reason: "cancel_after_payout",
      },
    ]);
    expect(all(ledger, "SELECT status FROM campaign_awards")).toEqual([{ status: "PAID" }]);
  });

  it("AC2: the same cancel observed again, in the same or a different row, adds no entry and tells nobody again", () => {
    const ledger = freshLedger();
    paidOrder(ledger, "260910CLAW0002", { approved: 100000, cashback: 79216, bonus: 20000 });
    const clock = movingClock("2026-10-30T07:00:00.000Z");
    apply(ledger, cancelled("260910CLAW0002"), clock);
    clock.advance(HOUR);
    apply(ledger, cancelled("260910CLAW0002"), clock);
    clock.advance(HOUR);
    apply(ledger, reportRow("260910CLAW0002", "AWAITING", [{ status: "CANCELLED", parts: [0], value: 1 }]), clock);
    expect(all(ledger, "SELECT amount FROM ledger_entries")).toEqual([{ amount: -99216 }]);
    expect(all(ledger, "SELECT dedup_key FROM outbox")).toEqual([{ dedup_key: "clawback:260910CLAW0002-1:opened" }]);
    expect(all(ledger, "SELECT reason FROM review_cases")).toEqual([{ reason: "cancel_after_payout" }]);
  });

  it("AC3 (golden): an approved commission dropping from 100,000 to 60,000 on a PAID order claws back the cashback difference", () => {
    const ledger = freshLedger();
    // Withheld: 100,000 gives 71,216 and 60,000 gives 42,730 (packages/money).
    paidOrder(ledger, "260910CLAW0003", { approved: 100000, cashback: 71216 });
    apply(ledger, approved("260910CLAW0003", [60000]));
    expect(all(ledger, "SELECT clawback_id, amount, reason FROM ledger_entries")).toEqual([{ clawback_id: "260910CLAW0003-1", amount: -28486, reason: "commission_drop_after_payout" }]);
    expect(all(ledger, "SELECT message_key FROM outbox")).toEqual([{ message_key: CLAWBACK_MESSAGE_KEYS.partial }]);
    // A later cancel takes the rest: stored 71,216 less the 28,486 already taken.
    apply(ledger, cancelled("260910CLAW0003"));
    expect(all(ledger, "SELECT clawback_id, amount FROM ledger_entries ORDER BY entry_id")).toEqual([
      { clawback_id: "260910CLAW0003-1", amount: -28486 },
      { clawback_id: "260910CLAW0003-2", amount: -42730 },
    ]);
  });

  it("AC4: a clawback with entries -99,216 and +50,000 is open at -49,216, the sum of its entries", () => {
    const ledger = freshLedger();
    paidOrder(ledger, "260910CLAW0004", { approved: 100000, cashback: 79216, bonus: 20000 });
    apply(ledger, cancelled("260910CLAW0004"));
    ledger.sqlite
      .prepare("INSERT INTO ledger_entries (customer_id, clawback_id, kind, amount, order_id, created_at, created_by) VALUES ('C1', '260910CLAW0004-1', 'NETTING', 50000, '260910CLAW0004', ?, 'test')")
      .run(TEST_CLOCK.now());
    expect(ledger.tx((db) => clawbackOpen(db, "260910CLAW0004-1"))).toBe(-49216);
    expect(() => ledger.sqlite.exec("UPDATE ledger_entries SET amount = -1")).toThrow(/insert_only/);
  });

  it("AC5: the outbox row is keyed clawback:<id>:opened, with the status-flows §2 sentence, the order and the amount in dong", () => {
    const ledger = freshLedger();
    paidOrder(ledger, "260910CLAW0005", { approved: 13000, cashback: 9263 });
    apply(ledger, cancelled("260910CLAW0005"));
    expect(all(ledger, "SELECT dedup_key, customer_id, message_key, params FROM outbox")).toEqual([
      {
        dedup_key: "clawback:260910CLAW0005-1:opened",
        customer_id: "C1",
        message_key: "clawback_opened",
        params: JSON.stringify({
          clawbackId: "260910CLAW0005-1",
          orderId: "260910CLAW0005",
          amount: 9263,
        }),
      },
    ]);
    const flows = readFileSync(join(REPOSITORY_ROOT, "docs/operations/status-flows.md"), "utf8").replace(/\s+/g, " ");
    // The doc's example names order X and an amount in dong ("9.263" and the dong sign).
    const [before = "", after = ""] = (messages["clawback_opened"] ?? "").replace("{orderId}", "X").split("{amount}");
    const start = flows.indexOf(`"${before}`);
    expect(start).toBeGreaterThan(-1);
    const amountAndRest = flows.slice(start + before.length + 1);
    expect(amountAndRest).toMatch(/^[0-9.]+\S/u);
    expect(amountAndRest.replace(/^[0-9.]+\S/u, "").startsWith(`${after}"`)).toBe(true);
  });
});

describe("Story 3.6: clawback messages and guards", () => {
  it("every clawback message key resolves, names the order and the amount, and promises no date", () => {
    for (const key of Object.values(CLAWBACK_MESSAGE_KEYS)) {
      const text = messages[key] ?? "";
      expect(text).toContain("{orderId}");
      expect(text).toContain("{amount}");
      // No exclamation mark and no figure but the amount: no date or time is promised (D11).
      expect(text).not.toMatch(/[!0-9]/u);
    }
  });

  it("a guest order (HOUSE) is never clawed back and never told", () => {
    const ledger = freshLedger();
    paidOrder(ledger, "260910CLAWHOUS", { approved: 100000, cashback: 0, customer: "HOUSE" });
    apply(ledger, cancelled("260910CLAWHOUS"));
    expect(count(ledger, "ledger_entries")).toBe(0);
    expect(count(ledger, "outbox")).toBe(0);
  });

  it("the entry, its audit and its outbox row roll back together", () => {
    const ledger = freshLedger();
    paidOrder(ledger, "260910CLAWROLL", { approved: 100000, cashback: 79216 });
    const failing = () =>
      apply(ledger, cancelled("260910CLAWROLL"), TEST_CLOCK, (deps) => ({
        payouts: {
          ...deps.payouts,
          openClawback: (r) => {
            throw new Error(`fail after ${deps.payouts.openClawback(r)}`);
          },
        },
      }));
    expect(failing).toThrow(/fail after/);
    expect(count(ledger, "ledger_entries")).toBe(0);
    expect(count(ledger, "outbox")).toBe(0);
    expect(count(ledger, "audit_entries WHERE event = 'payouts.clawback.opened'")).toBe(0);
  });
});
