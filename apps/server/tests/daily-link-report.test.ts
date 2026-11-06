/**
 * D66: the daily link report to the DP Business group, from
 * _bmad-output/implementation-artifacts/spec-operations-daily-link-report.md. Requests are written
 * directly at the times each case needs. Telegram is always a fake sender here.
 */
import { fixedClock, type LinkRequestStatus } from "@cashback/core";
import LABELS from "@cashback/labels/vi/link-report.json" with { type: "json" };
import { afterEach, describe, expect, it, vi } from "vitest";

import { ownerJobs } from "../src/health/owner-jobs";
import { assistantHeartbeats, deliverDailyLinkReport, ledgerAlerts, splitReportBlocks, TELEGRAM_TEXT_MAX, type AlertSender } from "../src/modules/operations/index";
import type { Ledger } from "../src/platform/db/ledger";
import { C1, C2, linkLedger, memoryLogger, movingClock, SILENT } from "./helpers/link-ledger";
import { tempDir } from "./helpers/live-fixture";

const ledgers: Ledger[] = [];
afterEach(() => {
  vi.unstubAllGlobals();
  for (const l of ledgers.splice(0)) l.close();
});

/** 07:00 on 6 Nov in Vietnam; "yesterday" is 5 Nov, 2026-11-04T17:00Z to 2026-11-05T17:00Z. */
const AT_SEVEN = "2026-11-06T00:00:00.000Z";
const YESTERDAY = "2026-11-05T03:00:00.000Z";
const FIVE_MINUTES = 5 * 60_000;
const DAY = 24 * 60 * 60_000;

let nextId = 0;
interface RequestFacts {
  customer?: string;
  status?: LinkRequestStatus;
  at?: string;
  name?: string | null;
  url?: string;
  origin?: "REQUEST" | "CUTOVER";
}
function request(ledger: Ledger, facts: RequestFacts = {}): void {
  const { customer = C1, status = "DELIVERED", at = YESTERDAY, name = "Ao thun", url = `https://shopee.vn/product/1/${++nextId}`, origin = "REQUEST" } = facts;
  ledger.sqlite
    .prepare("INSERT INTO link_requests (request_id, customer_id, platform, status, source_url, product_name, created_at, origin) VALUES (?, ?, 'shopee', ?, ?, ?, ?, ?)")
    .run(`R${++nextId}`, customer, status, url, name, at, origin);
}

function fixture(at = AT_SEVEN) {
  const ledger = linkLedger(ledgers);
  const clock = movingClock(at);
  const sent: string[] = [];
  let failing: (() => boolean) | null = null;
  const sender: AlertSender = {
    send: async (text) => {
      if (failing?.()) throw Object.assign(new Error("telegram: HTTP 429"), { status: 429 });
      sent.push(text);
    },
  };
  const { logger, lines } = memoryLogger();
  const alerts = ledgerAlerts(ledger, clock, logger);
  return { ledger, clock, sent, sender, logger, alerts, lines, run: () => deliverDailyLinkReport(ledger, sender, clock, logger, alerts), failWhen: (when: (() => boolean) | null) => void (failing = when) };
}

const reportRows = (ledger: Ledger) => ledger.sqlite.prepare("SELECT report_date AS date, parts, parts_sent AS partsSent, sent_at AS sentAt FROM daily_link_reports ORDER BY report_date").all() as { date: string; parts: string | null; partsSent: number; sentAt: string | null }[];
const setName = (ledger: Ledger, id: string, name: string) => ledger.sqlite.prepare("UPDATE customers SET display_name = ? WHERE customer_id = ?").run(name, id);
const totals = (products: number, customers: number) => LABELS.line_products.replace("{products}", String(products)).replace("{customers}", String(customers));
const customerLine = (customer: string, products: number, succeeded: number, failed: number, waiting = 0) =>
  LABELS.line_customer
    .replace("{customer}", customer)
    .replace("{products}", String(products))
    .replace("{succeeded}", String(succeeded))
    .replace("{failed}", String(failed))
    .replace("{waiting}", waiting === 0 ? "" : LABELS.customer_waiting.replace("{count}", String(waiting)));
const failedLine = (product: string) => LABELS.line_failed_product.replace("{product}", product);

