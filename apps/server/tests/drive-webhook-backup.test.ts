/**
 * The off-site copy through the Google Drive webhook (owner decision 2026-11-03): age and rclone
 * are not on the VPS, so the daily archive is encrypted with AES-256-GCM (BACKUP_ENCRYPTION_KEY)
 * and posted to the Apps Script web app the live system already uses. The HTTP call is a fake in
 * every test, so nothing reaches Google; the key, the URL and the token are made up.
 */
import { randomBytes } from "node:crypto";
import { closeSync, openSync, readFileSync, writeFileSync, ftruncateSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Instant } from "@cashback/core";
import { afterEach, describe, expect, it } from "vitest";

import { planCarryOver, CARRIED_SECRET_KEYS } from "../src/cutover/env-carry-over";
import { dailyBackupDeps, type OwnerJobsConfig } from "../src/health/owner-jobs";
import { productionGaps } from "../src/host/production-readiness";
import { SECRET_KEYS } from "../src/host/secrets-check";
import { assistantHeartbeats, ledgerAlerts } from "../src/modules/operations/index";
import { balanceTotals } from "../src/modules/payouts/index";
import { ArchiveCipherError, decryptArchive, encryptArchive, ENCRYPTED_ARCHIVE_MAGIC, ENCRYPTED_ARCHIVE_VERSION, IV_BYTES, parseEncryptionKey, TAG_BYTES } from "../src/platform/backup/archive-cipher";
import { backupStatusPath, readBackupStatus } from "../src/platform/backup/backup-status";
import { runDailyBackup } from "../src/platform/backup/daily-backup.job";
import { driveFileName, driveWebhookStore, MAX_PAYLOAD_BYTES, payloadBytes, type WebhookPost, type WebhookRequest, type WebhookResponse } from "../src/platform/backup/drive-webhook.adapter";
import { OffsiteError } from "../src/platform/backup/offsite.adapter";
import { ConfigError, parseConfig, REPOSITORY_ROOT } from "../src/platform/config/env.config";
import { isolationProblems, isolationWarnings, productionIdentifiers } from "../src/platform/config/isolation.config";
import { redact } from "../src/platform/log/logger";
import { restoreLedger } from "../src/restore/restore-ledger";
import { alertRows, memoryLogger } from "./helpers/link-ledger";
import { tempDir } from "./helpers/live-fixture";
import { closeLedgers, freshLedger, movingClock } from "./helpers/order-ledger";

afterEach(closeLedgers);

const KEY_TEXT = randomBytes(32).toString("base64");
const KEY = parseEncryptionKey(KEY_TEXT) as Buffer;
const URL = "https://script.google.com/macros/s/AKfake-webhook-id/exec";
const TOKEN = "fake-drive-token-1234";
const INTERNAL = "i".repeat(40);
/** 03:00 on 2026-11-02 in Vietnam. */
const RUN_AT = "2026-11-01T20:00:00.000Z";

const answer = (status: number, body: string): WebhookResponse => ({ status, text: async () => body });

function fakePost(answers: readonly (WebhookResponse | "hang")[]) {
  const calls: { url: string; request: WebhookRequest }[] = [];
  const post: WebhookPost = (url, request) => {
    calls.push({ url, request });
    const next = answers[Math.min(calls.length - 1, answers.length - 1)];
    if (next === "hang") return new Promise(() => undefined);
    return Promise.resolve(next as WebhookResponse);
  };
  return { post, calls };
}

function backedUp(post: WebhookPost, config: Partial<OwnerJobsConfig> = {}) {
  const dataDir = tempDir("cashback-webhook-");
  const ledger = freshLedger(join(dataDir, "ledger.sqlite"));
  ledger.sqlite.prepare("INSERT INTO orders (order_id, network, platform, customer_id, status, estimated_commission, approved_commission, cashback, paid_at, origin) VALUES ('261001APPR0001', 'shopee', 'shopee', 'C1', 'APPROVED', NULL, 100000, 79216, NULL, 'CUTOVER')").run();
  const clock = movingClock(RUN_AT);
  const { logger, lines } = memoryLogger();
  const full: OwnerJobsConfig = { env: "prod", dataDir, telegram: null, backupOffsite: null, assistantToken: null, backupOffsiteKind: "drive_webhook", backupDriveWebhook: { url: URL, token: TOKEN }, backupEncryptionKey: KEY_TEXT, ...config };
  const deps = dailyBackupDeps({ config: full, ledger, clock, logger, heartbeats: assistantHeartbeats(RUN_AT as Instant), health: {}, post, webhookRetryDelayMs: 1 }, ledgerAlerts(ledger, clock));
  return { dataDir, ledger, lines, deps };
}

