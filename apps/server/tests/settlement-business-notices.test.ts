/**
 * The Telegram settlement notices of the DP Business group (D63): one row per settlement and event
 * written in the record's own transaction, sent outside any transaction under the rules of D62.
 * Covers the I/O matrix of
 * _bmad-output/implementation-artifacts/spec-payouts-telegram-settlement-notices.md.
 */
import type { NetworkPayoutRecord } from "@cashback/contracts";
import LABELS from "@cashback/labels/vi/settlement-notices.json" with { type: "json" };
import { splitCommission } from "@cashback/money";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ownerJobs } from "../src/health/owner-jobs";
import { assistantHeartbeats, commandAudit } from "../src/modules/operations/index";
import { dismissReviewCase, NOTICE_EXPIRY_MS, NOTICES_PER_RUN, type BusinessNoticeSender } from "../src/modules/orders/index";
import { deliverSettlementNotices, NETWORK_SYNC_ACTOR, recordNetworkPayout } from "../src/modules/payouts/index";
import type { Ledger } from "../src/platform/db/ledger";
import { applyDepsFor } from "../src/reconcile/apply-deps";
import { memoryLogger } from "./helpers/link-ledger";
import { buildLiveCopy, importOnce, rows } from "./helpers/live-fixture";
import { closeLedgers, HOUR, movingClock } from "./helpers/order-ledger";
import { MINH, payoutLedger } from "./helpers/payout-ledger";

afterEach(() => {
  closeLedgers();
  vi.unstubAllGlobals();
});

const START = "2026-10-30T07:00:00.000Z";
const CREATED = "2026-09-28T03:00:00.000Z";
const PAID_AT = "2026-10-01T03:00:00.000Z";
const withheldNet = (gross: number): number => splitCommission({ approvedCommission: gross, network: "shopee", withheld: true }).net;

const batch = (overrides: Partial<NetworkPayoutRecord> = {}): NetworkPayoutRecord => ({ network: "shopee", networkPayoutId: "1034567", status: "PROCESSING", amount: withheldNet(100000), eligibleAmount: 100000, createdAt: CREATED, ...overrides });
const paid = (overrides: Partial<NetworkPayoutRecord> = {}): NetworkPayoutRecord => batch({ status: "PAID", paidAt: PAID_AT, ...overrides });

const record = (ledger: Ledger, input: NetworkPayoutRecord, clock = movingClock(START)) => ledger.tx((db) => recordNetworkPayout(db, input, { clock, by: commandAudit(db, clock, NETWORK_SYNC_ACTOR) }));

function addOrder(ledger: Ledger, id: string, gross: number): void {
  ledger.sqlite
    .prepare("INSERT INTO orders (order_id, network, platform, customer_id, status, approved_commission, cashback, approved_at, origin) VALUES (?, 'shopee', 'shopee', 'P1', 'APPROVED', ?, 1000, '2026-09-25T03:00:00.000Z', 'REPORT')")
    .run(id, gross);
}

interface NoticeRow {
  id: number;
  dedup_key: string;
  event: string;
  delivery: string;
  attempts: number;
}
const noticeRows = (ledger: Ledger) => ledger.sqlite.prepare("SELECT id, dedup_key, event, delivery, attempts FROM settlement_business_notices ORDER BY id").all() as NoticeRow[];
const events = (ledger: Ledger) => noticeRows(ledger).map((n) => n.event);

function recordingSender(): BusinessNoticeSender & { texts: string[] } {
  const texts: string[] = [];
  return { texts, send: async (text) => void texts.push(text) };
}
const deliver = (ledger: Pick<Ledger, "tx">, sender: BusinessNoticeSender, clock = movingClock(START), logger = memoryLogger().logger) => deliverSettlementNotices(ledger, sender, clock, logger);
const header = (event: "created" | "paid" | "failed" | "matched" | "mismatch"): string => LABELS[event].header.replace("{network}", LABELS.networks.shopee);
const amount = (line: string, value: string): string => line.replace("{amount}", value);
const warningPrefix = LABELS.matched.case_warning.split("{caseIds}")[0] as string;