describe("a normal day", () => {
  it("gives the totals, then customers by most requests, with their failed product names", async () => {
    const f = fixture();
    setName(f.ledger, C1, "Lan");
    setName(f.ledger, C2, "Minh");
    request(f.ledger, { customer: C1, status: "DELIVERED" });
    request(f.ledger, { customer: C2, status: "DELIVERED" });
    request(f.ledger, { customer: C2, status: "CONVERTED" });
    request(f.ledger, { customer: C2, status: "FAILED", name: "Giay" });
    request(f.ledger, { customer: C2, status: "QUEUED" });
    request(f.ledger, { customer: C2, status: "ISSUED" });
    await f.run();
    expect(f.sent).toHaveLength(1);
    const lines = (f.sent[0] ?? "").split("\n");
    expect(lines[0]).toContain("05/11/2026");
    expect(f.sent[0]).toContain(totals(6, 2));
    expect(f.sent[0]).toContain(LABELS.line_succeeded.replace("{count}", "3"));
    expect(f.sent[0]).toContain(LABELS.line_failed.replace("{count}", "1"));
    expect(f.sent[0]).toContain(LABELS.line_waiting.replace("{count}", "2"));
    const minh = lines.findIndex((l) => l.includes(`Minh (ID: ${C2})`));
    const lan = lines.findIndex((l) => l.includes(`Lan (ID: ${C1})`));
    expect(minh).toBeGreaterThan(0);
    expect(lan).toBeGreaterThan(minh);
    expect(lines[minh]).toBe(customerLine(`Minh (ID: ${C2})`, 5, 2, 1, 2));
    expect(lines[minh + 1]).toBe(failedLine("Giay"));
    // No waiting request, no waiting words.
    expect(lines[lan]).toBe(customerLine(`Lan (ID: ${C1})`, 1, 1, 0));
    expect(lines[lan]).not.toContain(LABELS.customer_waiting.replace("{count}", "0"));
  });

  it("counts only requests the platform took itself, and by the status when the report is written", async () => {
    const f = fixture();
    request(f.ledger, { origin: "CUTOVER", status: "FAILED", name: "Imported" });
    request(f.ledger, { status: "QUEUED" });
    await f.run();
    expect(f.sent[0]).toContain(totals(1, 1));
    expect(f.sent[0]).toContain(LABELS.line_waiting.replace("{count}", "1"));
    expect(f.sent[0]).not.toContain("Imported");
  });

  it("escapes names and products, keeps them on one line, and logs counts only", async () => {
    const f = fixture();
    const lineSeparator = String.fromCodePoint(0x2028);
    setName(f.ledger, C1, `Lan 2089 <b>\nFAKE${lineSeparator}& co`);
    request(f.ledger, { status: "FAILED", name: "Giay <i>" });
    await f.run();
    expect(f.sent[0]).toContain(`Lan 2089 &lt;b&gt; FAKE &amp; co (ID: ${C1})`);
    expect(f.sent[0]).toContain("Giay &lt;i&gt;");
    expect(f.lines.join("\n")).not.toMatch(/Lan|Giay|FAKE/);
    expect(f.lines.join("\n")).not.toContain(C1);
  });

  it("clears the stored names once sent", async () => {
    const f = fixture();
    setName(f.ledger, C1, "Lan");
    request(f.ledger);
    await f.run();
    expect(reportRows(f.ledger)).toEqual([{ date: "2026-11-05", parts: null, partsSent: 1, sentAt: AT_SEVEN }]);
  });

  it("a merged record counts under its survivor, on one line", async () => {
    const f = fixture();
    setName(f.ledger, C1, "Lan");
    f.ledger.sqlite.prepare("UPDATE customers SET status = 'MERGED' WHERE customer_id = ?").run(C2);
    f.ledger.sqlite.prepare("INSERT INTO customer_aliases (alias, customer_id, created_at) VALUES (?, ?, ?)").run(C2, C1, YESTERDAY);
    request(f.ledger, { customer: C1, status: "FAILED", name: "Giay" });
    request(f.ledger, { customer: C2, status: "FAILED", name: "Mu" });
    request(f.ledger, { customer: C2, status: "DELIVERED" });
    await f.run();
    expect(f.sent[0]).toContain(totals(3, 1));
    expect(f.sent[0]).toContain([customerLine(`Lan (ID: ${C1})`, 3, 1, 2), failedLine("Giay"), failedLine("Mu")].join("\n"));
    expect(f.sent[0]).not.toContain(C2);
  });
});

