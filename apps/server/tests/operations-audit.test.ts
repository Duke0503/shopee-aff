/**
 * Story 3.2: the audit trail and the owner alert port. Audit entries are written in the
 * command's own transaction with its actor, carry ids and fingerprints only, and are
 * insert-only; alerts are stored with the AD-27 cooldowns and delivered by a sender outside any
 * transaction (a fake here; the Telegram adapter is driven through a fake fetch).
 */
import { join } from "node:path";
import { fixedClock, instantFromMs, parseInstant, toMs, type Clock } from "@cashback/core";
import { afterEach, describe, expect, it } from "vitest";

import { bankFingerprint, issueCustomerCode } from "../src/modules/identity/index";
import { enqueue, seedSentNotifications } from "../src/modules/messaging/index";
import {
  ALERT_COOLDOWN_MS,
  ALERT_MAX_ATTEMPTS,
  alertsFor,
  AuditEntryError,
  auditFor,
  commandAudit,
  deliverPendingAlerts,
  ledgerAlerts,
  TelegramSendError,
  telegramSender,
  type AlertSender,
  type FetchLike,
} from "../src/modules/operations/index";
import { openLedger, type Ledger } from "../src/platform/db/ledger";
import { MIGRATIONS_DIR, readMigrations, runMigrations } from "../src/platform/db/migrations";
import type { AuditEntry } from "../src/platform/ports/audit.port";
import { auditBy, FINGERPRINT_KEY, TEST_ACTOR, TEST_CLOCK, tempDir } from "./helpers/live-fixture";

const opened: Ledger[] = [];
afterEach(() => {
  for (const ledger of opened.splice(0)) ledger.close();
});

function freshLedger(): Ledger {
  const ledger = openLedger(join(tempDir("cashback-operations-"), "ledger.sqlite"));
  runMigrations(ledger, readMigrations(MIGRATIONS_DIR), TEST_CLOCK);
  ledger.sqlite.exec(`
    INSERT INTO customers (customer_id, customer_code, role, status) VALUES ('C1', 'DP00001', 'USER', 'ACTIVE'), ('HOUSE', NULL, 'HOUSE', 'ACTIVE');
    INSERT INTO customer_code_counter (id, last) VALUES (1, 1);`);
  opened.push(ledger);
  return ledger;
}

const entries = (ledger: Ledger) => ledger.sqlite.prepare("SELECT recorded_at, actor_kind, actor_id, event, entity_id, payload, reason FROM audit_entries ORDER BY id").all();
const silent = { warn: () => undefined, info: () => undefined };

/** A clock the test moves forward by hand. */
function movingClock(start: string): Clock & { advance(ms: number): void } {
  let at = toMs(parseInstant(start));
  return { now: () => instantFromMs(at), advance: (ms) => void (at += ms) };
}