const bodyOf = (request: WebhookRequest): Record<string, unknown> => JSON.parse(request.body) as Record<string, unknown>;

describe("Drive webhook off-site backup (owner decision 2026-11-03)", () => {
  it("posts the encrypted archive as {filename, mimeType, base64, token}; decrypted, it equals the checked local archive", async () => {
    const fake = fakePost([answer(200, JSON.stringify({ ok: true, drive_url: "https://drive.google.com/file/d/x" }))]);
    const s = backedUp(fake.post);
    const run = await runDailyBackup(s.deps);
    expect(run.outcome).toBe("ok");
    expect(fake.calls).toHaveLength(1);
    const [{ url, request }] = fake.calls as [{ url: string; request: WebhookRequest }];
    expect(url).toBe(URL);
    expect(request).toMatchObject({ method: "POST", headers: { "Content-Type": "application/json" }, redirect: "follow" });
    const body = bodyOf(request);
    expect(Object.keys(body).sort()).toEqual(["base64", "filename", "mimeType", "token"]);
    expect(body).toMatchObject({ filename: "cashback-prod-2026-11-02-0300.tar.enc", mimeType: "application/octet-stream", token: TOKEN });
    const sent = Buffer.from(body["base64"] as string, "base64");
    expect(sent.subarray(0, ENCRYPTED_ARCHIVE_MAGIC.length).equals(ENCRYPTED_ARCHIVE_MAGIC)).toBe(true);
    expect(decryptArchive(sent, KEY).equals(readFileSync(run.archive as string))).toBe(true);
    expect(readBackupStatus(backupStatusPath(s.dataDir))).toMatchObject({ lastOutcome: "ok", lastOffsiteAt: expect.any(String) });
    expect(alertRows(s.ledger)).toEqual([]);
  });

  it("an empty GDRIVE_SECRET_TOKEN is sent as an empty token, as the live system did", async () => {
    const fake = fakePost([answer(200, "{}")]);
    expect((await runDailyBackup(backedUp(fake.post, { backupDriveWebhook: { url: URL, token: "" } }).deps)).outcome).toBe("ok");
    expect(bodyOf(fake.calls[0]!.request)["token"]).toBe("");
  });

  it("the .tar.enc copy restores with the key; a wrong key, no key or an age file is refused, and a plain tar still restores", async () => {
    const fake = fakePost([answer(200, "{}")]);
    const s = backedUp(fake.post);
    const run = await runDailyBackup(s.deps);
    const download = join(tempDir("cashback-download-"), "cashback-prod-2026-11-02-0300.tar.enc");
    writeFileSync(download, Buffer.from(bodyOf(fake.calls[0]!.request)["base64"] as string, "base64"));
    const restore = (archive: string, key: Buffer | null) => restoreLedger({ archive, dataDir: tempDir("cashback-clean-"), clock: movingClock("2026-11-05T02:00:00.000Z"), replace: false, totals: balanceTotals, decryptionKey: key });
    expect(await restore(download, KEY)).toMatchObject({ ok: true, totals: balanceTotals(s.ledger.db), backupCreatedAt: RUN_AT });
    expect(await restore(download, randomBytes(32))).toMatchObject({ ok: false, refusal: "decrypt_failed", problems: ["wrong_key_or_damaged"] });
    expect(await restore(download, null)).toMatchObject({ ok: false, refusal: "key_missing" });
    const age = join(tempDir("cashback-age-"), "x-daily.tar.age");
    writeFileSync(age, "age-encryption.org/v1\n-> X25519 fake\n");
    expect(await restore(age, KEY)).toMatchObject({ ok: false, refusal: "age_encrypted" });
    expect(await restore(run.archive as string, null)).toMatchObject({ ok: true });
  });

  it("refuses a payload over 45 MB before reading or sending it; the run raises backup_offsite_too_large and keeps the local copy", async () => {
    const big = join(tempDir("cashback-big-"), "2026-11-01T20-00-00.000Z-daily.tar");
    const fd = openSync(big, "w");
    ftruncateSync(fd, Math.ceil((MAX_PAYLOAD_BYTES * 3) / 4));
    closeSync(fd);
    const fake = fakePost([answer(200, "{}")]);
    const store = driveWebhookStore({ url: URL, token: TOKEN }, { env: "prod", key: KEY, post: fake.post });
    await expect(store.send(big, store.remoteName("2026-11-01T20-00-00.000Z-daily.tar"))).rejects.toMatchObject({ step: "too_large" });
    expect(fake.calls).toEqual([]);
    expect(payloadBytes(1000, "a.tar.enc", "t")).toBeLessThan(MAX_PAYLOAD_BYTES);
    expect(payloadBytes(34 * 1024 * 1024, "a.tar.enc", "t")).toBeGreaterThan(MAX_PAYLOAD_BYTES);

    const s = backedUp(fake.post);
    const run = await runDailyBackup({ ...s.deps, offsite: { kind: "drive_webhook", remoteName: (n) => n, send: () => Promise.reject(new OffsiteError("too_large", null)) } });
    expect(run.outcome).toBe("offsite_failed");
    expect(readFileSync(run.archive as string).length).toBeGreaterThan(0);
    expect(alertRows(s.ledger)).toEqual([{ kind: "backup_offsite_too_large", severity: "high", suppressed: 0 }]);
    expect(readBackupStatus(backupStatusPath(s.dataDir))).toMatchObject({ lastOutcome: "offsite_failed", failedStep: "too_large" });
    const labels = JSON.parse(readFileSync(join(REPOSITORY_ROOT, "packages", "labels", "vi", "alerts.json"), "utf8")) as { kinds: Record<string, { details: string }> };
    expect(labels.kinds["backup_offsite_too_large"]?.details).toContain("45 MB");
  });

  it("an attempt that hangs past its time limit is tried once more, then fails as send; a failed first attempt then a good one succeeds", async () => {
    const hang = fakePost(["hang"]);
    const retried: string[] = [];
    const file = join(tempDir("cashback-small-"), "2026-11-01T20-00-00.000Z-daily.tar");
    writeFileSync(file, "archive bytes");
    const slow = driveWebhookStore({ url: URL, token: TOKEN }, { env: "prod", key: KEY, post: hang.post, timeoutMs: 20, retryDelayMs: 1, onRetry: (e) => retried.push(e.step) });
    await expect(slow.send(file, "x.tar.enc")).rejects.toMatchObject({ step: "send", code: null });
    expect(hang.calls).toHaveLength(2);
    expect(hang.calls.every((c) => c.request.signal.aborted)).toBe(true);
    expect(retried).toEqual(["send"]);

    const flaky = fakePost([answer(502, "Bad gateway"), answer(200, JSON.stringify({ url: "https://drive.google.com/x" }))]);
    await driveWebhookStore({ url: URL, token: TOKEN }, { env: "prod", key: KEY, post: flaky.post, retryDelayMs: 1 }).send(file, "x.tar.enc");
    expect(flaky.calls).toHaveLength(2);
    expect(flaky.calls[0]!.request.body).toBe(flaky.calls[1]!.request.body);

    for (const [reply, step] of [[answer(200, "<html>Script error</html>"), "response"], [answer(200, JSON.stringify({ ok: false, error: "bad token" })), "response"], [answer(403, "{}"), "send"]] as const) {
      const once = fakePost([reply]);
      await expect(driveWebhookStore({ url: URL, token: TOKEN }, { env: "prod", key: KEY, post: once.post, retryDelayMs: 1 }).send(file, "x.tar.enc")).rejects.toMatchObject({ step });
      expect(once.calls).toHaveLength(2);
    }
  });

  it("a failed copy raises backup_offsite_failed with the step and status logged, never the URL, the token or the key", async () => {
    const fake = fakePost([answer(500, "{}")]);
    const s = backedUp(fake.post);
    const run = await runDailyBackup(s.deps);
    expect(run.outcome).toBe("offsite_failed");
    expect(fake.calls).toHaveLength(2);
    expect(alertRows(s.ledger)).toEqual([{ kind: "backup_offsite_failed", severity: "high", suppressed: 0 }]);
    const failed = s.lines.map((l) => JSON.parse(l) as Record<string, unknown>).find((l) => l["msg"] === "platform.backup.offsite_failed");
    expect(failed).toMatchObject({ step: "send", code: 500 });
    expect(s.lines.some((l) => l.includes("platform.backup.offsite_retry"))).toBe(true);
    const all = s.lines.join("\n");
    for (const secret of [KEY_TEXT, URL, "AKfake-webhook-id", TOKEN]) expect(all).not.toContain(secret);
    expect(redact({ webhookUrl: URL, gdriveWebhookUrl: URL, encryptionKey: KEY_TEXT, backupEncryptionKey: KEY_TEXT, secretToken: TOKEN })).toEqual({ webhookUrl: "[redacted]", gdriveWebhookUrl: "[redacted]", encryptionKey: "[redacted]", backupEncryptionKey: "[redacted]", secretToken: "[redacted]" });
  });

  it("production with the webhook but no key sends nothing and fails as not_configured", async () => {
    const fake = fakePost([answer(200, "{}")]);
    const s = backedUp(fake.post, { backupDriveWebhook: null, backupEncryptionKey: null });
    expect(s.deps.offsite).toBeNull();
    expect((await runDailyBackup(s.deps)).outcome).toBe("offsite_failed");
    expect(fake.calls).toEqual([]);
    expect(readBackupStatus(backupStatusPath(s.dataDir)).failedStep).toBe("not_configured");
  });
});