describe("the edges of a report", () => {
  it("a quiet day is a short report", async () => {
    const f = fixture();
    await f.run();
    expect(f.sent).toEqual([`${LABELS.header.replace("{date}", "05/11/2026")}\n${LABELS.quiet}`]);
  });

  it("a request with no product name stands on its source link", async () => {
    const f = fixture();
    request(f.ledger, { status: "FAILED", name: null, url: "https://shopee.vn/product/7/8?a=1&b=2" });
    await f.run();
    expect(f.sent[0]).toContain("https://shopee.vn/product/7/8?a=1&amp;b=2");
  });

  it("a product name of control characters only stands on its source link, with no blank line", async () => {
    const f = fixture();
    request(f.ledger, { status: "FAILED", name: "\n\t\r", url: "https://shopee.vn/product/9/9" });
    await f.run();
    expect(f.sent[0]).toContain(failedLine("https://shopee.vn/product/9/9"));
  });

  it("a customer the ledger cannot resolve is the id alone, without a stored name or the products", async () => {
    const f = fixture();
    setName(f.ledger, C1, "Stored");
    // A merged record with no survivor: `ledgerOwnerOf` finds nobody.
    f.ledger.sqlite.prepare("UPDATE customers SET status = 'MERGED' WHERE customer_id = ?").run(C1);
    request(f.ledger, { customer: C1, status: "FAILED", name: "Hidden" });
    await f.run();
    expect(f.sent[0]).toContain(customerLine(LABELS.customer_id.replace("{id}", C1), 1, 0, 1));
    expect(f.sent[0]).not.toMatch(/Stored|Hidden/);
  });

  it("a value is cut to exactly 200 code points, before escaping, and never leaves a broken entity", async () => {
    const f = fixture();
    const emoji = String.fromCodePoint(0x1f600);
    setName(f.ledger, C1, emoji.repeat(300));
    request(f.ledger, { customer: C1, status: "FAILED", name: `a${"&".repeat(300)}` });
    await f.run();
    expect(f.sent[0]).toContain(`${emoji.repeat(200)} (ID: ${C1})`);
    expect(f.sent[0]).not.toContain(emoji.repeat(201));
    expect(f.sent[0]).toContain(failedLine(`a${"&amp;".repeat(199)}`));
    expect(f.sent[0]).not.toMatch(/&(?!amp;|lt;|gt;)/);
  });

  it("a value whose escaped text is over 4,096 characters stays within the limit", async () => {
    const f = fixture();
    const name = "&".repeat(1000);
    expect(name.replaceAll("&", "&amp;").length).toBeGreaterThan(TELEGRAM_TEXT_MAX);
    setName(f.ledger, C1, name);
    request(f.ledger, { customer: C1, status: "FAILED", name });
    await f.run();
    for (const part of f.sent) expect(part.length).toBeLessThanOrEqual(TELEGRAM_TEXT_MAX);
    expect(f.sent.join("\n")).toContain(`(ID: ${C1})`);
  });

  it("a web guest is a guest line, and a customer with no name the id alone", async () => {
    const f = fixture();
    request(f.ledger, { customer: "HOUSE", status: "FAILED", name: "Mu" });
    request(f.ledger, { customer: C2 });
    await f.run();
    expect(f.sent[0]).toContain(`${LABELS.customer_guest}:`);
    expect(f.sent[0]).not.toContain("HOUSE");
    expect(f.sent[0]).toContain("Mu");
    expect(f.sent[0]).toContain(LABELS.customer_id.replace("{id}", C2));
  });

  it("an erased customer is the id alone, without the products", async () => {
    const f = fixture();
    f.ledger.sqlite.prepare("UPDATE customers SET status = 'ERASED', erased_at = ?, display_name = NULL WHERE customer_id = ?").run(YESTERDAY, C1);
    request(f.ledger, { customer: C1, status: "FAILED", name: "Hidden" });
    await f.run();
    expect(f.sent[0]).toContain(LABELS.customer_id.replace("{id}", C1));
    expect(f.sent[0]).not.toContain("Hidden");
  });

  it("a request at 23:59 and one at 00:01 Vietnam time each count on their own day", async () => {
    const f = fixture();
    setName(f.ledger, C1, "Late");
    setName(f.ledger, C2, "Early");
    request(f.ledger, { customer: C1, at: "2026-11-05T16:59:00.000Z" }); // 23:59 on 5 Nov
    request(f.ledger, { customer: C2, at: "2026-11-05T17:01:00.000Z" }); // 00:01 on 6 Nov
    await f.run();
    expect(f.sent[0]).toContain("05/11/2026");
    expect(f.sent[0]).toContain("Late");
    expect(f.sent[0]).not.toContain("Early");
    f.clock.advance(DAY);
    await f.run();
    expect(f.sent[1]).toContain("06/11/2026");
    expect(f.sent[1]).toContain("Early");
    expect(f.sent[1]).not.toContain("Late");
  });
});

