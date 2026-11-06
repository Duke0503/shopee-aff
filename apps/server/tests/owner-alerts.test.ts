/**
 * Story 8.3: Telegram owner alerts and one health model. Stored alerts go to Telegram with the
 * AD-27 cooldowns (critical 5 min, high 15, warning 30), as the owner's text from
 * packages/labels/vi/alerts.json; the health check and the Overview read the same health model.
 * Telegram is always a fake fetch here: no test reaches the network.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { instantFromMs, toMs, type Instant } from "@cashback/core";
import ALERT_LABELS from "@cashback/labels/vi/alerts.json" with { type: "json" };
import { afterEach, describe, expect, it } from "vitest";

import { overviewOf } from "../src/admin/overview.query";
import { healthSourcesFor, ownerJobs, startupAlerts } from "../src/health/owner-jobs";
import { holdShopeeQueue, pauseShopeeQueue } from "../src/modules/linking/index";
import {
  ALERT_COOLDOWN_MS,
  alertsFor,
  assistantHeartbeats,
  ALERTS_PER_RUN,
  deliverPendingAlerts,
  hasAlertLabel,
  healthCheck,
  immediateAlerts,
  ledgerAlerts,
  readHealthModel,
  telegramSender,
  telegramText,
  withoutAlerts,
  type AlertSender,
  type FetchLike,
} from "../src/modules/operations/index";
import { backupStatusPath, NO_BACKUP_YET, writeBackupStatus } from "../src/platform/backup/backup-status";
import { REPOSITORY_ROOT } from "../src/platform/config/env.config";
import { ALERT_SEVERITIES, type AlertSeverity } from "../src/platform/ports/alert.port";
import { alertRows, memoryLogger } from "./helpers/link-ledger";
import { tempDir } from "./helpers/live-fixture";
import { closeLedgers, freshLedger, movingClock } from "./helpers/order-ledger";

afterEach(closeLedgers);

/** Made-up values, never a real bot token or chat. */
const BOT_TOKEN = "123456789:FAKE-test-token-never-real";
const CHAT_ID = "-100200300400";
const START = "2026-11-02T01:00:00.000Z";
const LABELS = ALERT_LABELS as unknown as Readonly<Record<string, string>> & { readonly kinds: Readonly<Record<string, { title: string; details: string; source?: string; action?: string; badge?: string }>> };
const OLD_TELEGRAM = JSON.parse(readFileSync(join(import.meta.dirname, "fixtures", "old-telegram-alerts.json"), "utf8")) as { raisedAt: string; texts: Record<string, string> };

/** The texts the stored alerts make, each stamped with the time it was raised. */
function storedTexts(ledger: ReturnType<typeof freshLedger>): string[] {
  const rows = ledger.sqlite.prepare("SELECT kind, severity, suppressed, raised_at AS raisedAt FROM alerts ORDER BY id").all() as { kind: string; severity: AlertSeverity; suppressed: number; raisedAt: string }[];
  return rows.map((row) => telegramText(row));
}

function fakeTelegram() {
  const bodies: { chat_id: string; text: string }[] = [];
  const urls: string[] = [];
  const fetch: FetchLike = async (url, init) => {
    urls.push(url);
    bodies.push(JSON.parse(init.body) as { chat_id: string; text: string });
    return { ok: true, status: 200 };
  };
  return { sender: telegramSender({ botToken: BOT_TOKEN, chatId: CHAT_ID, fetch }), bodies, urls };
}

/** Every alert kind the server raises, read from its source: `kind: "x", severity: "y"`, `.alert("x", "y")` and the order effect `alert: "x"`. */
function raisedKinds(): Map<string, string> {
  const kinds = new Map<string, string>();
  const dir = join(REPOSITORY_ROOT, "apps", "server", "src");
  for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".ts")) continue;
    const text = readFileSync(join(entry.parentPath, entry.name), "utf8");
    for (const m of text.matchAll(/kind: "([a-z_]+)", severity: "(critical|high|warning)"/g)) kinds.set(m[1] as string, m[2] as string);
    for (const m of text.matchAll(/\.alert\("([a-z_]+)", "(critical|high|warning)"\)/g)) kinds.set(m[1] as string, m[2] as string);
    for (const m of text.matchAll(/kind: "alert"; readonly alert: "([a-z_]+)"/g)) kinds.set(m[1] as string, "high");
  }
  return kinds;
}