describe("the I/O matrix", () => {
  it("new batch: one created notice with network, payout id, status, gross, received, fee, tax and creation time, in dotted dong", async () => {
    const ledger = payoutLedger();
    record(ledger, batch());
    const row = noticeRows(ledger);
    expect(row.map((n) => [n.dedup_key, n.event, n.delivery, n.attempts])).toEqual([[`settlement:1:created`, "created", "PENDING", 0]]);
    const sender = recordingSender();
    await deliver(ledger, sender);
    expect(sender.texts).toHaveLength(1);
    const text = sender.texts[0] as string;
    expect(text).toContain(header("created"));
    expect(text).toContain("<code>1034567</code>");
    expect(text).toContain(LABELS.statuses.PROCESSING);
    expect(text).toContain(amount(LABELS.line_gross, "100.000"));
    expect(text).toContain(amount(LABELS.line_received, "89.020"));
    expect(text).toContain(amount(LABELS.line_fee, "980"));
    expect(text).toContain(amount(LABELS.line_tax, "10.000"));
    expect(text).toContain(LABELS.line_created_at.replace("{time}", "10:00:00 - 28/09/2026"));
  });

  it("a gross not known leaves out gross, fee and tax; a zero tax is known and shown", async () => {
    const ledger = payoutLedger();
    record(ledger, batch({ networkPayoutId: "NOGROSS", eligibleAmount: null, createdAt: null }));
    const unwithheld = splitCommission({ approvedCommission: 100000, network: "shopee", withheld: false });
    record(ledger, batch({ networkPayoutId: "NOTAX", amount: unwithheld.net }));
    const sender = recordingSender();
    await deliver(ledger, sender);
    expect(sender.texts[0]).not.toContain(LABELS.line_gross.split("{amount}")[0] as string);
    expect(sender.texts[0]).not.toContain(LABELS.line_fee.split("{amount}")[0] as string);
    expect(sender.texts[0]).not.toContain(LABELS.line_tax.split("{amount}")[0] as string);
    expect(sender.texts[0]).not.toContain(LABELS.line_created_at.split("{time}")[0] as string);
    expect(sender.texts[1]).toContain(amount(LABELS.line_tax, "0"));
  });

  it("PROCESSING to PAID: a paid notice with the paid time", async () => {
    const ledger = payoutLedger();
    record(ledger, batch());
    record(ledger, paid());
    expect(events(ledger).slice(0, 2)).toEqual(["created", "paid"]);
    const sender = recordingSender();
    await deliver(ledger, sender);
    expect(sender.texts[1]).toContain(header("paid"));
    expect(sender.texts[1]).toContain(LABELS.statuses.PAID);
    expect(sender.texts[1]).toContain(amount(LABELS.line_received, "89.020"));
    expect(sender.texts[1]).toContain(LABELS.line_paid_at.replace("{time}", "10:00:00 - 01/10/2026"));
  });

  it("PROCESSING to FAILED: a failed notice and no match", async () => {
    const ledger = payoutLedger();
    record(ledger, batch());
    record(ledger, batch({ status: "FAILED" }));
    expect(events(ledger)).toEqual(["created", "failed"]);
    const sender = recordingSender();
    await deliver(ledger, sender);
    expect(sender.texts[1]).toContain(header("failed"));
    expect(sender.texts[1]).toContain(LABELS.statuses.FAILED);
    expect(sender.texts[1]).toContain(amount(LABELS.failed.amount, "89.020"));
    expect(sender.texts[1]).not.toContain(LABELS.line_received.split("{amount}")[0] as string);
  });

  it("match becomes MATCHED: a matched notice with orders settled, matched gross and unattributed", async () => {
    const ledger = payoutLedger();
    addOrder(ledger, "L1", 30000);
    addOrder(ledger, "L2", 40000);
    record(ledger, batch());
    record(ledger, paid({ orderIds: ["L1", "L2"] }));
    expect(events(ledger)).toEqual(["created", "paid", "matched"]);
    const sender = recordingSender();
    await deliver(ledger, sender);
    expect(sender.texts[2]).toContain(header("matched"));
    expect(sender.texts[2]).toContain(LABELS.matched.orders_settled.replace("{count}", "2"));
    expect(sender.texts[2]).toContain(amount(LABELS.matched.matched_gross, "70.000"));
    expect(sender.texts[2]).toContain(amount(LABELS.matched.unattributed, "30.000"));
    expect(sender.texts[2]).not.toContain(warningPrefix);
  });

  it("a listed batch with a refused order tells matched, counting settled orders only", async () => {
    const ledger = payoutLedger();
    addOrder(ledger, "G1", 60000);
    addOrder(ledger, "G2", 5000);
    ledger.sqlite.prepare("UPDATE orders SET network_batch_id = 'OTHER', settled_at = ? WHERE order_id = 'G2'").run(START);
    const answer = record(ledger, paid({ orderIds: ["G1", "G2"] }));
    expect(answer).toMatchObject({ match: "MATCHED", settled: 1, conflicts: 1 });
    expect(answer.caseIds).toHaveLength(1);
    expect(ledger.sqlite.prepare("SELECT case_id, reason, subject FROM review_cases WHERE status = 'OPEN'").all()).toEqual([{ case_id: answer.caseIds[0], reason: "settlement_conflict", subject: "G2" }]);
    expect(events(ledger)).toEqual(["created", "matched"]);
    const sender = recordingSender();
    await deliver(ledger, sender);
    expect(sender.texts[1]).toContain(LABELS.matched.orders_settled.replace("{count}", "1"));
    expect(sender.texts[1]).toContain(LABELS.matched.case_warning.replace("{caseIds}", `#${answer.caseIds[0]}`));
  });

  it("a listed batch with orders above its gross warns and shows no negative line", async () => {
    const ledger = payoutLedger();
    addOrder(ledger, "H1", 60000);
    addOrder(ledger, "H2", 50000);
    const answer = record(ledger, paid({ orderIds: ["H1", "H2"] }));
    expect(answer).toMatchObject({ match: "MATCHED", settled: 2, unattributed: -10000 });
    expect(events(ledger)).toEqual(["created", "matched"]);
    const sender = recordingSender();
    await deliver(ledger, sender);
    expect(sender.texts[1]).toContain(amount(LABELS.matched.matched_gross, "110.000"));
    expect(sender.texts[1]).not.toContain(LABELS.matched.unattributed.split("{amount}")[0] as string);
    expect(sender.texts[1]).not.toContain("-10.000");
    expect(sender.texts[1]).toContain(LABELS.matched.case_warning.replace("{caseIds}", `#${answer.caseIds[0]}`));
  });

  it("match becomes MISMATCH: a mismatch notice pointing at the open review case", async () => {
    const ledger = payoutLedger();
    addOrder(ledger, "M1", 80000);
    addOrder(ledger, "M2", 30000);
    const answer = record(ledger, paid());
    expect(answer.match).toBe("MISMATCH");
    expect(events(ledger)).toEqual(["created", "mismatch"]);
    const sender = recordingSender();
    await deliver(ledger, sender);
    expect(sender.texts[1]).toContain(header("mismatch"));
    expect(sender.texts[1]).toContain(amount(LABELS.line_gross, "100.000"));
    expect(sender.texts[1]).toContain(LABELS.mismatch.case_open.replace("{caseIds}", `#${answer.caseIds[0]}`));
  });

  it("a mismatch whose case staff already closed still points at the batch", async () => {
    const ledger = payoutLedger();
    addOrder(ledger, "M1", 80000);
    addOrder(ledger, "M2", 30000);
    const clock = movingClock(START);
    const answer = record(ledger, paid(), clock);
    ledger.tx((db) => dismissReviewCase(db, { caseId: answer.caseIds[0] as number, reason: "checked" }, applyDepsFor(db, clock, { production: true, actor: MINH })));
    const sender = recordingSender();
    await deliver(ledger, sender);
    expect(sender.texts[1]).toContain(LABELS.mismatch.case_none);
  });

  it("a mismatch later matched tells matched once; a mismatch that only refreshes tells nothing more", () => {
    const ledger = payoutLedger();
    addOrder(ledger, "M1", 80000);
    addOrder(ledger, "M2", 30000);
    record(ledger, paid());
    addOrder(ledger, "M3", 5000);
    record(ledger, paid());
    expect(events(ledger)).toEqual(["created", "mismatch"]);
    record(ledger, paid({ orderIds: ["M1"] }));
    expect(events(ledger)).toEqual(["created", "mismatch", "matched"]);
    record(ledger, paid({ orderIds: ["M1"] }));
    expect(events(ledger)).toEqual(["created", "mismatch", "matched"]);
  });

  it("first seen already paid: created showing PAID, then the match notice, no separate paid", async () => {
    const ledger = payoutLedger();
    addOrder(ledger, "F1", 60000);
    record(ledger, paid({ orderIds: ["F1"] }));
    expect(events(ledger)).toEqual(["created", "matched"]);
    const sender = recordingSender();
    await deliver(ledger, sender);
    expect(sender.texts[0]).toContain(header("created"));
    expect(sender.texts[0]).toContain(LABELS.statuses.PAID);
    expect(sender.texts[1]).toContain(header("matched"));
  });

  it("first seen already failed: created only", () => {
    const ledger = payoutLedger();
    record(ledger, batch({ status: "FAILED" }));
    expect(events(ledger)).toEqual(["created"]);
  });

  it("paid time or order list only: status and match unchanged, nothing", () => {
    const ledger = payoutLedger();
    record(ledger, batch());
    record(ledger, batch({ orderIds: ["X1"] }));
    record(ledger, batch({ paidAt: PAID_AT }));
    expect(events(ledger)).toEqual(["created"]);
  });

  it("changed facts open their case and send no notice", () => {
    const ledger = payoutLedger();
    record(ledger, batch());
    expect(record(ledger, batch({ amount: 1 })).factsChanged).toBe(true);
    expect(events(ledger)).toEqual(["created"]);
  });

  it("a rollback leaves no notice: the row commits with the record", () => {
    const ledger = payoutLedger();
    const clock = movingClock(START);
    expect(() =>
      ledger.tx((db) => {
        recordNetworkPayout(db, batch(), { clock, by: commandAudit(db, clock, NETWORK_SYNC_ACTOR) });
        throw new Error("rolled back");
      }),
    ).toThrow("rolled back");
    expect(noticeRows(ledger)).toEqual([]);
  });

  it("cutover import: no notice; an imported batch sends one only on a new change", async () => {
    const source = buildLiveCopy({ extraSql: `INSERT INTO payout_batches (batch_id, platform, status, amount, eligible_amount, created_time, paid_time, raw_json, created_at, updated_at) VALUES ('OLD1', 'shopee', 'PAID', 89020, 100000, 1759028400, 1759287600, '{}', '2026-10-01', '2026-10-01');` });
    const run = importOnce(source);
    expect(run.report.outcome.ok, JSON.stringify(run.report.outcome)).toBe(true);
    expect(rows(run.targetPath, "SELECT network_payout_id, origin FROM network_settlements")).toEqual([{ network_payout_id: "OLD1", origin: "CUTOVER" }]);
    expect(rows(run.targetPath, "SELECT count(*) AS n FROM settlement_business_notices")).toEqual([{ n: 0 }]);

    const ledger = payoutLedger();
    const insertOld = ledger.sqlite.prepare("INSERT INTO network_settlements (network, network_payout_id, status, amount, match, origin, recorded_at, updated_at) VALUES ('shopee', ?, 'PROCESSING', 1000, 'HISTORIC', 'CUTOVER', ?, ?)");
    insertOld.run("HIST1", START, START);
    record(ledger, batch({ networkPayoutId: "HIST1", amount: 1000, eligibleAmount: null, createdAt: null }));
    expect(events(ledger)).toEqual([]);
    record(ledger, batch({ networkPayoutId: "HIST1", amount: 1000, eligibleAmount: null, createdAt: null, status: "PAID" }));
    expect(events(ledger)).toEqual(["paid"]);
  });
});

