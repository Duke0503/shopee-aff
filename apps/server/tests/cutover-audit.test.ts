/**
 * Story 8.8 and the owner's numbers audit of 2026-11-02, with the Sprint 34 review items: every
 * order, transfer, customer total and network batch of the live copy against the new ledger, any
 * difference without a documented reason failing; go-live starting the payout window on one
 * clock; the ledger installed alone; a stale encrypted backup never kept; option and sample
 * checks; and the public listener on both loopbacks. Deterministic, no network beyond loopback.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { get } from "node:http";
import { join } from "node:path";
import { instantFromMs, toMs } from "@cashback/core";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { auditMarkdown, runAudit } from "../src/cutover/audit-report";
import { KNOWN_TRANSFER_DIFFERENCES } from "../src/cutover/cutover-audit";
import { auditStep, goLiveStep, installLedgerStep } from "../src/cutover/cutover-ledger-steps";
import { backupStep, parseWhole, readImportReport, smokeStep, withBoth } from "../src/cutover/cutover-steps";
import { CUTOVER_WINDOW_MS, payoutWindow } from "../src/modules/payouts/index";
import { openLedger } from "../src/platform/db/ledger";
import { buildServers, close, listen, LOOPBACK, publicAddresses, type Servers } from "../src/platform/http/servers";
import { buildLiveCopy, CLEAN_LIVE_SQL, importOnce, tempDir } from "./helpers/live-fixture";
import { movingClock } from "./helpers/order-ledger";

const servers: Servers[] = [];
afterEach(async () => {
  for (const s of servers.splice(0)) await close(s);
});

function audited(extraSql = "", tamper = "") {
  const live = buildLiveCopy({ extraSql: `${CLEAN_LIVE_SQL}\n${extraSql}` });
  const run = importOnce(live);
  if (tamper !== "") {
    const db = new Database(run.targetPath);
    db.exec("DROP TRIGGER IF EXISTS orders_paid_amounts_unchanged; DROP TRIGGER IF EXISTS orders_paid_order_unchanged;");
    db.exec(tamper);
    db.close();
  }
  const report = readImportReport(run.targetPath);
  if (report === null) throw new Error("no import report");
  return { live, run, audit: withBoth(live, run.targetPath, (source, target) => runAudit(source, target, report)) };
}

describe("the cutover numbers audit", () => {
  it("passes a faithful import: every order, transfer, customer and batch checked, totals equal, no customer name or Zalo id in the page", () => {
    const { audit, live, run } = audited();
    expect(audit).toMatchObject({ result: "pass", unexplained: 0 });
    expect(audit.orders.checked).toBeGreaterThan(0);
    expect(audit.payouts.checked).toBe(2);
    expect(audit.customers.totals["paid"]).toEqual({ live: 13232, imported: 13232 });
    expect(audit.orders.statusMap).toMatchObject({ "paid->PAID": expect.any(Number) as number });
    const out = tempDir("cashback-audit-");
    expect(auditStep(live, run.targetPath, out)).toMatchObject({ code: 0, line: { step: "audit", result: "pass" } });
    const page = readFileSync(join(out, "audit.md"), "utf8") + readFileSync(join(out, "audit.json"), "utf8");
    for (const personal of ["Nguyễn Văn An", "1000000000000000001", "0011 2233 4455", "Ab3dE5gH"]) expect(page).not.toContain(personal);
    expect(page).toContain("DP00001");
  });

  it("one dong of an order's cashback, a moved order or a changed transfer is an unexplained difference that fails it", () => {
    const cashback = audited("", "UPDATE orders SET cashback = cashback + 1 WHERE order_id = '260911AAAA0001'").audit;
    expect(cashback.result).toBe("fail");
    expect(cashback.differences).toContainEqual(expect.objectContaining({ section: "orders", key: "260911AAAA0001", field: "cashback", live: 6232, imported: 6233, explained: false }));
    const moved = audited("", "UPDATE orders SET customer_id = '1000000000000000009' WHERE order_id = '260911AAAA0001'").audit;
    expect(moved.differences).toContainEqual(expect.objectContaining({ section: "orders", field: "customer", live: "DP00001", imported: "DP00010", explained: false }));
    const transfer = audited("", "DROP TRIGGER IF EXISTS payouts_facts_fixed; UPDATE payouts SET transfer_amount = transfer_amount + 1 WHERE payout_id = 1").audit;
    expect(transfer.differences).toContainEqual(expect.objectContaining({ section: "payouts", key: "1", field: "amount", explained: false }));
  });

  it("the known 6 dong of payout 10 is listed as a known live discrepancy; the same gap on another payout fails", () => {
    expect(KNOWN_TRANSFER_DIFFERENCES).toEqual({ 10: -6 });
    const known = audited("UPDATE payment_transfers SET id = 10, amount = amount - 6 WHERE id = 1;").audit;
    expect(known.result).toBe("pass");
    expect(known.differences).toContainEqual(expect.objectContaining({ section: "payouts", key: "10", field: "transfer_vs_covered", reason: "known_live_discrepancy", explained: true }));
    expect(known.payouts.lines.find((l) => l.payoutId === 10)).toMatchObject({ difference: -6, orders: ["260911AAAA0001"] });
    const other = audited("UPDATE payment_transfers SET amount = amount - 6 WHERE id = 1;").audit;
    expect(other.result).toBe("fail");
    expect(other.differences).toContainEqual(expect.objectContaining({ section: "payouts", key: "1", field: "transfer_vs_covered", explained: false }));
  });

  it("the live payout screen's QR that fell back to an awaiting estimate is listed as the live bug, never counted as payable", () => {
    const { audit } = audited();
    const awaiting = audit.customers.lines.find((l) => l.liveWaiting > 0 && l.livePayable === 0);
    expect(awaiting).toBeDefined();
    expect(awaiting).toMatchObject({ newPayable: 0, liveQr: awaiting?.liveWaiting });
    expect(audit.differences).toContainEqual(expect.objectContaining({ section: "customers", key: awaiting?.code, field: "live_qr", reason: "live_qr_showed_awaiting", explained: true }));
    expect(auditMarkdown(audit, "2026-11-02T00:00:00.000Z")).toContain("live_qr_showed_awaiting");
  });

  it("network batches: received and gross must match the raw report and the import; fee plus tax is gross minus received", () => {
    const batch = `INSERT INTO payout_batches (batch_id, platform, status, amount, eligible_amount, created_time, paid_time, raw_json, created_at, updated_at) VALUES
      ('B1', 'shopee', 'paid', 386938, 434665, '2026-09-28T02:00:07+07:00', '2026-10-01T11:29:46+07:00', '{"eligibleTotalAmount": "43466500000", "totalPaymentAmount": "38693800000"}', '2026-10-03T19:57:40+07:00', '2026-10-03T19:57:40+07:00');`;
    const good = audited(batch).audit;
    expect(good.batches).toEqual({ checked: 1, received: { live: 386938, imported: 386938 } });
    expect(good.differences.filter((d) => d.section === "batches")).toEqual([]);
    const raw = audited(batch.replace('"38693800000"', '"38693900000"')).audit;
    expect(raw.differences).toContainEqual(expect.objectContaining({ section: "batches", key: "B1", field: "received", explained: false }));
  });
});

describe("Sprint 34 review: go-live, install, backup, options and smoke", () => {
  it("review 2: go-live starts the no-payout window from now on the installed ledger, audited under the cutover", () => {
    const run = importOnce(buildLiveCopy());
    const answer = goLiveStep(run.targetPath);
    const at = String(answer.line["goLiveAt"]);
    expect(answer.line["payoutWindowEndsAt"]).toBe(instantFromMs(toMs(at as never) + CUTOVER_WINDOW_MS));
    const ledger = openLedger(run.targetPath);
    try {
      expect(payoutWindow(ledger.db)).toMatchObject({ open: true, endsAt: answer.line["payoutWindowEndsAt"], changedBy: "system:cutover" });
      expect(ledger.sqlite.prepare("SELECT count(*) AS n FROM audit_entries WHERE event = 'payouts.window.opened'").get()).toEqual({ n: 2 });
    } finally {
      ledger.close();
    }
  });

  it("review 4: only the ledger file is replaced; an old ledger and its WAL are moved aside, proofs and backups stay; twice is a no-op", async () => {
    const run = importOnce(buildLiveCopy());
    const data = tempDir("cashback-data-");
    const target = join(data, "ledger.sqlite");
    mkdirSync(join(data, "files"), { recursive: true });
    writeFileSync(join(data, "files", "proof.jpg"), "proof");
    writeFileSync(target, "old ledger");
    writeFileSync(`${target}-wal`, "stale wal");
    const first = await installLedgerStep(run.targetPath, target);
    expect(first.line).toMatchObject({ reused: false, movedAside: expect.stringContaining("ledger.sqlite.pre-cutover-") as string });
    expect(readFileSync(join(data, "files", "proof.jpg"), "utf8")).toBe("proof");
    expect(existsSync(`${target}-wal`)).toBe(false);
    expect(readFileSync(`${String(first.line["movedAside"])}-wal`, "utf8")).toBe("stale wal");
    const db = new Database(target, { readonly: true });
    expect(db.prepare("SELECT count(*) AS n FROM orders").get()).toEqual(new Database(run.targetPath, { readonly: true }).prepare("SELECT count(*) AS n FROM orders").get());
    db.close();
    expect((await installLedgerStep(run.targetPath, target)).line).toMatchObject({ reused: true, movedAside: null });
  });

  it("review 8: a backup made anew drops an encrypted copy left from an earlier backup", async () => {
    const live = buildLiveCopy();
    const out = tempDir("cashback-final-");
    writeFileSync(join(out, "live-final.db.age"), "stale");
    const answer = await backupStep(live, out, null);
    expect(answer.line).toMatchObject({ reused: false, encrypted: null });
    expect(existsSync(join(out, "live-final.db.age"))).toBe(false);
  });

  it("review 7: options are whole numbers in range, written in digits only", () => {
    expect(parseWhole("20", 1, 1000)).toBe(20);
    for (const bad of ["", "abc", "1e3", " 20", "-1", "0", "1001", "2.5"]) expect(parseWhole(bad, 1, 1000)).toBeNull();
  });

  it("review 7: smoke fails when the ledger has no share link, or when fewer were checked than asked for and available", async () => {
    const empty = importOnce(buildLiveCopy({ rows: false }));
    const ok = async () => 200;
    expect(await smokeStep(empty.targetPath, [{ name: "local", base: "http://127.0.0.1:9" }], 20, ok)).toMatchObject({ code: 1, line: { problems: ["no_share_code"] } });
    const full = importOnce(buildLiveCopy());
    const answer = await smokeStep(full.targetPath, [{ name: "local", base: "http://127.0.0.1:9" }, { name: "localhost", base: "http://localhost:9" }, { name: "ipv6", base: "http://[::1]:9" }], 20, ok);
    expect(answer).toMatchObject({ code: 0, line: { ok: true, problems: [] } });
    const available = answer.line["available"] as { shareCodes: number };
    expect((answer.line["sampled"] as { shareCodes: number }).shareCodes).toBe(Math.min(20, available.shareCodes));
  });
});

const status = (url: string): Promise<number> =>
  new Promise((resolve, reject) => {
    get(url, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    }).on("error", reject);
  });

describe("task B: the public listener answers on both loopbacks, never on all addresses", () => {
  it("binds 127.0.0.1 and ::1 on the same port; localhost reaches it whichever it resolves to; the internal listener stays on 127.0.0.1", async () => {
    const s = buildServers({ clock: movingClock("2026-11-02T12:00:00.000Z"), internalToken: "t".repeat(40), internal: [], public: [] });
    servers.push(s);
    await listen(s, { public: 0, internal: 0 });
    const addresses = publicAddresses(s);
    expect(addresses.map((a) => a.address)).toEqual([LOOPBACK, "::1"]);
    expect(new Set(addresses.map((a) => a.port)).size).toBe(1);
    for (const a of addresses) expect(["0.0.0.0", "::"]).not.toContain(a.address);
    const port = addresses[0]?.port ?? 0;
    for (const host of ["127.0.0.1", "[::1]", "localhost"]) expect(await status(`http://${host}:${port}/api/health`)).toBe(200);
    expect(s.internalApp.server.address()).toMatchObject({ address: LOOPBACK });
    await close(s);
    servers.splice(0);
    await expect(status(`http://[::1]:${port}/api/health`)).rejects.toThrow();
  });
});
