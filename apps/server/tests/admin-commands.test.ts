/**
 * Story 4.20: staff are seeded, passwords reset and roles changed, and a cutover campaign created,
 * by admin command through the internal CLI and the internal listener (decision H8, AD-18, AD-28,
 * D21, D22, D53). The root admin is never demoted or disabled, only an admin runs a command after
 * the first seed, every command writes its audit entry, and no password is ever printed, stored
 * or audited.
 */
import { randomBytes } from "node:crypto";
import { fixedClock } from "@cashback/core";
import admin from "@cashback/labels/vi/admin.json" with { type: "json" };
import { afterEach, describe, expect, it } from "vitest";

import { CliIoError, runAdminCli, type CliIo } from "../src/admin/admin-cli";
import { adminCommandRoutes } from "../src/admin/admin-command.routes";
import { openSession, STAFF_SESSION_MS, verifyPassword } from "../src/modules/identity/index";
import type { Ledger } from "../src/platform/db/ledger";
import { INTERNAL_TOKEN_HEADER } from "../src/platform/http/internal-token.guard";
import { buildServers, close, type Servers } from "../src/platform/http/servers";
import { closeLedgers, freshLedger } from "./helpers/order-ledger";
import { generatedPassword } from "./helpers/staff-desk";

const NOW = "2026-10-30T12:00:00.000Z";
const CLOCK = fixedClock(NOW);
const TOKEN = randomBytes(24).toString("hex");

let servers: Servers | undefined;
afterEach(async () => {
  if (servers) await close(servers);
  servers = undefined;
  closeLedgers();
});

const SEED = { root: { staffId: "duc", username: "duc" }, members: [{ staffId: "minh", username: "minh", role: "EMPLOYEE" }, { staffId: "tuan", username: "tuan", role: "EMPLOYEE" }] };
const CAMPAIGN = { campaignId: "NOV2026", name: "November", startsAt: "01/11/2026 00:00", endsAt: "15/11/2026 00:00", slots: 50, bonus: 10000, minOrderValue: 150000, platforms: ["shopee", "tiktok"], perCustomer: 1, excludedCustomers: ["DP00002"] };

interface Run {
  readonly code: number;
  readonly lines: Record<string, unknown>[];
  readonly prompts: string[];
}

function setup(): { ledger: Ledger; cli: (argv: string[], answers: string[], files?: Record<string, unknown>, override?: Partial<CliIo>) => Promise<Run> } {
  const ledger = freshLedger();
  servers = buildServers({ clock: CLOCK, internalToken: TOKEN, internal: [adminCommandRoutes({ ledger, clock: CLOCK })] });
  const app = servers.internalApp;
  const cli = async (argv: string[], answers: string[], files: Record<string, unknown> = {}, override: Partial<CliIo> = {}): Promise<Run> => {
    const lines: Record<string, unknown>[] = [];
    const prompts: string[] = [];
    const queue = [...answers];
    const io: CliIo = {
      async call(method, path, body, headers) {
        const res = await app.inject({ method, url: path, headers: { [INTERNAL_TOKEN_HEADER]: TOKEN, ...headers }, ...(body === undefined ? {} : { payload: body as object }) });
        return { status: res.statusCode, body: JSON.parse(res.body) as unknown };
      },
      async secret(prompt) {
        prompts.push(prompt);
        const next = queue.shift();
        if (next === undefined) throw new CliIoError("no_answer");
        return next;
      },
      readJson: (path) => files[path] ?? { seed: SEED, campaign: CAMPAIGN }[path],
      print: (line) => void lines.push(line),
      ...override,
    };
    return { code: await runAdminCli(argv, io), lines, prompts };
  };
  return { ledger, cli };
}

const staffRows = (ledger: Ledger) => ledger.sqlite.prepare("SELECT staff_id, username, role, status, is_root, password_hash, password_set_at FROM staff ORDER BY staff_id").all() as Record<string, unknown>[];
const audits = (ledger: Ledger, event: string) => ledger.sqlite.prepare("SELECT actor_kind, actor_id, actor_role, entity_id, payload FROM audit_entries WHERE event = ? ORDER BY id").all(event) as Record<string, unknown>[];

