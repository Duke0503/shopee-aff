/**
 * Stories 8.7 and 8.8: the server side of the cutover. The 72-hour no-payout window (opened by the
 * import, refusing confirm, closed by the owner only after its end, audited), the parity gate
 * that aborts the cutover on any count or paid-total difference, the final backup of a live file
 * with its WAL, the carry-over of the live `.env` values that never prints one, the preflight's
 * exceptions, and the smoke sample. Deterministic, no network.
 */
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseEnv } from "node:util";
import { errorEnvelopeSchema, PAYOUT_WINDOW_PATH, PAYOUT_WINDOW_STATE_PATH, payoutClaimResponseSchema, type PayoutPreview } from "@cashback/contracts";
import { instantFromMs, toMs } from "@cashback/core";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { runAdminCli, type CliIo } from "../src/admin/admin-cli";
import { adminCommandRoutes } from "../src/admin/admin-command.routes";
import { payoutWindowRoutes } from "../src/admin/payout-window.routes";
import { preflightVerdict, type PreflightFacts } from "../src/cutover/cutover-preflight";
import { carryOverStep, gateStep, smokeStep } from "../src/cutover/cutover-steps";
import { gateVerdict, type GateCount, type GateTable } from "../src/cutover/cutover-gate";
import { envEntry, planCarryOver } from "../src/cutover/env-carry-over";
import { backupLiveLedger, sha256Of } from "../src/cutover/live-backup";
import { runSmoke, spread } from "../src/cutover/smoke-check";
import { openSession, STAFF_SESSION_MS } from "../src/modules/identity/index";
import { commandAudit } from "../src/modules/operations/index";
import { closePayoutWindow, CUTOVER_WINDOW_MS, isConfirmPaused, openPayoutWindow, payoutWindow } from "../src/modules/payouts/index";
import { CUTOVER_SYSTEM_ACTOR } from "../src/platform/ports/audit.port";
import { openLedger, type Ledger } from "../src/platform/db/ledger";
import { ACCESS_JWT_HEADER } from "../src/platform/http/access-jwt.guard";
import { INTERNAL_TOKEN_HEADER } from "../src/platform/http/internal-token.guard";
import { buildServers, close, type Servers } from "../src/platform/http/servers";
import { STAFF_SESSION_COOKIE } from "../src/platform/http/session-cookie";
import { buildLiveCopy, CLEAN_LIVE_SQL, importOnce, tempDir, TEST_CLOCK } from "./helpers/live-fixture";
import { closeLedgers, movingClock } from "./helpers/order-ledger";
import { addBank, addOrder, CLOCK, confirmClaim, MINH, NOW, openClaim, payoutLedger, writeCounts } from "./helpers/payout-ledger";
import { accessJwt, ADMIN_HOST, addStaff, deskServers, generatedPassword, ORIGIN } from "./helpers/staff-desk";

const INTERNAL = "i".repeat(40);
const servers: Servers[] = [];
afterEach(async () => {
  for (const s of servers.splice(0)) await close(s);
  closeLedgers();
});

const all = (ledger: Ledger, query: string) => ledger.sqlite.prepare(query).all();
const openWindow = (ledger: Ledger, at = NOW) => ledger.tx((db) => openPayoutWindow(db, instantFromMs(toMs(at as never)), commandAudit(db, CLOCK, CUTOVER_SYSTEM_ACTOR)));

function staffPost(s: Servers, ledger: Ledger, url: string, body: unknown) {
  const session = ledger.tx((db) => openSession(db, { kind: "STAFF", staffId: "minh" }, CLOCK, STAFF_SESSION_MS));
  return s.publicApp.inject({ method: "POST", url, headers: { host: ADMIN_HOST, origin: ORIGIN, cookie: `${STAFF_SESSION_COOKIE}=${session.token}`, [ACCESS_JWT_HEADER]: accessJwt(CLOCK) }, payload: body as object });
}