describe("AES-256-GCM archive format", () => {
  it("magic, version, 12-byte IV, ciphertext and 16-byte tag; a changed byte or a wrong key never decrypts", () => {
    const plain = Buffer.from("a tar archive");
    const sealed = encryptArchive(plain, KEY);
    expect(sealed.length).toBe(ENCRYPTED_ARCHIVE_MAGIC.length + 1 + IV_BYTES + plain.length + TAG_BYTES);
    expect(sealed[ENCRYPTED_ARCHIVE_MAGIC.length]).toBe(ENCRYPTED_ARCHIVE_VERSION);
    expect(decryptArchive(sealed, KEY).equals(plain)).toBe(true);
    expect(encryptArchive(plain, KEY).equals(sealed)).toBe(false);
    const changed = Buffer.from(sealed);
    changed[changed.length - TAG_BYTES - 1]! ^= 1;
    expect(() => decryptArchive(changed, KEY)).toThrow(ArchiveCipherError);
    expect(() => decryptArchive(sealed, randomBytes(32))).toThrow("wrong_key_or_damaged");
    const relabelled = Buffer.from(sealed);
    relabelled[ENCRYPTED_ARCHIVE_MAGIC.length] = 2;
    expect(() => decryptArchive(relabelled, KEY)).toThrow("unknown_version");
    expect(() => decryptArchive(plain, KEY)).toThrow("not_encrypted");
    expect(parseEncryptionKey(KEY_TEXT)?.length).toBe(32);
    for (const bad of [undefined, "", randomBytes(16).toString("base64"), randomBytes(32).toString("base64url"), `${KEY_TEXT}x`]) expect(parseEncryptionKey(bad)).toBeNull();
    expect(driveFileName("dev", "2026-11-01T20-00-00.000Z-daily.tar")).toBe("cashback-dev-2026-11-02-0300.tar.enc");
  });
});