/** Seeds duc (root), minh and tuan with generated passwords; returns them. */
async function seeded(cli: ReturnType<typeof setup>["cli"]): Promise<{ duc: string; minh: string; tuan: string }> {
  const pw = { duc: generatedPassword(), minh: generatedPassword(), tuan: generatedPassword() };
  const run = await cli(["staff-seed", "seed"], [pw.duc, pw.duc, pw.minh, pw.minh, pw.tuan, pw.tuan]);
  expect(run.code).toBe(0);
  return pw;
}

describe("Story 4.20 acceptance criteria", () => {
  it("AC1: the seed on an empty staff table creates the root admin and the listed employees with argon2id passwords, and a rerun changes nothing", async () => {
    const { ledger, cli } = setup();
    const pw = await seeded(cli);
    const rows = staffRows(ledger);
    expect(rows.map((r) => [r.staff_id, r.role, r.status, r.is_root])).toEqual([
      ["duc", "ADMIN", "ACTIVE", 1],
      ["minh", "EMPLOYEE", "ACTIVE", 0],
      ["tuan", "EMPLOYEE", "ACTIVE", 0],
    ]);
    for (const row of rows) expect(String(row.password_hash)).toMatch(/^\$argon2id\$v=19\$/);
    expect(await verifyPassword(String(rows[1]?.password_hash), pw.minh)).toBe(true);
    expect(audits(ledger, "identity.staff.seeded").map((a) => [a.actor_id, a.entity_id])).toEqual([
      ["staff-seed", "duc"],
      ["staff-seed", "minh"],
      ["staff-seed", "tuan"],
    ]);

    const rerun = await cli(["staff-seed", "seed", "--as", "duc"], [pw.duc]);
    expect(rerun.code).toBe(0);
    expect(rerun.lines).toEqual([{ ok: true, command: "staff-seed", created: [], unchanged: ["duc", "minh", "tuan"], bootstrap: false }]);
    expect(rerun.prompts).toHaveLength(1);
    expect(staffRows(ledger)).toEqual(rows);
    expect(audits(ledger, "identity.staff.seed_ran").map((a) => [a.actor_kind, a.actor_id])).toEqual([
      ["system", "staff-seed"],
      ["staff", "duc"],
    ]);
  });

  it("AC1: once staff exist, the seed without an admin sign-in, or as an employee, is refused and writes nothing", async () => {
    const { ledger, cli } = setup();
    const pw = await seeded(cli);
    const before = staffRows(ledger);
    const more = { root: SEED.root, members: [...SEED.members, { staffId: "lan", username: "lan", role: "EMPLOYEE" }] };
    const anonymous = await cli(["staff-seed", "more"], [], { more });
    expect(anonymous).toMatchObject({ code: 1, lines: [{ ok: false, reason: "error.unauthorized" }] });
    const employee = await cli(["staff-seed", "more", "--as", "minh"], [pw.minh], { more });
    expect(employee).toMatchObject({ code: 1, lines: [{ ok: false, reason: "error.staff.admin_only" }] });
    expect(staffRows(ledger)).toEqual(before);
  });

  it("AC2: a command to demote or disable the root admin refuses and changes nothing", async () => {
    const { ledger, cli } = setup();
    const pw = await seeded(cli);
    const before = staffRows(ledger);
    for (const flags of [["--role", "EMPLOYEE"], ["--status", "DISABLED"]]) {
      const run = await cli(["staff-access", "duc", "--as", "duc", ...flags], [pw.duc]);
      expect(run).toMatchObject({ code: 1, lines: [{ ok: false, command: "staff-access", reason: "error.staff.root_protected", staffId: "duc" }] });
    }
    expect(staffRows(ledger)).toEqual(before);
    expect(() => ledger.sqlite.prepare("UPDATE staff SET role = 'EMPLOYEE' WHERE staff_id = 'duc'").run()).toThrow(/never demoted/);
    const other = await cli(["staff-seed", "other"], [], { other: { root: { staffId: "khoa", username: "khoa" }, members: [] } });
    expect(other).toMatchObject({ code: 1, lines: [{ ok: false, reason: "error.staff.root_differs" }] });
  });

  it("AC2: an admin may change another member; a disabled member's sessions end", async () => {
    const { ledger, cli } = setup();
    const pw = await seeded(cli);
    ledger.tx((db) => openSession(db, { kind: "STAFF", staffId: "tuan" }, CLOCK, STAFF_SESSION_MS));
    const run = await cli(["staff-access", "tuan", "--as", "duc", "--status", "DISABLED"], [pw.duc]);
    expect(run).toMatchObject({ code: 0, lines: [{ ok: true, staffId: "tuan", role: "EMPLOYEE", status: "DISABLED" }] });
    expect(ledger.sqlite.prepare("SELECT end_reason FROM sessions WHERE staff_id = 'tuan'").all()).toEqual([{ end_reason: "STAFF_DISABLED" }]);
    expect(audits(ledger, "identity.staff.access_changed")).toEqual([expect.objectContaining({ actor_id: "duc", actor_role: "ADMIN", entity_id: "tuan" })]);
  });

  it("AC3: a campaign with end '15/11/2026 00:00' Vietnam time is stored as 2026-11-14T17:00:00.000Z and the preview reads the exclusive end back", async () => {
    const { ledger, cli } = setup();
    const pw = await seeded(cli);
    const endsBefore = admin.campaign_ends_before.replace("{time}", "00:00").replace("{date}", "15/11");
    const preview = await cli(["campaign-create", "campaign", "--as", "duc"], [pw.duc]);
    expect(preview).toMatchObject({ code: 0, lines: [{ ok: true, applied: false, endsBefore, preview: { startsAt: "2026-10-31T17:00:00.000Z", endsAt: "2026-11-14T17:00:00.000Z", excludedCustomerIds: ["C2"] } }] });
    expect(ledger.sqlite.prepare("SELECT count(*) AS n FROM campaigns WHERE campaign_id = 'NOV2026'").get()).toEqual({ n: 0 });

    const applied = await cli(["campaign-create", "campaign", "--as", "duc", "--apply"], [pw.duc]);
    expect(applied).toMatchObject({ code: 0, lines: [{ ok: true, applied: true, endsBefore }] });
    expect(ledger.sqlite.prepare("SELECT name, starts_at, ends_at, slots, bonus, min_order_value, platforms, excluded_customers, per_customer, accepts_awards, created_at, origin FROM campaigns WHERE campaign_id = 'NOV2026'").get()).toEqual({
      name: "November",
      starts_at: "2026-10-31T17:00:00.000Z",
      ends_at: "2026-11-14T17:00:00.000Z",
      slots: 50,
      bonus: 10000,
      min_order_value: 150000,
      platforms: "shopee,tiktok",
      excluded_customers: "C2",
      per_customer: 1,
      accepts_awards: 1,
      created_at: NOW,
      origin: "STAFF",
    });
    const again = await cli(["campaign-create", "campaign", "--as", "duc", "--apply"], [pw.duc]);
    expect(again).toMatchObject({ code: 1, lines: [{ ok: false, reason: "error.campaign.campaign_exists" }] });
  });

  it("AC3: a window that ends before it starts, or an unknown excluded customer, is refused", async () => {
    const { cli } = setup();
    const pw = await seeded(cli);
    const backwards = await cli(["campaign-create", "c", "--as", "duc"], [pw.duc], { c: { ...CAMPAIGN, endsAt: "01/11/2026 00:00" } });
    expect(backwards).toMatchObject({ code: 1, lines: [{ reason: "error.campaign.bad_window" }] });
    const nobody = await cli(["campaign-create", "c", "--as", "duc"], [pw.duc], { c: { ...CAMPAIGN, excludedCustomers: ["DP99999"] } });
    expect(nobody).toMatchObject({ code: 1, lines: [{ reason: "error.campaign.bad_field", field: "excludedCustomers" }] });
  });

  it("AC4: a campaign create without the admin role is refused, and every command writes an audit entry", async () => {
    const { ledger, cli } = setup();
    const pw = await seeded(cli);
    const employee = await cli(["campaign-create", "campaign", "--as", "minh", "--apply"], [pw.minh]);
    expect(employee).toMatchObject({ code: 1, lines: [{ ok: false, reason: "error.staff.admin_only" }] });
    expect(ledger.sqlite.prepare("SELECT count(*) AS n FROM campaigns WHERE campaign_id = 'NOV2026'").get()).toEqual({ n: 0 });
    const res = await servers?.internalApp.inject({ method: "POST", url: "/internal/admin/campaigns", headers: { [INTERNAL_TOKEN_HEADER]: TOKEN }, payload: { campaign: CAMPAIGN } });
    expect(res?.statusCode).toBe(401);

    const fresh = generatedPassword();
    expect((await cli(["staff-password", "tuan", "--as", "duc"], [pw.duc, fresh, fresh])).code).toBe(0);
    expect((await cli(["staff-access", "minh", "--as", "duc", "--role", "ADMIN"], [pw.duc])).code).toBe(0);
    expect((await cli(["campaign-create", "campaign", "--as", "duc", "--apply"], [pw.duc])).code).toBe(0);
    for (const event of ["identity.staff.seeded", "identity.staff.seed_ran", "identity.staff.password_reset", "identity.staff.access_changed", "campaigns.campaign.created"]) {
      expect(audits(ledger, event).length).toBeGreaterThan(0);
    }
    expect(audits(ledger, "campaigns.campaign.created")).toEqual([expect.objectContaining({ actor_kind: "staff", actor_id: "duc", actor_role: "ADMIN", entity_id: "NOV2026" })]);
  });
});