describe("Story 8.8: the 72-hour no-payout window", () => {
  it("AC1: with the window open, staff confirm over HTTP is refused and nothing is paid; the window states its end", async () => {
    const ledger = payoutLedger();
    addOrder(ledger, { id: "261001A0001", customer: "P1", cashback: 79216 });
    addBank(ledger, "P1", { number: "0071000123456" });
    const s = deskServers(ledger, CLOCK);
    servers.push(s);
    // A claim opened just before the window: the window pauses its confirm.
    const open = payoutClaimResponseSchema.parse(JSON.parse((await staffPost(s, ledger, "/api/admin/payouts/P1/claim", {})).body)) as PayoutPreview;
    const window = openWindow(ledger);
    expect(window).toMatchObject({ open: true, endsAt: "2026-11-02T12:00:00.000Z" });
    expect(isConfirmPaused(ledger.db)).toBe(true);
    const res = await staffPost(s, ledger, `/api/admin/payout-claims/${open.claimId}/confirm`, { snapshotHash: open.snapshotHash });
    expect(res.statusCode).toBe(409);
    expect(errorEnvelopeSchema.parse(JSON.parse(res.body)).error.messageKey).toBe("error.payout.confirm_paused");
    expect(all(ledger, "SELECT count(*) AS n FROM payouts")).toEqual([{ n: 0 }]);
    expect(all(ledger, "SELECT count(*) AS n FROM orders WHERE paid_at IS NOT NULL")).toEqual([{ n: 0 }]);
  });

  it("review 3: while the window is open no claim opens and no account is shown; the Payouts screen reads when it ends", async () => {
    const ledger = payoutLedger();
    addOrder(ledger, { id: "261001A0001", customer: "P1", cashback: 79216 });
    addBank(ledger, "P1", { number: "0071000123456" });
    const s = deskServers(ledger, CLOCK);
    servers.push(s);
    const open = payoutClaimResponseSchema.parse(JSON.parse((await staffPost(s, ledger, "/api/admin/payouts/P1/claim", {})).body)) as PayoutPreview;
    openWindow(ledger);
    const claim = await staffPost(s, ledger, "/api/admin/payouts/P1/claim", {});
    expect(claim.statusCode).toBe(409);
    expect(errorEnvelopeSchema.parse(JSON.parse(claim.body)).error.messageKey).toBe("error.payout.confirm_paused");
    const account = await staffPost(s, ledger, `/api/admin/payout-claims/${open.claimId}/account`, {});
    expect(account.statusCode).toBe(409);
    expect(account.body).not.toContain("0071000123456");
    const session = ledger.tx((db) => openSession(db, { kind: "STAFF", staffId: "minh" }, CLOCK, STAFF_SESSION_MS));
    const state = await s.publicApp.inject({ method: "GET", url: PAYOUT_WINDOW_STATE_PATH, headers: { host: ADMIN_HOST, cookie: `${STAFF_SESSION_COOKIE}=${session.token}`, [ACCESS_JWT_HEADER]: accessJwt(CLOCK) } });
    expect(JSON.parse(state.body)).toEqual({ open: true, endsAt: "2026-11-02T12:00:00.000Z" });
  });

  it("review 5: a payout recorded before the window opened is still answered on a retried confirm; nothing new is written", () => {
    const ledger = payoutLedger();
    addOrder(ledger, { id: "261001A0001", customer: "P1", cashback: 79216 });
    addBank(ledger, "P1", { number: "0071000123456" });
    const claim = openClaim(ledger, "P1");
    if (claim.kind !== "claimed") throw new Error("expected a claim");
    const first = confirmClaim(ledger, claim.claim.claimId, claim.snapshot.hash);
    openWindow(ledger);
    const before = writeCounts(ledger);
    expect(confirmClaim(ledger, claim.claim.claimId, claim.snapshot.hash, MINH, CLOCK, { confirmPaused: () => isConfirmPaused(ledger.db) })).toMatchObject({ kind: "recorded", replay: true, payout: first.kind === "recorded" ? { payoutId: first.payout.payoutId } : {} });
    expect(writeCounts(ledger)).toEqual(before);
  });

  it("AC2: the owner command closes it only after 72 hours, audited under the admin; then confirm is no longer paused", async () => {
    const ledger = payoutLedger();
    const password = generatedPassword();
    await addStaff(ledger, "duc", "ADMIN", password, { root: true });
    openWindow(ledger);
    const clock = movingClock(NOW);
    const s = buildServers({ clock, internalToken: INTERNAL, internal: [adminCommandRoutes({ ledger, clock }), payoutWindowRoutes({ ledger, clock })] });
    servers.push(s);
    const cli = async (argv: string[]) => {
      const lines: Record<string, unknown>[] = [];
      const io: CliIo = {
        call: async (method, url, body, headers) => {
          const r = await s.internalApp.inject({ method, url, headers: { [INTERNAL_TOKEN_HEADER]: INTERNAL, ...headers }, ...(body === undefined ? {} : { payload: body as object }) });
          return { status: r.statusCode, body: JSON.parse(r.body) as unknown };
        },
        secret: async () => password,
        readJson: () => null,
        print: (line) => void lines.push(line),
      };
      return { code: await runAdminCli(argv, io), lines };
    };
    expect((await s.internalApp.inject({ method: "POST", url: PAYOUT_WINDOW_PATH, headers: { [INTERNAL_TOKEN_HEADER]: INTERNAL }, payload: { open: false } })).statusCode).toBe(401);
    expect(await cli(["payout-window", "on", "--as", "duc"])).toMatchObject({ code: 1, lines: [{ ok: false, reason: "usage" }] });
    clock.advance(CUTOVER_WINDOW_MS - 60_000);
    expect(await cli(["payout-window", "off", "--as", "duc"])).toMatchObject({ code: 1, lines: [{ ok: false, reason: "error.payout.window_not_over" }] });
    expect(isConfirmPaused(ledger.db)).toBe(true);
    clock.advance(60_000);
    expect(await cli(["payout-window", "off", "--as", "duc"])).toEqual({ code: 0, lines: [{ ok: true, command: "payout-window", open: false, endsAt: null }] });
    expect(isConfirmPaused(ledger.db)).toBe(false);
    expect(payoutWindow(ledger.db)).toMatchObject({ open: false, changedBy: "staff:duc" });
    expect(await cli(["payout-window", "off", "--as", "duc"])).toMatchObject({ code: 1, lines: [{ reason: "error.payout.window_already_closed" }] });
    expect(all(ledger, "SELECT event, actor_kind, actor_id FROM audit_entries WHERE event LIKE 'payouts.window.%' ORDER BY id")).toEqual([
      { event: "payouts.window.opened", actor_kind: "system", actor_id: "cutover" },
      { event: "payouts.window.closed", actor_kind: "staff", actor_id: "duc" },
    ]);
  });

  it("the cutover import opens the window for 72 hours from the import, with messaging.silent, under the cutover actor", () => {
    const run = importOnce(buildLiveCopy());
    const ledger = openLedger(run.targetPath);
    try {
      expect(payoutWindow(ledger.db)).toMatchObject({ open: true, endsAt: instantFromMs(toMs(TEST_CLOCK.now()) + CUTOVER_WINDOW_MS), changedBy: "system:cutover" });
      expect(() => ledger.tx((db) => closePayoutWindow(db, TEST_CLOCK.now(), commandAudit(db, TEST_CLOCK, MINH)))).toThrow(expect.objectContaining({ code: "window_not_over" }));
    } finally {
      ledger.close();
    }
  });
});