describe("acceptance", () => {
  it("given an hourly payout-record read repeats 13 batches unchanged, when it finishes, then no notice row exists", () => {
    const ledger = payoutLedger();
    const insert = ledger.sqlite.prepare("INSERT INTO network_settlements (network, network_payout_id, status, amount, eligible_amount, created_at, paid_at, match, origin, recorded_at, updated_at) VALUES ('shopee', ?, 'PAID', ?, 100000, ?, ?, 'MATCHED', 'NETWORK', ?, ?)");
    const records = Array.from({ length: 13 }, (_, i) => paid({ networkPayoutId: `B${i}` }));
    for (const r of records) insert.run(r.networkPayoutId, r.amount, CREATED, PAID_AT, START, START);
    const clock = movingClock(START);
    clock.advance(HOUR);
    for (const r of records) record(ledger, r, clock);
    expect(noticeRows(ledger)).toEqual([]);
  });

  it("given a batch recorded through this code repeats, when the next reads finish, then nothing is added", () => {
    const ledger = payoutLedger();
    addOrder(ledger, "R1", 60000);
    const clock = movingClock(START);
    record(ledger, paid({ orderIds: ["R1"] }), clock);
    const before = noticeRows(ledger);
    clock.advance(HOUR);
    record(ledger, paid({ orderIds: ["R1"] }), clock);
    expect(noticeRows(ledger)).toEqual(before);
  });

  it("given a batch moves to PAID and matches in one record, when the job runs, then the group receives paid before matched", async () => {
    const ledger = payoutLedger();
    addOrder(ledger, "A1", 60000);
    record(ledger, batch());
    record(ledger, paid({ orderIds: ["A1"] }));
    const sender = recordingSender();
    await deliver(ledger, sender);
    expect(sender.texts.map((t) => t.split("\n")[0])).toEqual([header("created"), header("paid"), header("matched")].map((h) => h.split("\n")[0]));
  });

  it("given a send succeeded and recording it failed, when the next run starts, then the message is not sent again", async () => {
    const ledger = payoutLedger();
    record(ledger, batch());
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
    expect(lines.filter((l) => l.includes("payouts.settlement_notice.bookkeeping_failed"))).toHaveLength(3);
    expect(noticeRows(ledger)[0]?.delivery).toBe("SENDING");
    broken = false;
    expect(await deliver(ledger, sender)).toEqual({ sent: 0, failed: 0, expired: 0 });
    expect(sender.texts).toHaveLength(1);
  });
});