describe("Story 4.20 context: passwords and sessions", () => {
  it("a password reset sets a new argon2id hash and ends the member's open sessions (D21)", async () => {
    const { ledger, cli } = setup();
    const pw = await seeded(cli);
    ledger.tx((db) => openSession(db, { kind: "STAFF", staffId: "tuan" }, CLOCK, STAFF_SESSION_MS));
    const fresh = generatedPassword();
    const run = await cli(["staff-password", "tuan", "--as", "duc"], [pw.duc, fresh, fresh]);
    expect(run).toMatchObject({ code: 0, lines: [{ ok: true, staffId: "tuan", sessionsEnded: 1 }] });
    const hash = (ledger.sqlite.prepare("SELECT password_hash FROM staff WHERE staff_id = 'tuan'").get() as { password_hash: string }).password_hash;
    expect(await verifyPassword(hash, fresh)).toBe(true);
    expect(await verifyPassword(hash, pw.tuan)).toBe(false);
  });

  it("no password is printed, audited or stored as typed; mistyped or short passwords are refused before anything is sent", async () => {
    const { ledger, cli } = setup();
    const pw = await seeded(cli);
    const short = await cli(["staff-password", "tuan", "--as", "duc"], [pw.duc, "short", "short"]);
    expect(short).toMatchObject({ code: 1, lines: [{ ok: false, reason: "password_too_short" }] });
    const differ = await cli(["staff-password", "tuan", "--as", "duc"], [pw.duc, generatedPassword(), generatedPassword()]);
    expect(differ).toMatchObject({ code: 1, lines: [{ ok: false, reason: "passwords_differ" }] });
    const everything = JSON.stringify([short.lines, differ.lines, ledger.sqlite.prepare("SELECT * FROM audit_entries").all(), ledger.sqlite.prepare("SELECT * FROM staff").all()]);
    for (const secret of Object.values(pw)) expect(everything).not.toContain(secret);
    expect(audits(ledger, "identity.staff.password_reset")).toEqual([]);
  });

  it("the CLI signs out at the end, and refuses a wrong admin password", async () => {
    const { ledger, cli } = setup();
    const pw = await seeded(cli);
    await cli(["staff-access", "minh", "--as", "duc", "--role", "EMPLOYEE"], [pw.duc]);
    expect(ledger.sqlite.prepare("SELECT end_reason FROM sessions WHERE staff_id = 'duc'").all()).toEqual([{ end_reason: "SIGNED_OUT" }]);
    const wrong = await cli(["staff-access", "minh", "--as", "duc", "--role", "EMPLOYEE"], [generatedPassword()]);
    expect(wrong).toMatchObject({ code: 1, lines: [{ ok: false, reason: "error.staff_sign_in_refused" }] });
  });

  it("the internal admin commands need the internal token, and a usage error exits 2", async () => {
    const { cli } = setup();
    const res = await servers?.internalApp.inject({ method: "POST", url: "/internal/admin/staff/seed/preview", payload: { seed: SEED } });
    expect(res?.statusCode).toBe(401);
    expect(await cli(["staff-password", "tuan"], [])).toMatchObject({ code: 2, lines: [{ ok: false, reason: "usage" }] });
    expect(await cli(["drop-everything", "x"], [])).toMatchObject({ code: 2 });
  });
});