describe("Story 3.2 acceptance criteria", () => {
  it("AC1: a command whose transaction rolls back leaves no audit entry; one that commits leaves exactly one, with actor kind, actor id and time", () => {
    const ledger = freshLedger();
    expect(() =>
      ledger.tx((db) => {
        issueCustomerCode(db, silent, auditBy(db));
        throw new Error("the rest of the command failed");
      }),
    ).toThrow("the rest of the command failed");
    expect(entries(ledger)).toEqual([]);
    expect(ledger.tx((db) => issueCustomerCode(db, silent, auditBy(db)))).toBe("DP00002");
    expect(entries(ledger)).toEqual([
      { recorded_at: TEST_CLOCK.now(), actor_kind: "staff", actor_id: "admin", event: "identity.customer_code.issued", entity_id: "DP00002", payload: '{"customerCode":"DP00002","skipped":0}', reason: null },
    ]);
  });

  it("AC2: a payload with a bank number, holder name or phone number is refused by type and at run time; a bank account appears only as its fingerprint", () => {
    const ledger = freshLedger();
    const base = { actor: TEST_ACTOR, event: "identity.bank_account.saved", entityId: "C1" } as const;
    // @ts-expect-error a bank number is personal data
    const bankNumber: AuditEntry = { ...base, payload: { accountNumber: "0011223344" } };
    // @ts-expect-error a holder name is personal data
    const holder: AuditEntry = { ...base, payload: { holderName: "NGUYEN VAN AN" } };
    // @ts-expect-error a phone number is personal data
    const phone: AuditEntry = { ...base, payload: { phone: "0912345678" } };
    const sneaky: AuditEntry[] = [
      { ...base, payload: { bank_account_number: "0011223344" } },
      { ...base, payload: { note: "NGUYEN VAN AN" } },
      { ...base, payload: { contact: "0912345678" } },
      { ...base, payload: { contact: "+84912345678" } },
      { ...base, payload: { bankFingerprint: "0011223344" } },
    ];
    for (const entry of [bankNumber, holder, phone, ...sneaky]) {
      expect(() => ledger.tx((db) => auditFor(db, TEST_CLOCK).record(entry))).toThrow(AuditEntryError);
    }
    expect(entries(ledger)).toEqual([]);
    const fingerprint = bankFingerprint(FINGERPRINT_KEY, "0011 2233 4455");
    ledger.tx((db) => auditFor(db, TEST_CLOCK).record({ ...base, payload: { customerId: "C1", bankFingerprint: fingerprint, consent: true } }));
    expect(entries(ledger)).toHaveLength(1);
    expect(JSON.stringify(entries(ledger))).not.toContain("0011");
  });

  it("AC2: the refusal names the key and the problem, never the value", () => {
    const ledger = freshLedger();
    try {
      ledger.tx((db) => auditFor(db, TEST_CLOCK).record({ actor: TEST_ACTOR, event: "identity.customer.updated", entityId: "C1", payload: { note: "NGUYEN VAN AN" } }));
      throw new Error("not refused");
    } catch (error) {
      expect(error).toBeInstanceOf(AuditEntryError);
      expect((error as Error).message).toBe("audit payload refused: note (whitespace)");
    }
  });

  it("AC3: an UPDATE or DELETE on audit_entries is rejected by the trigger", () => {
    const ledger = freshLedger();
    ledger.tx((db) => issueCustomerCode(db, silent, auditBy(db)));
    expect(() => ledger.sqlite.exec("UPDATE audit_entries SET actor_id = 'someone else'")).toThrow(/insert_only: audit_entries/);
    expect(() => ledger.sqlite.exec("DELETE FROM audit_entries")).toThrow(/insert_only: audit_entries/);
    expect(entries(ledger)).toHaveLength(1);
  });

  it('AC4: alert("reconciliation_failed", "high") twice within the cooldown stores one pending alert and counts the second as suppressed', () => {
    const ledger = freshLedger();
    const clock = movingClock("2026-10-30T07:00:00.000Z");
    const alerts = ledgerAlerts(ledger, clock);
    alerts.alert("reconciliation_failed", "high");
    clock.advance(ALERT_COOLDOWN_MS.high - 1);
    alerts.alert("reconciliation_failed", "high");
    expect(ledger.sqlite.prepare("SELECT kind, severity, delivery, suppressed, raised_at FROM alerts").all()).toEqual([
      { kind: "reconciliation_failed", severity: "high", delivery: "PENDING", suppressed: 1, raised_at: "2026-10-30T07:00:00.000Z" },
    ]);
    // After the cooldown, or at another severity, it is a new alert.
    clock.advance(1);
    alerts.alert("reconciliation_failed", "high");
    alerts.alert("reconciliation_failed", "critical");
    expect(ledger.sqlite.prepare("SELECT severity, suppressed FROM alerts ORDER BY id").all()).toEqual([
      { severity: "high", suppressed: 1 },
      { severity: "high", suppressed: 0 },
      { severity: "critical", suppressed: 0 },
    ]);
  });
});