describe("Stories 8.7 and 8.8: the parity gate aborts on any difference", () => {
  it("a fresh import of the live copy passes: every named count equal, every paid total to the dong", () => {
    const live = buildLiveCopy({ extraSql: CLEAN_LIVE_SQL });
    const run = importOnce(live);
    const answer = gateStep(live, run.targetPath);
    expect(answer.line).toMatchObject({ step: "gate", result: "pass", problems: [] });
    const counts = answer.line["counts"] as Record<GateTable, GateCount>;
    expect(Object.keys(counts).sort()).toEqual(["aliases", "campaignAwards", "clicks", "customers", "linkRequests", "orders", "payouts", "shareCodes"]);
    for (const c of Object.values(counts)) expect(c.imported).toBe(c.live);
    expect(answer.code).toBe(0);
  });

  it("one dong of paid cashback, or one missing click, fails the gate with exit 1", () => {
    const live = buildLiveCopy({ extraSql: CLEAN_LIVE_SQL });
    const run = importOnce(live);
    const tampered = (sql: string) => {
      const copy = join(tempDir("cashback-gate-"), "ledger.sqlite");
      copyFileSync(run.targetPath, copy);
      copyFileSync(`${run.targetPath}.import-report.json`, `${copy}.import-report.json`);
      const db = new Database(copy);
      db.exec("DROP TRIGGER IF EXISTS orders_paid_amounts_unchanged; DROP TRIGGER IF EXISTS orders_paid_order_unchanged; DROP TRIGGER IF EXISTS link_clicks_no_delete;");
      db.exec(sql);
      db.close();
      return gateStep(live, copy);
    };
    const paid = tampered("UPDATE orders SET cashback = cashback + 1 WHERE order_id = (SELECT order_id FROM orders WHERE paid_at IS NOT NULL AND cashback > 0 ORDER BY order_id LIMIT 1)");
    expect(paid.code).toBe(1);
    expect(paid.line["problems"]).toContain("paid_parity");
    const click = tampered("DELETE FROM link_clicks WHERE rowid = (SELECT min(rowid) FROM link_clicks)");
    expect(click.code).toBe(1);
    expect(click.line["problems"]).toContain("count:clicks");
  });

  it("an import that did not finish fails even with equal counts", () => {
    const counts = { orders: { live: 1, imported: 1 } } as unknown as Record<GateTable, GateCount>;
    const paid = { customers: 1, liveTotal: 5, importedTotal: 5, mismatches: 0, mismatchedCustomers: [] };
    expect(gateVerdict(counts, paid, null).problems).toEqual(["import_not_ok"]);
    expect(gateVerdict(counts, paid, { outcome: { ok: true, reason: null, error: null }, comparison: { orders: { source: 1, imported: 1, mismatches: [{ key: "x", field: "cashback" }] } } }).problems).toEqual(["comparison:orders"]);
    expect(gateVerdict(counts, paid, { outcome: { ok: true, reason: null, error: null }, comparison: {} }).result).toBe("pass");
  });
});