describe("Sprint 15 code review: the CLI and the admin routes", () => {
  const post = (url: string, payload: object, token?: string) => servers?.internalApp.inject({ method: "POST", url, headers: { [INTERNAL_TOKEN_HEADER]: TOKEN, ...(token === undefined ? {} : { "x-staff-token": token }) }, payload });

  it("review 1: every failure is one JSON line with a reason code and no secret, never a stack trace", async () => {
    const { cli } = setup();
    const pw = await seeded(cli);
    const refused = Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
    const cases: [string, Partial<CliIo>, string[]][] = [
      ["server_unreachable", { call: async () => Promise.reject(refused) }, [pw.duc]],
      ["cancelled", { secret: async () => Promise.reject(new CliIoError("cancelled")) }, []],
      ["no_answer", {}, []],
      ["bad_response", { call: async () => ({ status: 200, body: { nonsense: true } }) }, [pw.duc]],
      ["failed", { call: async () => Promise.reject(new Error(`boom ${pw.duc}`)) }, [pw.duc]],
    ];
    for (const [reason, override, answers] of cases) {
      const run = await cli(["staff-access", "minh", "--as", "duc", "--role", "EMPLOYEE"], answers, {}, override);
      expect(run.code).toBe(1);
      expect(run.lines).toEqual([{ ok: false, command: "staff-access", reason }]);
      expect(JSON.stringify(run.lines)).not.toContain(pw.duc);
    }
    const missing = await cli(["campaign-create", "nowhere.json", "--as", "duc"], [pw.duc], {}, { readJson: () => { throw new Error("ENOENT"); } });
    expect(missing).toMatchObject({ code: 1, lines: [{ ok: false, reason: "invalid_file", file: "nowhere.json" }] });
  });

  it("review 5: a seed carrying a password for anyone the plan does not create is refused before anything is hashed or written", async () => {
    const { ledger, cli } = setup();
    const pw = await seeded(cli);
    const token = (JSON.parse((await post("/internal/admin/session", { username: "duc", password: pw.duc }))?.body ?? "{}") as { token: string }).token;
    const before = staffRows(ledger);
    const extra = await post("/internal/admin/staff/seed", { seed: SEED, passwords: { minh: generatedPassword() } }, token);
    expect(extra?.statusCode).toBe(400);
    expect(JSON.parse(extra?.body ?? "{}")).toMatchObject({ error: { messageKey: "error.staff.unexpected_password" } });
    const stranger = await post("/internal/admin/staff/seed", { seed: { ...SEED, members: [...SEED.members, { staffId: "lan", username: "lan", role: "EMPLOYEE" }] }, passwords: { lan: generatedPassword(), khoa: generatedPassword() } }, token);
    expect(stranger?.statusCode).toBe(400);
    const tooMany = await post("/internal/admin/staff/seed", { seed: { root: SEED.root, members: [] }, passwords: { a1: generatedPassword(), a2: generatedPassword() } }, token);
    expect(tooMany?.statusCode).toBe(400);
    expect(staffRows(ledger)).toEqual(before);
  });

  it("review 7: campaign preview and create both refuse a signed-in employee at the route, with the same answer", async () => {
    const { ledger, cli } = setup();
    const pw = await seeded(cli);
    const token = (JSON.parse((await post("/internal/admin/session", { username: "minh", password: pw.minh }))?.body ?? "{}") as { token: string }).token;
    for (const url of ["/internal/admin/campaigns/preview", "/internal/admin/campaigns"]) {
      const res = await post(url, { campaign: CAMPAIGN }, token);
      expect(res?.statusCode).toBe(403);
      expect(JSON.parse(res?.body ?? "{}")).toMatchObject({ error: { messageKey: "error.staff.admin_only" } });
    }
    expect(ledger.sqlite.prepare("SELECT count(*) AS n FROM campaigns WHERE campaign_id = 'NOV2026'").get()).toEqual({ n: 0 });
  });
});