describe("Story 3.2: alerts", () => {
  it("a repeat after the last alert was SENT or FAILED is a new alert, even inside the cooldown", () => {
    const ledger = freshLedger();
    const clock = movingClock("2026-10-30T07:00:00.000Z");
    const alerts = ledgerAlerts(ledger, clock);
    alerts.alert("assistant_down", "critical");
    ledger.sqlite.exec("UPDATE alerts SET delivery = 'FAILED', attempts = 5");
    clock.advance(60_000);
    alerts.alert("assistant_down", "critical");
    ledger.sqlite.exec("UPDATE alerts SET delivery = 'SENT' WHERE id = 2");
    clock.advance(60_000);
    alerts.alert("assistant_down", "critical");
    alerts.alert("assistant_down", "critical");
    expect(ledger.sqlite.prepare("SELECT id, delivery, suppressed FROM alerts ORDER BY id").all()).toEqual([
      { id: 1, delivery: "FAILED", suppressed: 0 },
      { id: 2, delivery: "SENT", suppressed: 0 },
      { id: 3, delivery: "PENDING", suppressed: 1 },
    ]);
  });

  it("once the sender accepted an alert it is never marked failed nor sent again; only the SENT bookkeeping is retried", async () => {
    const ledger = freshLedger();
    ledgerAlerts(ledger, TEST_CLOCK).alert("backup_failed", "high");
    const lines: { fields: Record<string, unknown>; event: string }[] = [];
    const logger = { info: () => undefined, warn: (fields: Record<string, unknown>, event: string) => void lines.push({ fields, event }) } as unknown as Parameters<typeof deliverPendingAlerts>[3];
    let calls = 0;
    let failMarks = 2;
    const flaky = {
      tx: <T>(fn: Parameters<Ledger["tx"]>[0]): T => {
        calls++;
        // The third transaction is the first SENT bookkeeping: claim was the second.
        if (calls >= 3 && failMarks > 0) {
          failMarks--;
          throw new Error("disk full");
        }
        return ledger.tx(fn) as T;
      },
    };
    const sent: string[] = [];
    const sender: AlertSender = { send: async (text) => void sent.push(text) };
    expect(await deliverPendingAlerts(flaky, sender, TEST_CLOCK, logger)).toEqual({ sent: 1, failed: 0 });
    expect(sent).toHaveLength(1);
    expect(lines.filter((l) => l.event === "operations.alert.delivery_bookkeeping_failed").map((l) => l.fields["attempt"])).toEqual([1, 2]);
    expect(ledger.sqlite.prepare("SELECT delivery, attempts FROM alerts").get()).toEqual({ delivery: "SENT", attempts: 1 });

    // When every bookkeeping try fails, the alert stays SENDING and is never sent again.
    ledgerAlerts(ledger, movingClock("2026-10-30T08:00:00.000Z")).alert("backup_failed", "high");
    // Pending read and claim go through; every SENT bookkeeping after them fails.
    let txs = 0;
    const broken = {
      tx: <T>(fn: Parameters<Ledger["tx"]>[0]): T => {
        if (++txs > 2) throw new Error("disk full");
        return ledger.tx(fn) as T;
      },
    };
    expect(await deliverPendingAlerts(broken, sender, TEST_CLOCK, logger)).toEqual({ sent: 1, failed: 0 });
    expect(ledger.sqlite.prepare("SELECT delivery FROM alerts WHERE id = 2").get()).toEqual({ delivery: "SENDING" });
    expect(await deliverPendingAlerts(ledger, sender, TEST_CLOCK, logger)).toEqual({ sent: 0, failed: 0 });
    expect(sent).toHaveLength(2);
  });

  it("uses the AD-27 cooldowns: critical 5, high 15, warning 30 minutes", () => {
    expect(ALERT_COOLDOWN_MS).toEqual({ critical: 300_000, high: 900_000, warning: 1_800_000 });
  });

  it("an alert raised inside a command rolls back with it", () => {
    const ledger = freshLedger();
    expect(() =>
      ledger.tx((db) => {
        alertsFor(db, TEST_CLOCK).alert("order_reversed", "warning");
        throw new Error("rolled back");
      }),
    ).toThrow("rolled back");
    expect(ledger.sqlite.prepare("SELECT count(*) AS n FROM alerts").get()).toEqual({ n: 0 });
  });

  it("refuses a kind that is not snake_case (no free text, so no personal data)", () => {
    const ledger = freshLedger();
    expect(() => ledgerAlerts(ledger, TEST_CLOCK).alert("Payout for Nguyen Van An", "high")).toThrow(RangeError);
  });

  it("delivers pending alerts through the sender outside any transaction, marks them sent, and retries a failure until it gives up", async () => {
    const ledger = freshLedger();
    const clock = movingClock("2026-10-30T07:00:00.000Z");
    const alerts = ledgerAlerts(ledger, clock);
    alerts.alert("backup_failed", "high");
    alerts.alert("backup_failed", "high");
    const sent: string[] = [];
    const sender: AlertSender = {
      send: async (text) => {
        expect(ledger.sqlite.inTransaction).toBe(false);
        sent.push(text);
      },
    };
    expect(await deliverPendingAlerts(ledger, sender, clock, silent)).toEqual({ sent: 1, failed: 0 });
    expect(sent).toEqual(["[HIGH] backup_failed (repeated 1 more times inside the cooldown)"]);
    expect(ledger.sqlite.prepare("SELECT delivery, attempts, delivered_at FROM alerts").all()).toEqual([{ delivery: "SENT", attempts: 1, delivered_at: "2026-10-30T07:00:00.000Z" }]);
    expect(await deliverPendingAlerts(ledger, sender, clock, silent)).toEqual({ sent: 0, failed: 0 });

    clock.advance(ALERT_COOLDOWN_MS.critical);
    alerts.alert("assistant_down", "critical");
    const failing: AlertSender = { send: () => Promise.reject(new TelegramSendError(502)) };
    for (let i = 1; i < ALERT_MAX_ATTEMPTS; i++) await deliverPendingAlerts(ledger, failing, clock, silent);
    expect(ledger.sqlite.prepare("SELECT delivery, attempts FROM alerts WHERE kind = 'assistant_down'").get()).toEqual({ delivery: "PENDING", attempts: ALERT_MAX_ATTEMPTS - 1 });
    await deliverPendingAlerts(ledger, failing, clock, silent);
    expect(ledger.sqlite.prepare("SELECT delivery, attempts FROM alerts WHERE kind = 'assistant_down'").get()).toEqual({ delivery: "FAILED", attempts: ALERT_MAX_ATTEMPTS });
  });

  it("the Telegram adapter posts one sendMessage to the owner's chat and never puts the token in an error", async () => {
    const calls: { url: string; body: string }[] = [];
    const ok: FetchLike = async (url, init) => {
      calls.push({ url, body: init.body });
      return { ok: true, status: 200 };
    };
    await telegramSender({ botToken: "123:SECRET", chatId: "-100200", fetch: ok }).send("[HIGH] backup_failed");
    expect(calls).toEqual([{ url: "https://api.telegram.org/bot123:SECRET/sendMessage", body: '{"chat_id":"-100200","text":"[HIGH] backup_failed","disable_web_page_preview":true}' }]);

    const down: FetchLike = () => Promise.reject(new Error("connect ECONNREFUSED https://api.telegram.org/bot123:SECRET/sendMessage"));
    await expect(telegramSender({ botToken: "123:SECRET", chatId: "-100200", fetch: down }).send("x")).rejects.toThrow(/^telegram: request failed$/);
    const refused: FetchLike = async () => ({ ok: false, status: 401 });
    await expect(telegramSender({ botToken: "123:SECRET", chatId: "-100200", fetch: refused }).send("x")).rejects.toThrow("telegram: HTTP 401");
  });
});

