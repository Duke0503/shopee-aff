/**
 * The Telegram order notices of the DP Business group (D62): one row per order, event and lifecycle
 * written in the step's own transaction, sent outside any transaction in the live system's wording,
 * and the `order_frozen` owner alert. Covers the I/O matrix of
 * _bmad-output/implementation-artifacts/spec-orders-telegram-business-alerts.md.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import LABELS from "@cashback/labels/vi/order-notices.json" with { type: "json" };
import { estimatedCashback } from "@cashback/money";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ownerJobs } from "../src/health/owner-jobs";
import { outboxFor } from "../src/modules/messaging/index";
import { assistantHeartbeats, commandAudit, telegramText } from "../src/modules/operations/index";
import { applyReviewCase, deliverBusinessNotices, NOTICE_EXPIRY_MS, NOTICES_PER_RUN, reportWrongRejection, type BusinessNoticeSender } from "../src/modules/orders/index";
import type { RejectionReason } from "../src/modules/orders/domain/transition";
import { recordSteps } from "../src/modules/orders/order-steps.command";
import { voidPayout } from "../src/modules/payouts/index";
import { parseConfig, REPOSITORY_ROOT } from "../src/platform/config/env.config";
import { isolationProblems, productionIdentifiers, type IsolationContext } from "../src/platform/config/isolation.config";
import type { Ledger, LedgerDb } from "../src/platform/db/ledger";
import type { Actor } from "../src/platform/ports/audit.port";
import { applyDepsFor } from "../src/reconcile/apply-deps";
import { memoryLogger } from "./helpers/link-ledger";
import { buildLiveCopy, CLEAN_LIVE_SQL, importOnce, rows } from "./helpers/live-fixture";
import { apply, approved, awaiting, cancelled, closeLedgers, freshLedger, HOUR, movingClock, reportRow } from "./helpers/order-ledger";
import { addBank, addOrder, CLOCK, confirmClaim, MINH, openClaim, payoutLedger } from "./helpers/payout-ledger";

afterEach(() => {
  closeLedgers();
  vi.unstubAllGlobals();
});

const START = "2026-10-30T07:00:00.000Z";
const STAFF: Actor = { kind: "staff", id: "staff-anh", role: "EMPLOYEE" };
const OLD = JSON.parse(readFileSync(join(import.meta.dirname, "fixtures", "old-telegram-order-notices.json"), "utf8")) as { texts: Record<string, string> };
const GUEST_ROW = { subIds: ["HOUSE", "REQH", "", "", ""] };

interface NoticeRow {
  id: number;
  dedup_key: string;
  order_id: string;
  event: string;
  delivery: string;
  attempts: number;
}
const noticeRows = (ledger: Ledger) => ledger.sqlite.prepare("SELECT id, dedup_key, order_id, event, delivery, attempts FROM order_business_notices ORDER BY id").all() as NoticeRow[];
const noticeKeys = (ledger: Ledger) => noticeRows(ledger).map((n) => n.dedup_key);

function recordingSender(): BusinessNoticeSender & { texts: string[] } {
  const texts: string[] = [];
  return { texts, send: async (text) => void texts.push(text) };
}

const deliver = (ledger: Pick<Ledger, "tx">, sender: BusinessNoticeSender, clock = movingClock(START), logger = memoryLogger().logger) => deliverBusinessNotices(ledger, sender, clock, logger);

const named = (ledger: Ledger, id: string, name: string) => ledger.sqlite.prepare("UPDATE customers SET display_name = ? WHERE customer_id = ?").run(name, id);
const staffTx = <T>(ledger: Ledger, clock: ReturnType<typeof movingClock>, fn: (db: LedgerDb, deps: ReturnType<typeof applyDepsFor>) => T): T => ledger.tx((db) => fn(db, applyDepsFor(db, clock, { production: true, actor: STAFF })));
const openCase = (ledger: Ledger, reason: string) => (ledger.sqlite.prepare("SELECT case_id FROM review_cases WHERE reason = ? AND status = 'OPEN'").get(reason) as { case_id: number }).case_id;
const claimed = <T extends { kind: string }>(outcome: T) => {
  if (outcome.kind !== "claimed") throw new Error(`expected a claim, got ${outcome.kind}`);
  return outcome as Extract<T, { kind: "claimed" }>;
};

function rawOrder(ledger: Ledger, o: { id: string; platform: string; status: string; customer: string | null; value?: number | null; estimate?: number | null; approved?: number | null; cashback?: number | null; reason?: string | null; recordedAt?: string | null }): void {
  ledger.sqlite
    .prepare("INSERT INTO orders (order_id, network, platform, customer_id, status, order_value, estimated_commission, approved_commission, cashback, rejection_reason, recorded_at, paid_at, origin) VALUES (?, 'shopee', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'REPORT')")
    .run(o.id, o.platform, o.customer, o.status, o.value ?? null, o.estimate ?? null, o.approved ?? null, o.cashback ?? null, o.reason ?? null, o.recordedAt === undefined ? "2026-10-20T03:00:00.000Z" : o.recordedAt, o.status === "PAID" ? START : null);
}
const rawNotice = (ledger: Ledger, orderId: string, event: string, raisedAt = START) => ledger.sqlite.prepare("INSERT INTO order_business_notices (dedup_key, order_id, event, raised_at) VALUES (?, ?, ?, ?)").run(`order:${orderId}:${event}`, orderId, event, raisedAt);

describe("the words: the live system's format", () => {
  it("each notice is the same string the live telegram_alerts.py renders, escaped values included", async () => {
    const ledger = freshLedger();
    named(ledger, "C1", "Nguyen <Lan>");
    const money = { value: 1234567, approved: 20000, cashback: 14000, customer: "C1" };
    rawOrder(ledger, { id: "O1", platform: "shopee", status: "AWAITING_APPROVAL", customer: "C1", value: 1234567, estimate: 20000 });
    rawOrder(ledger, { id: "O2", platform: "tiktok", status: "APPROVED", ...money });
    rawOrder(ledger, { id: "O3", platform: "lazada", status: "REJECTED", customer: "C1", value: 1234567 });
    rawOrder(ledger, { id: "O4", platform: "shopeefood", status: "PAID", customer: "C1", cashback: 14000 });
    rawOrder(ledger, { id: "O5", platform: "unknown shop", status: "PAID", customer: null, recordedAt: null });
    for (const [id, event] of [["O1", "recorded"], ["O2", "approved"], ["O3", "rejected"], ["O4", "paid"], ["O5", "paid"]] as const) rawNotice(ledger, id, event);
    const sender = recordingSender();
    await deliver(ledger, sender);
    expect(sender.texts).toEqual([OLD.texts["recorded"], OLD.texts["approved"], OLD.texts["rejected"], OLD.texts["paid"], OLD.texts["guest"]]);
  });

  it("owner decision: the new-order message shows the estimated cashback the customer is told, without (80%)", async () => {
    const ledger = freshLedger();
    apply(ledger, awaiting("261020NEW00001", [20000]));
    const sender = recordingSender();
    await deliver(ledger, sender);
    expect(estimatedCashback(20000, "shopee")).toBe(14243);
    expect(sender.texts[0]).toContain(LABELS.recorded.cashback.replace("{amount}", "14.243"));
    expect(sender.texts[0]).not.toContain("(80%)");
    expect(sender.texts[0]).not.toContain("16.000");
  });

  it("escapes the values and every rejection reason has its label", async () => {
    const ledger = freshLedger();
    named(ledger, "C1", "A&B <b>");
    rawOrder(ledger, { id: "O<1>", platform: "a&b", status: "REJECTED", customer: "C1", reason: "not_eligible" });
    ledger.sqlite.prepare("INSERT INTO order_business_notices (dedup_key, order_id, event, raised_at) VALUES ('order:O1:rejected', 'O<1>', 'rejected', ?)").run(START);
    const sender = recordingSender();
    await deliver(ledger, sender);
    expect(sender.texts[0]).toContain("O&lt;1&gt;");
    expect(sender.texts[0]).toContain("A&amp;B &lt;b&gt; (ID: C1)");
    expect(sender.texts[0]).toContain("A&amp;B</b>");
    expect(sender.texts[0]).toContain(LABELS.reasons.not_eligible);
    for (const reason of ["order_cancelled", "all_items_cancelled", "commission_zero", "not_eligible"] satisfies RejectionReason[]) expect(LABELS.reasons[reason]).toBeTruthy();
  });
});

describe("the I/O matrix", () => {
  it("new order, approved, paid: one row each, in the step's own transaction", async () => {
    const ledger = payoutLedger();
    addBank(ledger, "P1");
    addOrder(ledger, { id: "261001A0001", customer: "P1", cashback: 79216 });
    const claim = claimed(openClaim(ledger, "P1"));
    confirmClaim(ledger, claim.claim.claimId, claim.snapshot.hash);
    // silentEvents ["paid"]: the customer is told per payout, the group per order.
    expect(noticeRows(ledger).map((n) => [n.dedup_key, n.event, n.delivery, n.attempts])).toEqual([["order:261001A0001:paid", "paid", "PENDING", 0]]);
    const sender = recordingSender();
    await deliver(ledger, sender);
    expect(sender.texts[0]).toContain("HOÀN TIỀN THÀNH CÔNG");
    expect(sender.texts[0]).toContain("79.216đ");

    const fresh = freshLedger();
    apply(fresh, awaiting("261020STEP0001"));
    apply(fresh, approved("261020STEP0001"));
    expect(noticeKeys(fresh)).toEqual(["order:261020STEP0001:recorded", "order:261020STEP0001:approved"]);
    const told = recordingSender();
    await deliver(fresh, told);
    expect(told.texts[0]).toContain("ĐƠN HÀNG MỚI GHI NHẬN");
    expect(told.texts[1]).toContain("ĐƠN HÀNG ĐƯỢC DUYỆT THÀNH CÔNG");
    expect(told.texts[1]).toContain(LABELS.approved.commission.replace("{amount}", "20.000"));
    expect(told.texts[1]).toContain(LABELS.approved.cashback.split("{amount}")[0] as string);
  });

  it("a payout voided and confirmed again is told once", async () => {
    const ledger = payoutLedger();
    addBank(ledger, "P1");
    addOrder(ledger, { id: "261001AGAIN01", customer: "P1", cashback: 79216 });
    const first = claimed(openClaim(ledger, "P1"));
    const paid = confirmClaim(ledger, first.claim.claimId, first.snapshot.hash);
    if (paid.kind !== "recorded") throw new Error(`expected a payout, got ${paid.kind}`);
    const sender = recordingSender();
    expect(await deliver(ledger, sender)).toMatchObject({ sent: 1 });
    ledger.tx((db) => {
      const by = commandAudit(db, CLOCK, MINH);
      return voidPayout(db, { payoutId: paid.payout.payoutId, reason: "wrong transfer" }, { clock: CLOCK, by, outbox: outboxFor(db, CLOCK, by) });
    });
    const second = claimed(openClaim(ledger, "P1"));
    const again = confirmClaim(ledger, second.claim.claimId, second.snapshot.hash, MINH, CLOCK, { newReceiptToken: () => "rcpt_test_token_0002" });
    expect(again.kind).toBe("recorded");
    expect(noticeKeys(ledger).filter((k) => k.endsWith(":paid"))).toEqual(["order:261001AGAIN01:paid"]);
    expect(await deliver(ledger, sender)).toEqual({ sent: 0, failed: 0, expired: 0 });
    expect(sender.texts).toHaveLength(1);
  });

  it("an approved order frozen by an unknown status or a commission drop raises one order_frozen high alert", () => {
    const frozenAlerts = (ledger: Ledger) => ledger.sqlite.prepare("SELECT kind, severity FROM alerts WHERE kind = 'order_frozen'").all();
    const unknown = freshLedger();
    apply(unknown, approved("261020ALRT0001"));
    expect(frozenAlerts(unknown)).toEqual([]);
    apply(unknown, reportRow("261020ALRT0001", "UNKNOWN", [{ status: "APPROVED", parts: [20000] }]));
    expect(frozenAlerts(unknown)).toEqual([{ kind: "order_frozen", severity: "high" }]);
    const dropped = freshLedger();
    apply(dropped, approved("261020ALRT0002", [20000]));
    apply(dropped, approved("261020ALRT0002", [10000]));
    expect((dropped.sqlite.prepare("SELECT status FROM orders").get() as { status: string }).status).toBe("FROZEN");
    expect(frozenAlerts(dropped)).toEqual([{ kind: "order_frozen", severity: "high" }]);
  });

  it("a rollback leaves no notice: the row commits with the step", () => {
    const ledger = freshLedger();
    expect(() =>
      ledger.tx((db) => {
        const deps = applyDepsFor(db, movingClock(START), { production: true });
        rawOrder(ledger, { id: "T1", platform: "shopee", status: "AWAITING_APPROVAL", customer: null });
        recordSteps(db, { orderId: "T1", customerId: null, guest: false, steps: [["AWAITING_APPROVAL", "REJECTED"]], reason: "report", facts: {}, params: {} }, deps);
        expect(noticeRows(ledger)).toHaveLength(1);
        throw new Error("rolled back");
      }),
    ).toThrow("rolled back");
    expect(noticeRows(ledger)).toEqual([]);
  });

  it("restored after a freeze: no notice, the approved one stands once", () => {
    const ledger = freshLedger();
    const clock = movingClock(START);
    apply(ledger, approved("261020FRZ00001"), clock);
    apply(ledger, reportRow("261020FRZ00001", "UNKNOWN", [{ status: "APPROVED", parts: [20000] }]), clock);
    staffTx(ledger, clock, (db, deps) => applyReviewCase(db, { caseId: openCase(ledger, "unknown_status"), reason: "checked", outcome: "restore" }, deps));
    expect((ledger.sqlite.prepare("SELECT status FROM orders WHERE order_id = '261020FRZ00001'").get() as { status: string }).status).toBe("APPROVED");
    expect(noticeKeys(ledger)).toEqual(["order:261020FRZ00001:recorded", "order:261020FRZ00001:approved"]);
  });

  it("rejected and reversed say why", async () => {
    const ledger = freshLedger();
    apply(ledger, awaiting("261020REJ00001"));
    apply(ledger, cancelled("261020REJ00001"));
    apply(ledger, approved("261020REV00001"));
    apply(ledger, cancelled("261020REV00001"));
    expect(noticeKeys(ledger)).toEqual(["order:261020REJ00001:recorded", "order:261020REJ00001:rejected", "order:261020REV00001:recorded", "order:261020REV00001:approved", "order:261020REV00001:reversed"]);
    const sender = recordingSender();
    await deliver(ledger, sender);
    const rejected = sender.texts.find((t) => t.includes("261020REJ00001") && t.includes("BỊ HỦY"));
    const reversed = sender.texts.find((t) => t.includes("261020REV00001") && t.includes("BỊ HỦY"));
    expect(rejected).toContain(LABELS.reasons.order_cancelled);
    expect(reversed).toContain(LABELS.reasons.reversed);
  });

  it("a voided payout: reversed is told though silent to the customer, back to approved is not", () => {
    const ledger = freshLedger();
    apply(ledger, approved("261020VOID0001"));
    apply(ledger, approved("261020VOID0002"));
    const before = noticeRows(ledger).length;
    ledger.tx((db) => {
      const deps = applyDepsFor(db, movingClock(START), { production: true });
      const common = { guest: false, customerId: "C1", reason: "voided", facts: {}, params: {}, silentEvents: ["payout_voided", "reversed"] };
      recordSteps(db, { ...common, orderId: "261020VOID0001", steps: [["PAID", "REVERSED"]] }, deps);
      recordSteps(db, { ...common, orderId: "261020VOID0002", steps: [["PAID", "APPROVED"]] }, deps);
    });
    expect(noticeKeys(ledger).slice(before)).toEqual(["order:261020VOID0001:reversed"]);
  });

  it("reopened then rejected again: a new lifecycle, a second rejected notice, no notice for the reopen", () => {
    const ledger = freshLedger();
    const clock = movingClock(START);
    apply(ledger, awaiting("261020LIFE0001"), clock);
    apply(ledger, cancelled("261020LIFE0001"), clock);
    clock.advance(HOUR);
    apply(ledger, awaiting("261020LIFE0001"), clock);
    staffTx(ledger, clock, (db, deps) => reportWrongRejection(db, { orderId: "261020LIFE0001", reason: "customer shows it delivered" }, deps));
    staffTx(ledger, clock, (db, deps) => applyReviewCase(db, { caseId: openCase(ledger, "wrong_rejection"), reason: "rejected on UNPAID" }, deps));
    clock.advance(HOUR);
    apply(ledger, reportRow("261020LIFE0001", "CANCELLED", [{ status: "CANCELLED", parts: [0], value: 2 }]), clock);
    clock.advance(HOUR);
    apply(ledger, reportRow("261020LIFE0001", "CANCELLED", [{ status: "CANCELLED", parts: [0], value: 3 }]), clock);
    expect(noticeKeys(ledger)).toEqual(["order:261020LIFE0001:recorded", "order:261020LIFE0001:rejected", "order:261020LIFE0001@1:rejected"]);
  });

  it("a guest or no customer is sent, as the live system did, with the guest label and no cashback", async () => {
    const ledger = freshLedger();
    apply(ledger, awaiting("261020HOUS0001", [20000], GUEST_ROW));
    rawOrder(ledger, { id: "NOCUST", platform: "shopee", status: "REJECTED", customer: null });
    rawNotice(ledger, "NOCUST", "rejected");
    const sender = recordingSender();
    await deliver(ledger, sender);
    expect(sender.texts).toHaveLength(2);
    for (const text of sender.texts) expect(text).toContain(LABELS.customer_guest);
    expect(sender.texts[0]).toContain(LABELS.recorded.commission.replace("{amount}", "20.000"));
    expect(sender.texts[0]).not.toContain(LABELS.recorded.cashback.split("{amount}")[0] as string);
    // The customer hears nothing (D5), the group does.
    expect(ledger.sqlite.prepare("SELECT COUNT(*) AS n FROM outbox").get()).toEqual({ n: 0 });
  });

  it("recorded and frozen at once: a new-order notice saying under review, plus the order_frozen alert", async () => {
    const ledger = freshLedger();
    apply(ledger, reportRow("261020NEWF0381", "UNKNOWN", [{ status: "AWAITING", parts: [20000] }]));
    expect(noticeKeys(ledger)).toEqual(["order:261020NEWF0381:recorded"]);
    const sender = recordingSender();
    await deliver(ledger, sender);
    expect(sender.texts[0]).toContain(LABELS.recorded.status_frozen);
    expect(sender.texts[0]).not.toContain(LABELS.recorded.status);
    expect(ledger.sqlite.prepare("SELECT kind, severity FROM alerts").all()).toEqual([{ kind: "order_frozen", severity: "high" }]);
  });

  it("order_frozen carries no personal data: no order id, name or customer id", () => {
    const text = telegramText({ kind: "order_frozen", severity: "high", suppressed: 0, raisedAt: START });
    expect(text).toContain("Tạm Giữ");
    expect(text.replace(/<code>\d\d:\d\d:\d\d - \d\d\/\d\d\/\d{4}<\/code>/, "")).not.toMatch(/\d{4,}/);
  });

  it("an erased customer's name never waits in a queue: the text is rendered at send time", async () => {
    const ledger = freshLedger();
    named(ledger, "C1", "Nguyen Thi Lan");
    apply(ledger, awaiting("261020ERAS0001"));
    expect(JSON.stringify(noticeRows(ledger))).not.toContain("Nguyen");
    ledger.sqlite.prepare("UPDATE customers SET display_name = NULL, status = 'ERASED', erased_at = ? WHERE customer_id = 'C1'").run(START);
    const sender = recordingSender();
    await deliver(ledger, sender);
    expect(sender.texts[0]).not.toContain("Nguyen");
    expect(sender.texts[0]).toContain(LABELS.line_customer.replace("{customer}", "C1"));
  });
});

describe("acceptance", () => {
  it("given an hourly run re-reads the same report, when it finishes, then no new notice row exists", () => {
    const ledger = freshLedger();
    const clock = movingClock(START);
    apply(ledger, awaiting("261020HOUR0001"), clock);
    apply(ledger, approved("261020HOUR0001"), clock);
    const before = noticeRows(ledger);
    clock.advance(HOUR);
    apply(ledger, approved("261020HOUR0001"), clock);
    apply(ledger, approved("261020HOUR0001", [20000, 0]), clock);
    expect(noticeRows(ledger)).toEqual(before);
  });

  it("given a send succeeded and recording it failed, when the next run starts, then the message is not sent again", async () => {
    const ledger = freshLedger();
    apply(ledger, awaiting("261020ONCE0001"));
    let broken = false;
    const flaky: Pick<Ledger, "tx"> = {
      tx: (fn) => {
        if (broken) throw new Error("disk full");
        return ledger.tx(fn);
      },
    };
    const sender = recordingSender();
    const failingAfterSend: BusinessNoticeSender = {
      send: async (text) => {
        await sender.send(text);
        broken = true;
      },
    };
    const { logger, lines } = memoryLogger();
    expect(await deliver(flaky, failingAfterSend, movingClock(START), logger)).toMatchObject({ sent: 1, failed: 0 });
    expect(lines.filter((l) => l.includes("orders.business_notice.bookkeeping_failed"))).toHaveLength(3);
    expect(noticeRows(ledger)[0]?.delivery).toBe("SENDING");
    broken = false;
    expect(await deliver(ledger, sender)).toEqual({ sent: 0, failed: 0, expired: 0 });
    expect(sender.texts).toHaveLength(1);
  });

  it("given an imported order, when the server starts on the new build, then no message goes out for it", async () => {
    const { report, targetPath } = importOnce(buildLiveCopy({ extraSql: CLEAN_LIVE_SQL }));
    expect(report.outcome).toBeDefined();
    expect(rows(targetPath, "SELECT COUNT(*) AS n FROM orders")).not.toEqual([{ n: 0 }]);
    expect(rows(targetPath, "SELECT COUNT(*) AS n FROM order_business_notices")).toEqual([{ n: 0 }]);
  });
});

describe("delivery", () => {
  const three = (ledger: Ledger) => {
    for (const id of ["261020ORDR0001", "261020ORDR0002", "261020ORDR0003"]) apply(ledger, awaiting(id));
  };

  it("Telegram down: the run stops at the first failure, stays pending and is retried next run in order", async () => {
    const ledger = freshLedger();
    three(ledger);
    const sent: string[] = [];
    let calls = 0;
    const failing: BusinessNoticeSender = {
      send: async (text) => {
        if (++calls === 2) throw new Error("offline");
        sent.push(text);
      },
    };
    expect(await deliver(ledger, failing)).toEqual({ sent: 1, failed: 1, expired: 0 });
    expect(noticeRows(ledger).map((n) => [n.delivery, n.attempts])).toEqual([["SENT", 1], ["PENDING", 1], ["PENDING", 0]]);
    expect(await deliver(ledger, failing)).toEqual({ sent: 2, failed: 0, expired: 0 });
    expect(sent.map((t) => /261020ORDR000\d/.exec(t)?.[0])).toEqual(["261020ORDR0001", "261020ORDR0002", "261020ORDR0003"]);
    expect((ledger.sqlite.prepare("SELECT delivered_at FROM order_business_notices WHERE id = 1").get() as { delivered_at: string }).delivered_at).toBe(START);
  });

  it("pending over 24 hours becomes EXPIRED, is never sent, and is counted in one log line", async () => {
    const ledger = freshLedger();
    three(ledger);
    const clock = movingClock(START);
    const sender = recordingSender();
    const { logger, lines } = memoryLogger();
    clock.advance(NOTICE_EXPIRY_MS + HOUR);
    expect(await deliver(ledger, sender, clock, logger)).toEqual({ sent: 0, failed: 0, expired: 3 });
    expect(sender.texts).toEqual([]);
    expect(noticeRows(ledger).every((n) => n.delivery === "EXPIRED")).toBe(true);
    expect(lines.filter((l) => l.includes("orders.business_notice.older_notices_skipped") && l.includes('"expired":3'))).toHaveLength(1);
  });

  it("in literal hours: a notice aged 23 hours is sent, one aged 25 hours is EXPIRED", async () => {
    const ledger = freshLedger();
    rawOrder(ledger, { id: "AGED23", platform: "shopee", status: "AWAITING_APPROVAL", customer: "C1" });
    rawOrder(ledger, { id: "AGED25", platform: "shopee", status: "AWAITING_APPROVAL", customer: "C1" });
    rawNotice(ledger, "AGED23", "recorded", "2026-10-29T08:00:00.000Z");
    rawNotice(ledger, "AGED25", "recorded", "2026-10-29T06:00:00.000Z");
    const sender = recordingSender();
    expect(await deliver(ledger, sender)).toEqual({ sent: 1, failed: 0, expired: 1 });
    expect(sender.texts[0]).toContain("AGED23");
    expect(noticeRows(ledger).map((n) => [n.order_id, n.delivery])).toEqual([["AGED23", "SENT"], ["AGED25", "EXPIRED"]]);
  });

  it("a failed send logs the HTTP status when the error carries one, and none when it does not", async () => {
    const ledger = freshLedger();
    apply(ledger, awaiting("261020STAT0001"));
    const refused = memoryLogger();
    await deliver(ledger, { send: () => Promise.reject(Object.assign(new Error("refused"), { status: 403 })) }, movingClock(START), refused.logger);
    expect(refused.lines.find((l) => l.includes("delivery_failed"))).toContain('"status":403');
    const offline = memoryLogger();
    await deliver(ledger, { send: () => Promise.reject(Object.assign(new Error("offline"), { status: null })) }, movingClock(START), offline.logger);
    expect(offline.lines.find((l) => l.includes("delivery_failed"))).not.toContain('"status"');
  });

  it("sends at most 10 per run; the rest go on the next", async () => {
    const ledger = freshLedger();
    for (let i = 0; i < NOTICES_PER_RUN + 2; i++) apply(ledger, awaiting(`261020MANY${String(i).padStart(4, "0")}`));
    const sender = recordingSender();
    expect(await deliver(ledger, sender)).toMatchObject({ sent: 10 });
    expect(await deliver(ledger, sender)).toMatchObject({ sent: 2 });
  });

  it("log lines carry ids and kinds only: no name, chat id or token", async () => {
    const ledger = freshLedger();
    named(ledger, "C1", "Nguyen Thi Lan");
    apply(ledger, awaiting("261020LOG00001"));
    const { logger, lines } = memoryLogger();
    await deliver(ledger, { send: () => Promise.reject(new Error("Nguyen Thi Lan -1009 token")) }, movingClock(START), logger);
    const failed = lines.find((l) => l.includes("orders.business_notice.delivery_failed")) ?? "";
    expect(failed).toContain('"noticeId":1');
    expect(lines.join("\n")).not.toMatch(/Nguyen|-1009|token/);
  });
});

describe("configuration", () => {
  const TOKEN = "t".repeat(40);
  const BOT = "123456789:FAKE-test-token-never-real";
  const base = (ledger: Ledger) => ({ ledger, clock: movingClock(START), heartbeats: assistantHeartbeats(null), health: {} });
  const prod = { env: "prod" as const, dataDir: "unused", backupOffsite: null, assistantToken: null, telegram: { botToken: BOT, chatId: "-1001" } };

  it("chat unset: no job, rows stored, production logs an error at start and still starts", () => {
    const ledger = freshLedger();
    const { logger, lines } = memoryLogger();
    expect(ownerJobs({ config: prod, logger, ...base(ledger) }).map((j) => j.name)).toEqual(["backup", "health", "linkRequestStuck", "alertDelivery"]);
    expect(lines.some((l) => l.includes('"level":50') && l.includes("orders.business_notice.chat_absent"))).toBe(true);
    apply(ledger, awaiting("261020WAIT0001"));
    expect(noticeRows(ledger).map((n) => n.delivery)).toEqual(["PENDING"]);
    const dev = memoryLogger();
    ownerJobs({ config: { ...prod, env: "dev" }, logger: dev.logger, ...base(ledger) });
    expect(dev.lines.some((l) => l.includes("chat_absent"))).toBe(false);
  });

  it("chat_absent is logged only when the chat id is missing, not when only the bot is", () => {
    const ledger = freshLedger();
    const { logger, lines } = memoryLogger();
    expect(ownerJobs({ config: { ...prod, telegram: null, telegramBusinessChatId: "-1009" }, logger, ...base(ledger) }).map((j) => j.name)).toEqual(["backup", "health", "linkRequestStuck"]);
    expect(lines.some((l) => l.includes("operations.alert.telegram_absent"))).toBe(true);
    expect(lines.some((l) => l.includes("chat_absent"))).toBe(false);
  });

  it("the job posts to the business chat, never to the owner's", async () => {
    const ledger = freshLedger();
    apply(ledger, awaiting("261020CHAT0001"));
    const chats: string[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: { body: string }) => {
      chats.push((JSON.parse(init.body) as { chat_id: string }).chat_id);
      return { ok: true, status: 200 };
    });
    const job = ownerJobs({ config: { ...prod, telegramBusinessChatId: "-1009" }, logger: memoryLogger().logger, ...base(ledger) }).find((j) => j.name === "orderBusinessNotices");
    await job?.run(new AbortController().signal);
    expect(chats).toEqual(["-1009"]);
  });

  it("TELEGRAM_BUSINESS_CHAT_ID: optional, the owner chat's format", () => {
    expect(parseConfig("dev", { INTERNAL_TOKEN: TOKEN }).telegramBusinessChatId).toBeNull();
    expect(parseConfig("dev", { INTERNAL_TOKEN: TOKEN, TELEGRAM_BUSINESS_CHAT_ID: "" }).telegramBusinessChatId).toBeNull();
    expect(parseConfig("dev", { INTERNAL_TOKEN: TOKEN, TELEGRAM_BUSINESS_CHAT_ID: "-1009" }).telegramBusinessChatId).toBe("-1009");
    expect(() => parseConfig("dev", { INTERNAL_TOKEN: TOKEN, TELEGRAM_BUSINESS_CHAT_ID: "group" })).toThrow("config: missing or invalid TELEGRAM_BUSINESS_CHAT_ID");
  });

  it("dev config: a production chat is refused by the isolation check, the committed one and the production file's", () => {
    const context = (prodEnv: IsolationContext["prodEnv"]): IsolationContext => ({ identifiers: productionIdentifiers(REPOSITORY_ROOT, "/home/none"), prodEnv, devFileIsProdFile: false, caseInsensitive: false });
    const keys = (chat: string, prodEnv: IsolationContext["prodEnv"]) => isolationProblems(parseConfig("dev", { INTERNAL_TOKEN: TOKEN, TELEGRAM_BUSINESS_CHAT_ID: chat }), context(prodEnv)).map((p) => `${p.key} ${p.reason}`);
    expect(keys("-5232520551", null)).toContain("TELEGRAM_BUSINESS_CHAT_ID production_value");
    expect(keys("-1004416753701", null)).toContain("TELEGRAM_BUSINESS_CHAT_ID production_value");
    expect(keys("-777", { TELEGRAM_BUSINESS_CHAT_ID: "-777" })).toContain("TELEGRAM_BUSINESS_CHAT_ID production_value");
    expect(keys("-778", null)).not.toContain("TELEGRAM_BUSINESS_CHAT_ID production_value");
  });
});