describe("Story 8.3: Telegram owner alerts with cooldowns", () => {
  it("AC1: given a critical alert repeated 3 times in 4 minutes, when it is delivered, then Telegram receives one message", async () => {
    const ledger = freshLedger();
    const clock = movingClock(START);
    const { logger } = memoryLogger();
    const telegram = fakeTelegram();
    const alerts = ledgerAlerts(ledger, clock);
    for (let i = 0; i < 3; i++) {
      if (i > 0) clock.advance(2 * 60_000);
      alerts.alert("bridge_login_lost", "critical");
      await deliverPendingAlerts(ledger, telegram.sender, clock, logger);
    }
    expect(telegram.bodies).toHaveLength(1);
    // The repeats wait for the cooldown's end, then go out once with their count.
    expect(alertRows(ledger)).toEqual([
      { kind: "bridge_login_lost", severity: "critical", suppressed: 0 },
      { kind: "bridge_login_lost", severity: "critical", suppressed: 1 },
    ]);
    clock.advance(60_000);
    await deliverPendingAlerts(ledger, telegram.sender, clock, logger);
    expect(telegram.bodies.map((b) => b.text)).toEqual(storedTexts(ledger));
  });

  it("cooldowns: critical 5 minutes, high 15, warning 30, counted from the last alert sent, and a FAILED one never silences the next", async () => {
    expect(ALERT_COOLDOWN_MS).toEqual({ critical: 5 * 60_000, high: 15 * 60_000, warning: 30 * 60_000 });
    for (const severity of ALERT_SEVERITIES) {
      const ledger = freshLedger();
      const clock = movingClock(START);
      const { logger } = memoryLogger();
      const telegram = fakeTelegram();
      const alerts = ledgerAlerts(ledger, clock);
      const deliver = () => deliverPendingAlerts(ledger, telegram.sender, clock, logger);
      alerts.alert("backup_failed", severity);
      await deliver();
      clock.advance(ALERT_COOLDOWN_MS[severity] - 1);
      alerts.alert("backup_failed", severity);
      await deliver();
      expect(telegram.bodies).toHaveLength(1);
      clock.advance(1);
      await deliver();
      expect(telegram.bodies).toHaveLength(2);
      ledger.sqlite.exec("UPDATE alerts SET delivery = 'FAILED' WHERE id = (SELECT max(id) FROM alerts)");
      clock.advance(1_000);
      alerts.alert("backup_failed", severity);
      await deliver();
      expect(telegram.bodies).toHaveLength(3);
    }
  });

  it("review 6: a second outage inside the cooldown after the alert was sent is delivered once the cooldown ends, with its repeat count", async () => {
    const ledger = freshLedger();
    const clock = movingClock(START);
    const { logger } = memoryLogger();
    const telegram = fakeTelegram();
    const alerts = ledgerAlerts(ledger, clock);
    alerts.alert("assistant_down", "critical");
    await deliverPendingAlerts(ledger, telegram.sender, clock, logger);
    clock.advance(60_000);
    alerts.alert("assistant_down", "critical");
    alerts.alert("assistant_down", "critical");
    expect(ledger.sqlite.prepare("SELECT delivery, suppressed, not_before FROM alerts ORDER BY id").all()).toEqual([
      { delivery: "SENT", suppressed: 0, not_before: null },
      { delivery: "PENDING", suppressed: 1, not_before: "2026-11-02T01:05:00.000Z" },
    ]);
    await deliverPendingAlerts(ledger, telegram.sender, clock, logger);
    expect(telegram.bodies).toHaveLength(1);
    clock.advance(4 * 60_000);
    await deliverPendingAlerts(ledger, telegram.sender, clock, logger);
    expect(telegram.bodies.map((b) => b.text)).toEqual(storedTexts(ledger));
  });

  it("review 4: a first deploy skips pending alerts older than 24 hours with one log line, and one run sends at most 10", async () => {
    const ledger = freshLedger();
    const clock = movingClock(START);
    const { logger, lines } = memoryLogger();
    const telegram = fakeTelegram();
    for (let i = 0; i < 30; i++) ledger.sqlite.prepare("INSERT INTO alerts (kind, severity, raised_at) VALUES (?, 'warning', '2026-10-30T00:00:00.000Z')").run(`old_kind_${i}`);
    for (let i = 0; i < 12; i++) ledger.sqlite.prepare("INSERT INTO alerts (kind, severity, raised_at) VALUES (?, 'high', '2026-11-02T00:30:00.000Z')").run(`new_kind_${i}`);
    expect(await deliverPendingAlerts(ledger, telegram.sender, clock, logger)).toEqual({ sent: ALERTS_PER_RUN, failed: 0, expired: 30 });
    expect(lines.filter((l) => l.includes("operations.alert.older_alerts_skipped"))).toEqual([expect.stringContaining('"expired":30')]);
    expect(ledger.sqlite.prepare("SELECT delivery, count(*) AS n FROM alerts GROUP BY delivery ORDER BY delivery").all()).toEqual([
      { delivery: "EXPIRED", n: 30 },
      { delivery: "PENDING", n: 2 },
      { delivery: "SENT", n: 10 },
    ]);
    expect(await deliverPendingAlerts(ledger, telegram.sender, clock, logger)).toEqual({ sent: 2, failed: 0 });
    expect(telegram.bodies.some((b) => b.text.includes("old_kind"))).toBe(false);
    expect(lines.filter((l) => l.includes("operations.alert.older_alerts_skipped"))).toHaveLength(1);
  });

  it("AC3: given an alert text, when it is built, then it contains no personal data, bank number or token", async () => {
    const kinds = raisedKinds();
    expect(kinds.size).toBeGreaterThanOrEqual(20);
    expect([...kinds.keys()].filter((kind) => !hasAlertLabel(kind))).toEqual([]);
    for (const [kind, severity] of kinds) {
      for (const suppressed of [0, 3]) {
        const text = telegramText({ kind, severity: severity as AlertSeverity, suppressed, raisedAt: START });
        // Only the label file's words, the time and the repeat count: nothing filled in from the ledger.
        const label = LABELS.kinds[kind];
        const header = (LABELS[`header_${label?.badge ?? severity}`] as string).replace("{title}", label?.title ?? "");
        expect(text.startsWith(`${header}
`)).toBe(true);
        expect(text).toContain(label?.details ?? "-");
        expect(text).toContain((LABELS["line_time"] as string).replace("{time}", "08:00:00 - 02/11/2026"));
        expect(text.includes((LABELS["line_repeated"] as string).replace("{count}", "3"))).toBe(suppressed === 3);
        expect(text.replace(/<code>\d\d:\d\d:\d\d - \d\d\/\d\d\/\d{4}<\/code>/, "")).not.toMatch(/\d{4,}/);
        expect(text).not.toContain(kind);
      }
    }
    expect(telegramText({ kind: "brand_new_kind", severity: "warning", suppressed: 0, raisedAt: START })).toContain("brand_new_kind");
    // The request carries the chat and the text only; the token is only in the URL, never in the body.
    const ledger = freshLedger();
    const telegram = fakeTelegram();
    ledgerAlerts(ledger, movingClock(START)).alert("customer_sign_in_burst", "high");
    await deliverPendingAlerts(ledger, telegram.sender, movingClock(START), memoryLogger().logger);
    expect(telegram.bodies).toEqual([{ chat_id: CHAT_ID, text: telegramText({ kind: "customer_sign_in_burst", severity: "high", suppressed: 0, raisedAt: START }), parse_mode: "HTML", disable_web_page_preview: true }]);
    expect(JSON.stringify(telegram.bodies)).not.toContain(BOT_TOKEN);
  });

  it("message parity: an alert reads exactly as the live system's Telegram message (telegram_alerts.py report_bug, HTML)", () => {
    const at = OLD_TELEGRAM.raisedAt;
    expect(telegramText({ kind: "bridge_captcha", severity: "high", suppressed: 0, raisedAt: at })).toBe(OLD_TELEGRAM.texts["bridge_captcha"]);
    expect(telegramText({ kind: "bridge_login_lost", severity: "critical", suppressed: 0, raisedAt: at })).toBe(OLD_TELEGRAM.texts["bridge_login_lost"]);
    expect(telegramText({ kind: "brand_new_kind", severity: "warning", suppressed: 0, raisedAt: at })).toBe(OLD_TELEGRAM.texts["unknown_kind"]);
    // A repeat adds one line in the same format; every text is escaped for the HTML parse mode.
    expect(telegramText({ kind: "bridge_login_lost", severity: "critical", suppressed: 2, raisedAt: at })).toBe(`${OLD_TELEGRAM.texts["bridge_login_lost"] ?? ""}
${(LABELS["line_repeated"] as string).replace("{count}", "2")}`);
    expect(telegramText({ kind: "brand<b>&", severity: "warning", suppressed: 0, raisedAt: at })).toContain("brand&lt;b&gt;&amp;");
  });

  it("AC4: given Telegram unreachable, when an alert is due, then it is retried and the failure is logged, without blocking any command", async () => {
    const ledger = freshLedger();
    const clock = movingClock(START);
    const { logger, lines } = memoryLogger();
    let fail: (error: Error) => void = () => undefined;
    let calls = 0;
    const fetch: FetchLike = () => {
      calls++;
      if (calls === 1) return new Promise((_, reject) => (fail = reject));
      return Promise.resolve({ ok: true, status: 200 });
    };
    const sender = telegramSender({ botToken: BOT_TOKEN, chatId: CHAT_ID, fetch });
    ledgerAlerts(ledger, clock).alert("assistant_down", "critical");
    const delivering = deliverPendingAlerts(ledger, sender, clock, logger);
    await Promise.resolve();
    // While the send hangs, commands still commit.
    ledger.tx((db) => alertsFor(db, clock).alert("backup_failed", "high"));
    ledger.tx(() => ledger.sqlite.prepare("INSERT INTO customers (customer_id, customer_code, role, status) VALUES ('C9', 'DP00009', 'USER', 'ACTIVE')").run());
    expect(ledger.sqlite.prepare("SELECT delivery FROM alerts ORDER BY id").all()).toEqual([{ delivery: "SENDING" }, { delivery: "PENDING" }]);
    fail(new Error(`connect ETIMEDOUT https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`));
    expect(await delivering).toEqual({ sent: 0, failed: 1 });
    expect(ledger.sqlite.prepare("SELECT delivery, attempts FROM alerts WHERE id = 1").get()).toEqual({ delivery: "PENDING", attempts: 1 });
    const failed = lines.map((l) => JSON.parse(l) as Record<string, unknown>).filter((l) => l["msg"] === "operations.alert.delivery_failed");
    expect(failed).toEqual([expect.objectContaining({ alertId: 1, kind: "assistant_down" })]);
    expect(lines.join("\n")).not.toContain(BOT_TOKEN);
    expect(await deliverPendingAlerts(ledger, sender, clock, logger)).toEqual({ sent: 2, failed: 0 });
  });

  it("a start refused at its pre-migration backup sends the alert at once, and a failed send is logged, never thrown", async () => {
    const sent: string[] = [];
    const { logger, lines } = memoryLogger();
    const now = immediateAlerts({ send: async (text) => void sent.push(text) }, logger, movingClock(START));
    now.alert("backup_failed", "high");
    await now.settled();
    expect(sent).toEqual([telegramText({ kind: "backup_failed", severity: "high", suppressed: 0, raisedAt: START })]);
    const failing: AlertSender = { send: () => Promise.reject(new Error("offline")) };
    const broken = immediateAlerts(failing, logger, movingClock(START));
    broken.alert("backup_failed", "high");
    await broken.settled();
    expect(lines.some((l) => l.includes("operations.alert.delivery_failed"))).toBe(true);
    const silent = startupAlerts({ telegram: null }, logger, movingClock(START));
    silent.alert("backup_failed", "high");
    await silent.settled();
    expect(lines.some((l) => l.includes('"result":"not_sent"'))).toBe(true);
  });

  it("the delivery job runs only with a Telegram chat configured; production without one says so at every start", () => {
    const ledger = freshLedger();
    const clock = movingClock(START);
    const heartbeats = assistantHeartbeats(null);
    const base = { env: "prod" as const, dataDir: tempDir("cashback-owner-"), backupOffsite: null, assistantToken: null };
    const { logger, lines } = memoryLogger();
    expect(ownerJobs({ config: { ...base, telegram: null }, ledger, clock, logger, heartbeats, health: healthSourcesFor({ ...base, telegram: null }, heartbeats) }).map((j) => j.name)).toEqual(["backup", "health", "linkRequestStuck"]);
    expect(lines.some((l) => l.includes('"level":50') && l.includes("operations.alert.telegram_absent"))).toBe(true);
    expect(ownerJobs({ config: { ...base, telegram: { botToken: BOT_TOKEN, chatId: CHAT_ID } }, ledger, clock, logger, heartbeats, health: {} }).map((j) => j.name)).toEqual(["backup", "health", "linkRequestStuck", "alertDelivery"]);
    expect(ownerJobs({ config: { ...base, telegram: { botToken: BOT_TOKEN, chatId: CHAT_ID }, telegramBusinessChatId: "-1009" }, ledger, clock, logger, heartbeats, health: {} }).map((j) => j.name)).toEqual(["backup", "health", "linkRequestStuck", "alertDelivery", "orderBusinessNotices", "settlementBusinessNotices", "dailyLinkReport"]);
  });

  it("the runbook's alert table lists every alert kind with its severity", () => {
    const runbook = readFileSync(join(REPOSITORY_ROOT, "docs", "operations", "backup-and-alerts-runbook.md"), "utf8");
    const missing = [...raisedKinds()].filter(([kind, severity]) => !new RegExp(`^\\| \`${kind}\` \\| ${severity} \\|`, "m").test(runbook));
    expect(missing).toEqual([]);
  });
});