describe("delivery", () => {
  const three = (ledger: Ledger) => {
    for (const id of ["B1", "B2", "B3"]) record(ledger, batch({ networkPayoutId: id }));
  };

  it("Telegram down: the run stops at the first failure, stays pending and is retried next run in order", async () => {
    const ledger = payoutLedger();
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
    expect(sent.map((t) => /<code>(B\d)<\/code>/.exec(t)?.[1])).toEqual(["B1", "B2", "B3"]);
  });

  it("pending over 24 hours becomes EXPIRED, is never sent, and is counted in one log line", async () => {
    const ledger = payoutLedger();
    three(ledger);
    const clock = movingClock(START);
    clock.advance(NOTICE_EXPIRY_MS + HOUR);
    const sender = recordingSender();
    const { logger, lines } = memoryLogger();
    expect(await deliver(ledger, sender, clock, logger)).toEqual({ sent: 0, failed: 0, expired: 3 });
    expect(sender.texts).toEqual([]);
    expect(noticeRows(ledger).every((n) => n.delivery === "EXPIRED")).toBe(true);
    expect(lines.filter((l) => l.includes("payouts.settlement_notice.older_notices_skipped") && l.includes('"expired":3'))).toHaveLength(1);
  });

  it("sends at most 10 per run; the rest go on the next", async () => {
    const ledger = payoutLedger();
    for (let i = 0; i < NOTICES_PER_RUN + 2; i++) record(ledger, batch({ networkPayoutId: `MANY${i}` }));
    const sender = recordingSender();
    expect(await deliver(ledger, sender)).toMatchObject({ sent: 10 });
    expect(await deliver(ledger, sender)).toMatchObject({ sent: 2 });
  });

  it("log lines carry ids and kinds only: no payout id, amount, chat id or token", async () => {
    const ledger = payoutLedger();
    record(ledger, batch());
    const { logger, lines } = memoryLogger();
    await deliver(ledger, { send: () => Promise.reject(Object.assign(new Error("1034567 -1009 token"), { status: 403 })) }, movingClock(START), logger);
    const failed = lines.find((l) => l.includes("payouts.settlement_notice.delivery_failed")) ?? "";
    expect(failed).toContain('"noticeId":1');
    expect(failed).toContain('"event":"created"');
    expect(failed).toContain('"status":403');
    expect(lines.join("\n")).not.toMatch(/1034567|-1009|token|100000/);
  });

  it("escapes an id from outside and names no customer", async () => {
    const ledger = payoutLedger();
    ledger.sqlite.prepare("UPDATE customers SET display_name = 'Nguyen Thi Lan' WHERE customer_id = 'P1'").run();
    addOrder(ledger, "N1", 60000);
    ledger.sqlite.prepare("INSERT INTO network_settlements (network, network_payout_id, status, amount, match, origin, recorded_at, updated_at) VALUES ('shopee', 'A<&>', 'PROCESSING', 1000, 'PENDING', 'NETWORK', ?, ?)").run(START, START);
    ledger.sqlite.prepare("INSERT INTO settlement_business_notices (dedup_key, settlement_id, event, raised_at) VALUES ('settlement:1:created', 1, 'created', ?)").run(START);
    record(ledger, paid({ orderIds: ["N1"] }));
    const sender = recordingSender();
    await deliver(ledger, sender);
    expect(sender.texts[0]).toContain("A&lt;&amp;&gt;");
    expect(sender.texts.join("\n")).not.toMatch(/Nguyen|P1/);
  });
});