describe("once a day, from 07:00 Vietnam time", () => {
  it("sends nothing at 06:59 and writes no row", async () => {
    const f = fixture("2026-11-05T23:59:00.000Z");
    request(f.ledger);
    await f.run();
    expect(f.sent).toEqual([]);
    expect(reportRows(f.ledger)).toEqual([]);
    f.clock.advance(60_000);
    await f.run();
    expect(f.sent).toHaveLength(1);
  });

  it("a server down at 07:00 reports at its next run", async () => {
    const f = fixture("2026-11-06T02:00:00.000Z");
    request(f.ledger);
    await f.run();
    expect(f.sent).toHaveLength(1);
  });

  it("given a restart after a report was sent, nothing is sent again that day", async () => {
    const f = fixture();
    request(f.ledger);
    await f.run();
    // A restart keeps nothing in memory: fresh runs over the same ledger.
    for (let i = 0; i < 5; i++) {
      f.clock.advance(FIVE_MINUTES);
      expect(await deliverDailyLinkReport(f.ledger, { send: async (text) => void f.sent.push(text) }, f.clock, SILENT, f.alerts)).toEqual({ sent: 0, failed: 0 });
    }
    expect(f.sent).toHaveLength(1);
  });

  it("a failed send is retried on the next run, with the text first written", async () => {
    const f = fixture();
    request(f.ledger, { status: "QUEUED" });
    f.failWhen(() => true);
    expect(await f.run()).toEqual({ sent: 0, failed: 1 });
    expect(f.lines.some((l) => l.includes("delivery_failed") && l.includes('"status":429'))).toBe(true);
    // The request moves on, the stored text does not.
    f.ledger.sqlite.prepare("UPDATE link_requests SET status = 'DELIVERED'").run();
    f.failWhen(null);
    f.clock.advance(FIVE_MINUTES);
    expect(await f.run()).toEqual({ sent: 1, failed: 0 });
    expect(f.sent[0]).toContain(LABELS.line_waiting.replace("{count}", "1"));
  });

  it("a failed send raises the owner alert, high, with no personal data, its repeats counted under the cooldown", async () => {
    const f = fixture();
    setName(f.ledger, C1, "Lan");
    request(f.ledger);
    f.failWhen(() => true);
    await f.run();
    f.clock.advance(FIVE_MINUTES);
    await f.run();
    expect(f.ledger.sqlite.prepare("SELECT kind, severity, suppressed, detail, delivery FROM alerts").all()).toEqual([{ kind: "daily_link_report_failed", severity: "high", suppressed: 1, detail: null, delivery: "PENDING" }]);
  });

  it("a sent report raises no alert", async () => {
    const f = fixture();
    await f.run();
    expect(f.ledger.sqlite.prepare("SELECT count(*) AS n FROM alerts").get()).toEqual({ n: 0 });
  });

  it("a day never sent is dropped with its names, logged, and only the latest yesterday goes", async () => {
    const f = fixture();
    setName(f.ledger, C1, "Lan");
    request(f.ledger);
    f.failWhen(() => true);
    await f.run();
    expect(reportRows(f.ledger)[0]?.parts).toContain("Lan");
    f.failWhen(null);
    f.clock.advance(DAY);
    await f.run();
    expect(f.sent).toHaveLength(1);
    expect(f.sent[0]).toContain("06/11/2026");
    expect(reportRows(f.ledger).map((r) => [r.date, r.parts, r.sentAt === null])).toEqual([
      ["2026-11-05", null, true],
      ["2026-11-06", null, false],
    ]);
    expect(f.lines.some((l) => l.includes("earlier_days_skipped") && l.includes('"unsent":1') && l.includes('"missed":0'))).toBe(true);
  });

  it("days with no report at all are logged and not made up; no backfill on the first run", async () => {
    const f = fixture();
    request(f.ledger, { at: "2026-11-01T03:00:00.000Z" });
    await f.run();
    expect(reportRows(f.ledger).map((r) => r.date)).toEqual(["2026-11-05"]);
    expect(f.lines.some((l) => l.includes("earlier_days_skipped"))).toBe(false);
    f.clock.advance(3 * DAY);
    await f.run();
    expect(reportRows(f.ledger).map((r) => r.date)).toEqual(["2026-11-05", "2026-11-08"]);
    expect(f.lines.some((l) => l.includes("earlier_days_skipped") && l.includes('"unsent":0') && l.includes('"missed":2'))).toBe(true);
  });
});