describe("Story 8.8: the final backup of the live ledger", () => {
  it("carries the rows still in the WAL, leaves the live files untouched, hashes the result and is reused on a second run", async () => {
    const dir = tempDir("cashback-final-");
    const live = join(dir, "cashback.db");
    const writer = new Database(live);
    writer.pragma("journal_mode = WAL");
    writer.pragma("wal_autocheckpoint = 0");
    writer.exec("CREATE TABLE t (v INTEGER); INSERT INTO t VALUES (1), (2), (3);");
    const before = [sha256Of(live), sha256Of(`${live}-wal`)];
    const out = join(dir, "final");
    const first = await backupLiveLedger(live, out);
    expect([sha256Of(live), sha256Of(`${live}-wal`)]).toEqual(before);
    writer.close();
    expect(first).toMatchObject({ integrity: "ok", reused: false, sha256: sha256Of(first.file) });
    expect(first.staged).toContain("-wal");
    const copy = new Database(first.file, { readonly: true });
    expect(copy.prepare("SELECT count(*) AS n FROM t").get()).toEqual({ n: 3 });
    copy.close();
    expect(await backupLiveLedger(live, out)).toMatchObject({ reused: true, sha256: first.sha256 });
  });
});

describe("Story 8.8: carry-over and preflight never print a secret", () => {
  const LIVE = "TELEGRAM_BOT_TOKEN=123456:live-telegram-value-aaaaaaaaaaaa\nACCESSTRADE_API_KEY=live-accesstrade-value-bbbbbbbb\nTELEGRAM_CHAT_ID=-1000000000001\nZALO_MAIN_GROUP_ID=111\nZALO_TEST_GROUP_ID=222\n";

  it("fills only unset keys, keeps a value already there, sets the fixed keys, and answers with key names only", () => {
    const dir = tempDir("cashback-carry-");
    const live = join(dir, "live.env");
    const prod = join(dir, "prod.env");
    writeFileSync(live, LIVE);
    writeFileSync(prod, "INTERNAL_TOKEN=prod-internal-value-cccccccccccccccc\nTELEGRAM_CHAT_ID=-1000000000009\nACCESSTRADE_API_KEY=\n");
    const answer = carryOverStep(live, prod, { PUBLIC_PORT: "80" }, false);
    expect(answer.line).toEqual({ step: "carry-over", written: true, carried: ["TELEGRAM_BOT_TOKEN", "ACCESSTRADE_API_KEY", "ZALO_GROUP_IDS"], already: [], kept: ["TELEGRAM_CHAT_ID"], missing: ["ADDLIVETAG_API_KEY", "GDRIVE_WEBHOOK_URL", "GDRIVE_SECRET_TOKEN"], fixed: ["PUBLIC_PORT"] });
    const printed = JSON.stringify(answer.line);
    for (const value of ["live-telegram-value", "live-accesstrade-value", "prod-internal-value", "-1000000000001"]) expect(printed).not.toContain(value);
    const text = readFileSync(prod, "utf8");
    expect(text).toContain("TELEGRAM_BOT_TOKEN=123456:live-telegram-value-aaaaaaaaaaaa");
    expect(text).toContain("TELEGRAM_CHAT_ID=-1000000000009");
    expect(text).toContain("ZALO_GROUP_IDS=111,222");
    expect(text).toContain("PUBLIC_PORT=80");
    expect(carryOverStep(live, prod, { PUBLIC_PORT: "80" }, false).line).toMatchObject({ written: false, carried: [], fixed: [] });
  });

  it("review 10: a value with spaces, # or quotes is written quoted so it reads back unchanged; one no form can hold is refused by key", () => {
    for (const value of ["two words secret", "a#b", "it's", 'say "hi" it\'s']) {
      const plan = planCarryOver(`ACCESSTRADE_API_KEY=${envEntry("X", value).slice(2)}\n`, "");
      expect(parseEnv(plan.text)["ACCESSTRADE_API_KEY"]).toBe(value);
    }
    expect(() => envEntry("ACCESSTRADE_API_KEY", "a`b'c\"d")).toThrow(expect.objectContaining({ code: "value_needs_quoting", key: "ACCESSTRADE_API_KEY" }));
    expect(() => envEntry("A.*", "x")).toThrow(expect.objectContaining({ key: "A.*" }));
    // A key is matched literally: a line of a key that only looks like it under a pattern is left alone.
    const plan = planCarryOver("TELEGRAM_CHAT_ID=-1\n", "TELEGRAMXCHAT_ID=keep\n");
    expect(plan.text).toBe("TELEGRAMXCHAT_ID=keep\nTELEGRAM_CHAT_ID=-1\n");
  });

  it("the preflight accepts only carried or named gaps, and shares only the two carried secrets", () => {
    const facts: PreflightFacts = { gaps: ["TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID", "ADMIN_HOST, ACCESS_TEAM_DOMAIN, ACCESS_AUDIENCE"], committed: [], shared: ["TELEGRAM_BOT_TOKEN"], carried: ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID"], carriedCommitted: [], acceptedGaps: ["ADMIN_HOST", "ACCESS_TEAM_DOMAIN", "ACCESS_AUDIENCE"], missingBuilds: [] };
    expect(preflightVerdict(facts)).toEqual({ ok: true, problems: [], openGaps: ["ADMIN_HOST", "ACCESS_TEAM_DOMAIN", "ACCESS_AUDIENCE"] });
    expect(preflightVerdict({ ...facts, acceptedGaps: [] }).problems).toEqual(["settings_missing:ADMIN_HOST+ACCESS_TEAM_DOMAIN+ACCESS_AUDIENCE"]);
    expect(preflightVerdict({ ...facts, shared: ["INTERNAL_TOKEN"] }).problems).toEqual(["secrets_shared:INTERNAL_TOKEN"]);
    expect(preflightVerdict({ ...facts, carriedCommitted: ["TELEGRAM_BOT_TOKEN"], committed: null, missingBuilds: ["apps/web/dist/index.html"] }).problems).toEqual(["secrets_unchecked:main_ref_not_found", "secrets_committed:TELEGRAM_BOT_TOKEN", "build_missing:apps/web/dist/index.html"]);
    const kept = preflightVerdict({ ...facts, carriedCommitted: ["TELEGRAM_BOT_TOKEN"], acceptedGaps: [...facts.acceptedGaps, "TELEGRAM_BOT_TOKEN"] });
    expect(kept.problems).toEqual([]);
    expect(kept.openGaps).toContain("TELEGRAM_BOT_TOKEN:committed_kept");
    const keptInFile = preflightVerdict({ ...facts, committed: ["TELEGRAM_BOT_TOKEN"], acceptedGaps: [...facts.acceptedGaps, "TELEGRAM_BOT_TOKEN"] });
    expect(keptInFile.problems).toEqual([]);
  });
});

describe("Story 8.7 AC3: smoke checks on old share links and receipts", () => {
  it("samples evenly and the same way every run", () => {
    expect(spread([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 4)).toEqual([1, 4, 7, 10]);
    expect(spread([1, 2], 20)).toEqual([1, 2]);
  });

  it("opens 20 imported share codes with HEAD and the receipts with GET; a failure is counted by kind and index, never by code", async () => {
    const run = importOnce(buildLiveCopy());
    const seen: string[] = [];
    const answer = await smokeStep(run.targetPath, [{ name: "local", base: "http://127.0.0.1:9180" }], 20, async (url, options) => {
      seen.push(`${options.method} ${new URL(url).pathname.split("/")[1] ?? ""}`);
      return url.includes("/s/") && seen.filter((s) => s.startsWith("HEAD")).length === 1 ? 404 : 200;
    });
    expect(seen.slice(0, 2)).toEqual(["GET api", "GET "]);
    expect(seen.filter((s) => s === "HEAD s").length).toBe(answer.line["sampled"] && (answer.line["sampled"] as { shareCodes: number }).shareCodes);
    expect(answer.code).toBe(1);
    expect(answer.line["failed"]).toEqual([{ target: "local", kind: "share", index: 0, status: 404 }]);
    const db = new Database(run.targetPath, { readonly: true });
    const codes = (db.prepare("SELECT code FROM share_codes").all() as { code: string }[]).map((r) => r.code);
    db.close();
    for (const code of codes) expect(JSON.stringify(answer.line)).not.toContain(code);
  });

  it("through the tunnel one share link and one receipt prove the route; an unreachable host counts as status 0", async () => {
    const result = await runSmoke([{ name: "public", base: "https://hoantiendp.invalid" }], { codes: ["a", "b"], tokens: ["t"] }, async () => {
      throw new Error("offline");
    });
    expect(result).toMatchObject({ ok: false, checks: 4 });
    expect(result.failed.map((f) => f.status)).toEqual([0, 0, 0, 0]);
  });
});

it("a migrated ledger starts with the window closed", () => {
  const ledger = payoutLedger();
  expect(payoutWindow(ledger.db)).toEqual({ open: false, endsAt: null, changedAt: null, changedBy: null });
  expect(existsSync(ledger.sqlite.name)).toBe(true);
});