describe("configuration", () => {
  const BOT = "123456789:FAKE-test-token-never-real";
  const base = (ledger: Ledger) => ({ ledger, clock: movingClock(START), heartbeats: assistantHeartbeats(null), health: {} });
  const prod = { env: "prod" as const, dataDir: "unused", backupOffsite: null, assistantToken: null, telegram: { botToken: BOT, chatId: "-1001" } };

  it("chat unset: no job, rows stored, the existing chat_absent error once", () => {
    const ledger = payoutLedger();
    const { logger, lines } = memoryLogger();
    expect(ownerJobs({ config: prod, logger, ...base(ledger) }).map((j) => j.name)).toEqual(["backup", "health", "linkRequestStuck", "alertDelivery"]);
    expect(lines.filter((l) => l.includes('"level":50') && l.includes("orders.business_notice.chat_absent"))).toHaveLength(1);
    record(ledger, batch());
    expect(noticeRows(ledger).map((n) => n.delivery)).toEqual(["PENDING"]);
  });

  it("the job posts to the business chat, never to the owner's", async () => {
    const ledger = payoutLedger();
    record(ledger, batch());
    const chats: string[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: { body: string }) => {
      chats.push((JSON.parse(init.body) as { chat_id: string }).chat_id);
      return { ok: true, status: 200 };
    });
    const job = ownerJobs({ config: { ...prod, telegramBusinessChatId: "-1009" }, logger: memoryLogger().logger, ...base(ledger) }).find((j) => j.name === "settlementBusinessNotices");
    await job?.run(new AbortController().signal);
    expect(chats).toEqual(["-1009"]);
  });
});