describe("a long report", () => {
  /** Enough customers to fill several messages; the names need escaping, so they are at their longest. */
  function longDay(f: ReturnType<typeof fixture>, customers: number) {
    const insert = f.ledger.sqlite.prepare("INSERT INTO customers (customer_id, customer_code, role, status, display_name) VALUES (?, ?, 'USER', 'ACTIVE', ?)");
    const ids = Array.from({ length: customers }, (_, i) => `9${String(i).padStart(4, "0")}`);
    for (const id of ids) {
      insert.run(id, `DQ${id}`, "&".repeat(300));
      request(f.ledger, { customer: id, status: "FAILED", name: "<".repeat(300) });
    }
    return ids;
  }

  it("splits at line breaks under the limit, keeps every customer, and breaks no tag or entity", async () => {
    const f = fixture();
    const ids = longDay(f, 40);
    await f.run();
    expect(f.sent.length).toBeGreaterThan(1);
    for (const part of f.sent) {
      expect(part.length).toBeLessThanOrEqual(TELEGRAM_TEXT_MAX);
      expect(part.match(/<b>/g)?.length).toBe(part.match(/<\/b>/g)?.length);
      // Every ampersand starts a whole entity.
      expect(part).not.toMatch(/&(?!amp;|lt;|gt;)/);
    }
    const all = f.sent.join("\n");
    for (const id of ids) expect(all).toContain(`(ID: ${id})`);
    expect(f.lines.join("\n")).not.toContain("&amp;");
  });

  it("a retry resumes at the unsent part, in order, none repeated", async () => {
    const f = fixture();
    longDay(f, 40);
    let tries = 0;
    f.failWhen(() => ++tries === 2);
    expect(await f.run()).toEqual({ sent: 1, failed: 1 });
    const first = reportRows(f.ledger)[0];
    expect(first?.partsSent).toBe(1);
    const stored = JSON.parse(first?.parts ?? "[]") as string[];
    expect(stored.length).toBeGreaterThan(2);
    f.clock.advance(FIVE_MINUTES);
    await f.run();
    expect(f.sent).toEqual(stored);
    expect(reportRows(f.ledger)[0]).toMatchObject({ parts: null, partsSent: stored.length });
  });

  it("a split keeps a customer with its failed products", async () => {
    const f = fixture();
    const insert = f.ledger.sqlite.prepare("INSERT INTO customers (customer_id, customer_code, role, status, display_name) VALUES (?, ?, 'USER', 'ACTIVE', ?)");
    for (let i = 0; i < 12; i++) {
      const id = `8${String(i).padStart(4, "0")}`;
      insert.run(id, `DQ${id}`, `Khach ${id}`);
      for (const n of [1, 2, 3]) request(f.ledger, { customer: id, status: "FAILED", name: `${id}-${n}${"<".repeat(150)}` });
    }
    await f.run();
    expect(f.sent.length).toBeGreaterThan(1);
    for (let i = 0; i < 12; i++) {
      const id = `8${String(i).padStart(4, "0")}`;
      const home = f.sent.filter((part) => part.includes(`(ID: ${id})`));
      expect(home).toHaveLength(1);
      for (const n of [1, 2, 3]) expect(home[0]).toContain(`${id}-${n}`);
    }
    for (const part of f.sent) expect(part.length).toBeLessThanOrEqual(TELEGRAM_TEXT_MAX);
  });

  it("a block that alone is over the limit splits between its lines, with nothing lost", () => {
    expect(splitReportBlocks([["aaa", "bbb"], ["cc", "dd"]], 7)).toEqual(["aaa\nbbb", "cc\ndd"]);
    expect(splitReportBlocks([["x"], ["aaaa", "bbbb", "cccc"], ["y"]], 9)).toEqual(["x\naaaa", "bbbb\ncccc", "y"]);
  });

  it("the splitter drops a blank line at a message's edge", () => {
    expect(splitReportBlocks([["aaaa"], [""], ["bbbb"]], 5)).toEqual(["aaaa", "bbbb"]);
    expect(splitReportBlocks([["aa"], [""], ["bb"]], 10)).toEqual(["aa\n\nbb"]);
    expect(splitReportBlocks([])).toEqual([]);
  });

  it("when the count cannot be written: three tries, then lost, no further part that run, and the next run resumes from the stored count", async () => {
    const f = fixture();
    longDay(f, 40);
    let broken = false;
    const flaky: Pick<Ledger, "tx"> = {
      tx: (fn) => {
        if (broken) throw new Error("disk full");
        return f.ledger.tx(fn);
      },
    };
    const failingAfterSend: AlertSender = {
      send: async (text) => {
        await f.sender.send(text);
        broken = true;
      },
    };
    expect(await deliverDailyLinkReport(flaky, failingAfterSend, f.clock, f.logger, f.alerts)).toEqual({ sent: 1, failed: 0 });
    expect(f.lines.filter((l) => l.includes("operations.daily_link_report.bookkeeping_failed"))).toHaveLength(3);
    expect(f.lines.filter((l) => l.includes("operations.daily_link_report.bookkeeping_lost"))).toHaveLength(1);
    expect(f.sent).toHaveLength(1);
    const row = reportRows(f.ledger)[0];
    expect(row?.partsSent).toBe(0);
    const stored = JSON.parse(row?.parts ?? "[]") as string[];
    expect(stored.length).toBeGreaterThan(1);
    broken = false;
    await f.run();
    // The uncounted first part goes once more, then the rest in order.
    expect(f.sent).toEqual([stored[0], ...stored]);
    expect(reportRows(f.ledger)[0]).toMatchObject({ parts: null, partsSent: stored.length });
  });
});