describe("Drive webhook configuration", () => {
  const base = { INTERNAL_TOKEN: INTERNAL };
  const rclone = { BACKUP_AGE_PATH: "C:/t/age.exe", BACKUP_AGE_RECIPIENT: `age1${"q".repeat(58)}`, BACKUP_RCLONE_PATH: "C:/t/rclone.exe", BACKUP_RCLONE_REMOTE: "gdrive:b/prod" };

  it("chooses drive_webhook with GDRIVE_WEBHOOK_URL and no rclone keys, rclone otherwise, and never a webhook without a valid key", () => {
    expect(parseConfig("prod", { ...base, GDRIVE_WEBHOOK_URL: URL, GDRIVE_SECRET_TOKEN: TOKEN, BACKUP_ENCRYPTION_KEY: KEY_TEXT })).toMatchObject({ backupOffsiteKind: "drive_webhook", backupDriveWebhook: { url: URL, token: TOKEN }, backupEncryptionKey: KEY_TEXT });
    expect(parseConfig("prod", { ...base, GDRIVE_WEBHOOK_URL: URL })).toMatchObject({ backupOffsiteKind: "drive_webhook", backupDriveWebhook: null });
    expect(parseConfig("prod", { ...base, ...rclone, GDRIVE_WEBHOOK_URL: URL, BACKUP_ENCRYPTION_KEY: KEY_TEXT })).toMatchObject({ backupOffsiteKind: "rclone", backupDriveWebhook: null });
    expect(parseConfig("prod", { ...base, ...rclone, BACKUP_OFFSITE: "drive_webhook", GDRIVE_WEBHOOK_URL: URL, BACKUP_ENCRYPTION_KEY: KEY_TEXT })).toMatchObject({ backupOffsiteKind: "drive_webhook", backupDriveWebhook: { url: URL, token: "" } });
    expect(parseConfig("prod", base)).toMatchObject({ backupOffsiteKind: null, backupDriveWebhook: null });
    expect(() => parseConfig("prod", { ...base, BACKUP_OFFSITE: "drive_webhook", GDRIVE_WEBHOOK_URL: URL })).toThrow("config: missing or invalid BACKUP_ENCRYPTION_KEY");
    expect(() => parseConfig("prod", { ...base, BACKUP_OFFSITE: "rclone" })).toThrow(ConfigError);
    const badKey = randomBytes(16).toString("base64");
    expect(() => parseConfig("prod", { ...base, BACKUP_ENCRYPTION_KEY: badKey })).toThrow("config: missing or invalid BACKUP_ENCRYPTION_KEY");
    try {
      parseConfig("prod", { ...base, BACKUP_ENCRYPTION_KEY: badKey });
    } catch (error) {
      expect(String(error)).not.toContain(badKey);
    }
    expect(() => parseConfig("prod", { ...base, GDRIVE_WEBHOOK_URL: "http://script.google.com/x" })).toThrow(/GDRIVE_WEBHOOK_URL/);
  });

  it("the go-live check accepts the webhook with its key as the off-site copy and names what is missing", () => {
    const gaps = (values: Record<string, string>) => productionGaps(parseConfig("prod", { ...base, ...values })).filter((g) => /BACKUP|GDRIVE/.test(g));
    expect(gaps({})).toEqual(["GDRIVE_WEBHOOK_URL, BACKUP_ENCRYPTION_KEY"]);
    expect(gaps({ GDRIVE_WEBHOOK_URL: URL })).toEqual(["BACKUP_ENCRYPTION_KEY"]);
    expect(gaps({ GDRIVE_WEBHOOK_URL: URL, BACKUP_ENCRYPTION_KEY: KEY_TEXT })).toEqual([]);
    expect(gaps(rclone)).toEqual([]);
  });

  it("dev never uses production's webhook or key unless ALLOW_PROD_BACKUP_OFFSITE=1, which is logged", () => {
    const context = { identifiers: productionIdentifiers(REPOSITORY_ROOT, join(tmpdir(), "cashback-isolation-home")), prodEnv: { GDRIVE_WEBHOOK_URL: `${URL}/`, BACKUP_ENCRYPTION_KEY: KEY_TEXT }, devFileIsProdFile: false, caseInsensitive: process.platform === "win32" };
    const dev = (extra: Record<string, string> = {}) => parseConfig("dev", { ...base, GDRIVE_WEBHOOK_URL: URL, BACKUP_ENCRYPTION_KEY: KEY_TEXT, ...extra });
    expect(isolationProblems(dev(), context).map((p) => `${p.key} ${p.reason}`)).toEqual(["BACKUP_ENCRYPTION_KEY same_as_production", "GDRIVE_WEBHOOK_URL same_as_production"]);
    expect(isolationProblems(dev({ ALLOW_PROD_BACKUP_OFFSITE: "1" }), context)).toEqual([]);
    expect(isolationWarnings(dev({ ALLOW_PROD_BACKUP_OFFSITE: "1" }), context)).toEqual(["BACKUP_ENCRYPTION_KEY shared_with_production", "GDRIVE_WEBHOOK_URL shared_with_production"]);
    expect(isolationProblems(dev({ GDRIVE_WEBHOOK_URL: "https://script.google.com/macros/s/dev-own/exec", BACKUP_ENCRYPTION_KEY: randomBytes(32).toString("base64") }), context)).toEqual([]);
  });

  it("the cutover carries GDRIVE_WEBHOOK_URL and GDRIVE_SECRET_TOKEN over from the live .env, and the secrets check covers the new keys", () => {
    const plan = planCarryOver(`GDRIVE_WEBHOOK_URL=${URL}\nGDRIVE_SECRET_TOKEN=${TOKEN}\n`, "INTERNAL_TOKEN=x\n");
    expect(plan.carried).toEqual(expect.arrayContaining(["GDRIVE_WEBHOOK_URL", "GDRIVE_SECRET_TOKEN"]));
    expect(plan.text).toContain(`GDRIVE_WEBHOOK_URL=${URL}`);
    expect(CARRIED_SECRET_KEYS).toEqual(expect.arrayContaining(["GDRIVE_WEBHOOK_URL", "GDRIVE_SECRET_TOKEN"]));
    expect(SECRET_KEYS).toEqual(expect.arrayContaining(["GDRIVE_WEBHOOK_URL", "GDRIVE_SECRET_TOKEN", "BACKUP_ENCRYPTION_KEY"]));
  });
});