describe("Story 3.2: every existing command writes its audit entry in its own transaction", () => {
  const LATER = fixedClock("2026-10-31T07:00:00.000Z");
  const message = { dedupKey: "order:O1:approved", customerId: "C1", messageKey: "order_approved", params: { cashback: 6228 } };

  it("outbox enqueue: one entry when a row is added, none for a duplicate or a refused guest", () => {
    const ledger = freshLedger();
    expect(ledger.tx((db) => enqueue(db, LATER, message, auditBy(db, LATER)))).toBe("enqueued");
    expect(ledger.tx((db) => enqueue(db, LATER, message, auditBy(db, LATER)))).toBe("duplicate");
    expect(ledger.tx((db) => enqueue(db, LATER, { ...message, dedupKey: "order:O2:approved", customerId: "HOUSE" }, auditBy(db, LATER)))).toBe("refused_guest");
    expect(entries(ledger)).toEqual([
      { recorded_at: LATER.now(), actor_kind: "staff", actor_id: "admin", event: "messaging.outbox.enqueued", entity_id: "order:O1:approved", payload: '{"customerId":"C1","messageKey":"order_approved"}', reason: null },
    ]);
  });

  it("a customer id shaped like a phone number is an identifier: the enqueue and its audit entry go through", () => {
    const ledger = freshLedger();
    ledger.sqlite.exec("INSERT INTO customers (customer_id, role, status) VALUES ('0912345678', 'USER', 'ACTIVE')");
    expect(ledger.tx((db) => enqueue(db, LATER, { ...message, dedupKey: "order:O9:approved", customerId: "0912345678" }, auditBy(db, LATER)))).toBe("enqueued");
    expect(entries(ledger)).toMatchObject([{ entity_id: "order:O9:approved", payload: '{"customerId":"0912345678","messageKey":"order_approved"}' }]);
    // A free-text key with the same value is still refused, and an id key never makes a Zalo id acceptable.
    expect(() => ledger.tx((db) => auditFor(db, LATER).record({ actor: TEST_ACTOR, event: "messaging.outbox.enqueued", entityId: "x", payload: { contact: "0912345678" } }))).toThrow(AuditEntryError);
    expect(() => ledger.tx((db) => auditFor(db, LATER).record({ actor: TEST_ACTOR, event: "messaging.outbox.enqueued", entityId: "x", payload: { zaloUid: "123" } }))).toThrow(AuditEntryError);
  });

  it("outbox seed: one entry with the count, rolled back with the seed", () => {
    const ledger = freshLedger();
    const seeds = [{ dedupKey: "order:O1:paid", customerId: "C1", messageKey: "order_paid", sentAt: null }];
    expect(() =>
      ledger.tx((db) => {
        seedSentNotifications(db, seeds, TEST_CLOCK.now(), commandAudit(db, TEST_CLOCK, { kind: "system", id: "cutover" }));
        throw new Error("import failed later");
      }),
    ).toThrow("import failed later");
    expect(entries(ledger)).toEqual([]);
    ledger.tx((db) => seedSentNotifications(db, seeds, TEST_CLOCK.now(), commandAudit(db, TEST_CLOCK, { kind: "system", id: "cutover" })));
    expect(entries(ledger)).toMatchObject([{ actor_kind: "system", actor_id: "cutover", event: "messaging.outbox.seeded", payload: '{"seeded":1}' }]);
  });

  it("an actor without an id, or an event not named context.aggregate.verb, is refused", () => {
    const ledger = freshLedger();
    const record = (entry: AuditEntry) => ledger.tx((db) => auditFor(db, TEST_CLOCK).record(entry));
    expect(() => record({ actor: { kind: "staff", id: " " }, event: "identity.customer.updated", entityId: "C1", payload: {} })).toThrow(AuditEntryError);
    expect(() => record({ actor: TEST_ACTOR, event: "updated", entityId: "C1", payload: {} })).toThrow(AuditEntryError);
    expect(() => record({ actor: TEST_ACTOR, event: "identity.customer.updated", entityId: "", payload: {} })).toThrow(AuditEntryError);
  });
});
