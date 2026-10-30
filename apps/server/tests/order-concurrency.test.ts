/**
 * Stories 3.3 and 2.6 with AD-2, AD-7, AD-9 and R2: a report apply and a payout confirm on the same
 * order cannot both win. Each runs in its own `BEGIN IMMEDIATE` transaction on its own connection
 * to one ledger file, so while one holds the write lock the other cannot start (it fails busy and
 * is retried by its caller), and whichever runs second re-reads the order the first one left: a
 * confirm after a cancel is refused, and a cancel after a confirm becomes a clawback, never a
 * reversal of a paid order.
 */
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { orderAwardsFor } from "../src/modules/campaigns/index";
import { outboxFor } from "../src/modules/messaging/index";
import { commandAudit } from "../src/modules/operations/index";
import { markOrderPaid, OrderPayoutError, TransitionError, type OrderAwardsPort } from "../src/modules/orders/index";
import { LedgerBusyError } from "../src/platform/db/transaction";
import { openLedger, type Ledger, type LedgerDb } from "../src/platform/db/ledger";
import { TEST_ACTOR, TEST_CLOCK, tempDir } from "./helpers/live-fixture";
import { apply, approved, cancelled, closeLedgers, freshLedger } from "./helpers/order-ledger";

const ORDER = "261020RACE0001";
const others: Ledger[] = [];
afterEach(() => {
  for (const ledger of others.splice(0)) ledger.close();
  closeLedgers();
});

/** Two connections to one ledger, with ORDER approved for C1. */
function twoConnections(): [Ledger, Ledger] {
  const path = join(tempDir("cashback-race-"), "ledger.sqlite");
  const first = freshLedger(path);
  apply(first, approved(ORDER));
  const second = openLedger(path);
  others.push(second);
  return [first, second];
}

/** The orders side of a payout confirm; `during` runs inside its transaction, after the awards move. */
function confirm(ledger: Ledger, during?: () => void) {
  return ledger.tx((db: LedgerDb) => {
    const by = commandAudit(db, TEST_CLOCK, TEST_ACTOR);
    const awards = orderAwardsFor(db, TEST_CLOCK, by);
    const watched: OrderAwardsPort = { ...awards, move: (orderId, to) => (awards.move(orderId, to), during?.()) };
    return markOrderPaid(db, { orderId: ORDER, customerId: "C1" }, { clock: TEST_CLOCK, by, outbox: outboxFor(db, TEST_CLOCK, by), awards: watched });
  });
}

const status = (ledger: Ledger) => ledger.sqlite.prepare("SELECT status, paid_at FROM orders WHERE order_id = ?").get(ORDER);
const entries = (ledger: Ledger) => ledger.sqlite.prepare("SELECT kind, amount FROM ledger_entries").all();

/** Runs `fn` and returns what it threw. */
function thrown(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error("expected a throw");
}

describe("a report apply and a payout confirm on the same order (AD-2, AD-7, R2)", () => {
  it("a confirm tried while a cancel is being applied cannot start; run after it, it is refused and the order stays REVERSED", () => {
    const [reconcile, staff] = twoConnections();
    let during: unknown = null;
    apply(reconcile, cancelled(ORDER), TEST_CLOCK, (deps) => ({
      awards: { ...deps.awards, move: (orderId, to) => (deps.awards.move(orderId, to), (during = thrown(() => confirm(staff)))) },
    }));
    expect(during).toBeInstanceOf(LedgerBusyError);
    const after = thrown(() => confirm(staff));
    expect(after).toBeInstanceOf(TransitionError);
    expect(status(staff)).toEqual({ status: "REVERSED", paid_at: null });
    expect(entries(staff)).toEqual([]);
    expect(staff.sqlite.prepare("SELECT count(*) AS n FROM order_status_history WHERE to_status = 'PAID'").get()).toEqual({ n: 0 });
  }, 15_000);

  it("a cancel tried while a confirm is being written cannot start; run after it, the order stays PAID and the cancel is a clawback", () => {
    const [staff, reconcile] = twoConnections();
    let during: unknown = null;
    confirm(staff, () => (during = thrown(() => apply(reconcile, cancelled(ORDER)))));
    expect(during).toBeInstanceOf(LedgerBusyError);
    expect(apply(reconcile, cancelled(ORDER)).reviewCases).toEqual(["cancel_after_payout"]);
    expect(status(reconcile)).toEqual({ status: "PAID", paid_at: TEST_CLOCK.now() });
    expect(entries(reconcile)).toEqual([{ kind: "CLAWBACK", amount: -14243 }]);
  }, 15_000);

  it("a confirm never pays an order twice, nor another customer's order (D4, R2)", () => {
    const [staff] = twoConnections();
    confirm(staff);
    expect(thrown(() => confirm(staff))).toMatchObject({ code: "already_paid" });
    apply(staff, approved("261020RACE0002", [20000], { subIds: ["C2", "", "", "", ""] }));
    const other = thrown(() =>
      staff.tx((db) => {
        const by = commandAudit(db, TEST_CLOCK, TEST_ACTOR);
        return markOrderPaid(db, { orderId: "261020RACE0002", customerId: "C1" }, { clock: TEST_CLOCK, by, outbox: outboxFor(db, TEST_CLOCK, by), awards: orderAwardsFor(db, TEST_CLOCK, by) });
      }),
    );
    expect(other).toBeInstanceOf(OrderPayoutError);
    expect(staff.sqlite.prepare("SELECT status FROM orders WHERE order_id = '261020RACE0002'").get()).toEqual({ status: "APPROVED" });
  });
});