describe("wiring", () => {
  const base = { env: "prod" as const, backupOffsite: null, assistantToken: null, telegram: { botToken: "1:token", chatId: "-1001" } };
  const jobsOf = (ledger: Ledger, config: typeof base & { telegramBusinessChatId?: string }, logger = SILENT) => ownerJobs({ config: { ...config, dataDir: tempDir("cashback-link-report-") }, ledger, clock: fixedClock(AT_SEVEN), logger, heartbeats: assistantHeartbeats(null), health: {} });

  it("with the business chat the job runs every 5 minutes", () => {
    const f = fixture();
    const job = jobsOf(f.ledger, { ...base, telegramBusinessChatId: "-1009" }).find((j) => j.name === "dailyLinkReport");
    expect(job?.schedule).toEqual({ kind: "every", delayMs: FIVE_MINUTES });
  });

  it("the job from ownerJobs posts to the business chat, never the owner's", async () => {
    const f = fixture();
    request(f.ledger);
    const posted: { url: string; chatId: unknown }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: { body: string }) => {
      posted.push({ url, chatId: (JSON.parse(init.body) as { chat_id: unknown }).chat_id });
      return { ok: true, status: 200 };
    });
    const job = jobsOf(f.ledger, { ...base, telegramBusinessChatId: "-1009" }).find((j) => j.name === "dailyLinkReport");
    await job?.run(new AbortController().signal);
    expect(posted).toEqual([{ url: "https://api.telegram.org/bot1:token/sendMessage", chatId: "-1009" }]);
  });

  it("chat unset: no job, and the existing chat_absent error", () => {
    const f = fixture();
    const { logger, lines } = memoryLogger();
    expect(jobsOf(f.ledger, base, logger).map((j) => j.name)).not.toContain("dailyLinkReport");
    expect(lines.filter((l) => l.includes('"level":50') && l.includes("orders.business_notice.chat_absent"))).toHaveLength(1);
  });
});