describe("Story 8.3: one health model", () => {
  function downEverywhere() {
    const ledger = freshLedger();
    const clock = movingClock(START);
    const dataDir = tempDir("cashback-health-");
    const heartbeats = assistantHeartbeats(instantFromMs(toMs(START as Instant) - 10 * 60_000));
    const now = clock.now();
    ledger.tx((db) => pauseShopeeQueue(db, "login_redirect", now));
    ledger.sqlite.exec(`INSERT INTO link_requests (request_id, customer_id, network, platform, status, source_url, origin, created_at) VALUES ('REQW', 'C1', 'accesstrade', 'lazada', 'QUEUED', 'https://lazada.vn/p/9', 'REQUEST', '2026-11-02T00:45:00.000Z')`);
    writeBackupStatus(backupStatusPath(dataDir), { ...NO_BACKUP_YET, lastGoodAt: "2026-11-01T20:00:00.000Z" as Instant, lastRunAt: "2026-11-01T20:00:00.000Z" as Instant, lastOutcome: "offsite_failed", failedStep: "upload" });
    const sources = healthSourcesFor({ env: "prod", dataDir, telegram: null, backupOffsite: null, assistantToken: "a".repeat(40) }, heartbeats);
    const check = healthCheck({ model: () => readHealthModel(ledger, clock, sources), alerts: ledgerAlerts(ledger, clock), clock, heartbeats });
    const overview = () => overviewOf(ledger.db, { period: "today" }, clock, sources).health;
    return { ledger, clock, dataDir, heartbeats, check, overview };
  }

  it("AC2: given a component down in the health model, when the Overview loads, then it shows the same state the alert reported", () => {
    const h = downEverywhere();
    const { model, raised } = h.check.run();
    expect(h.overview()).toEqual(withoutAlerts(model));
    const down = h.overview().filter((e) => e.state === "down");
    expect(down.map((e) => e.component)).toEqual(["bridge", "assistant", "backup", "queue"]);
    // No restore drill recorded in the data folder: the drill is due, a reminder with its own alert (Story 8.6).
    expect(h.overview().find((e) => e.component === "drill")).toEqual({ component: "drill", state: "due", at: null });
    expect(raised.map((a) => a?.kind)).toEqual(["bridge_login_lost", "assistant_down", "backup_offsite_failed", "link_queue_stuck", "restore_drill_due"]);
    expect(alertRows(h.ledger).map((a) => a.kind)).toEqual(["bridge_login_lost", "assistant_down", "backup_offsite_failed", "link_queue_stuck", "restore_drill_due"]);
    expect(h.overview().find((e) => e.component === "backup")).toEqual({ component: "backup", state: "down", at: "2026-11-01T20:00:00.000Z" });
    expect(h.overview().find((e) => e.component === "queue")).toEqual({ component: "queue", state: "down", at: "2026-11-02T00:45:00.000Z", count: 1 });
    // The assistant's down mark (the website banner) is kept by the same run.
    expect(h.heartbeats.downSince()).toBe(START);
  });

  it("the health check alerts once per fall: nothing while a part stays down, again after it was back", () => {
    const h = downEverywhere();
    h.check.run();
    expect(h.check.run().raised).toEqual([]);
    writeBackupStatus(backupStatusPath(h.dataDir), { ...NO_BACKUP_YET, lastGoodAt: START as Instant, lastRunAt: START as Instant, lastOutcome: "ok" });
    expect(h.check.run().model.find((e) => e.component === "backup")?.state).toBe("up");
    writeBackupStatus(backupStatusPath(h.dataDir), { ...NO_BACKUP_YET, lastGoodAt: START as Instant, lastRunAt: START as Instant, lastOutcome: "local_failed", failedStep: "integrity" });
    expect(h.check.run().raised.map((a) => a?.kind)).toEqual(["backup_failed"]);
    expect(h.overview().find((e) => e.component === "backup")?.state).toBe("down");
  });

  it("review 2: a part already down that goes down for a new reason alerts again", () => {
    const h = downEverywhere();
    h.check.run();
    writeBackupStatus(backupStatusPath(h.dataDir), { ...NO_BACKUP_YET, lastGoodAt: "2026-11-01T20:00:00.000Z" as Instant, lastRunAt: START as Instant, lastOutcome: "local_failed", failedStep: "integrity" });
    expect(h.check.run().raised.map((a) => a?.kind)).toEqual(["backup_failed"]);
    expect(h.check.run().raised).toEqual([]);
    // A bridge held for a captcha, then signed out.
    const ledger = freshLedger();
    const clock = movingClock(START);
    const check = healthCheck({ model: () => readHealthModel(ledger, clock, {}), alerts: ledgerAlerts(ledger, clock), clock });
    ledger.tx((db) => holdShopeeQueue(db, "captcha", instantFromMs(toMs(START as Instant) + 10 * 60_000)));
    expect(check.run().raised.map((a) => a?.kind)).toEqual(["bridge_captcha"]);
    ledger.tx((db) => pauseShopeeQueue(db, "login_redirect", clock.now()));
    expect(check.run().raised.map((a) => a?.kind)).toEqual(["bridge_login_lost"]);
  });

  it("review 8: a queue held for the bridge, or a request in its retry wait, is not reported stuck by the queue part", () => {
    const ledger = freshLedger();
    const clock = movingClock(START);
    const queue = () => readHealthModel(ledger, clock, {}).find((e) => e.component === "queue");
    ledger.sqlite.exec(`INSERT INTO link_requests (request_id, customer_id, network, platform, status, source_url, origin, created_at, next_attempt_at) VALUES
      ('REQS', 'C1', 'shopee', 'shopee', 'QUEUED', 'https://shopee.vn/p/10', 'REQUEST', '2026-11-02T00:30:00.000Z', NULL),
      ('REQR', 'C1', 'accesstrade', 'lazada', 'QUEUED', 'https://lazada.vn/p/10', 'REQUEST', '2026-11-02T00:30:00.000Z', '2026-11-02T00:58:00.000Z')`);
    // Shopee's queue is paused: the bridge part reports it; the AccessTrade request is due only since 00:58.
    ledger.tx((db) => pauseShopeeQueue(db, "login_redirect", clock.now()));
    expect(queue()).toMatchObject({ state: "up", count: 2 });
    clock.advance(9 * 60_000);
    expect(queue()).toMatchObject({ state: "down", at: "2026-11-02T00:58:00.000Z", count: 2, alert: { kind: "link_queue_stuck" } });
    // A request still in its retry wait is not due at all.
    ledger.sqlite.exec("UPDATE link_requests SET next_attempt_at = '2026-11-02T02:00:00.000Z' WHERE request_id = 'REQR'");
    expect(queue()).toMatchObject({ state: "up", count: 2 });
  });

  it("a part that does not report is not known yet on both sides, and raises nothing", () => {
    const ledger = freshLedger();
    const clock = movingClock(START);
    const check = healthCheck({ model: () => readHealthModel(ledger, clock, {}), alerts: ledgerAlerts(ledger, clock), clock });
    const { model, raised } = check.run();
    expect(withoutAlerts(model)).toEqual([
      { component: "bridge", state: "unknown", at: null },
      { component: "assistant", state: "unknown", at: null },
      { component: "reconciliation", state: "unknown", at: null },
      { component: "backup", state: "unknown", at: null },
      { component: "queue", state: "up", at: null, count: 0 },
      { component: "drill", state: "unknown", at: null },
    ]);
    expect(raised).toEqual([]);
    expect(overviewOf(ledger.db, { period: "today" }, clock).health).toEqual(withoutAlerts(model));
  });
});
