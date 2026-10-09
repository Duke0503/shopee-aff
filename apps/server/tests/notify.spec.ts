import { fileURLToPath } from "node:url";

import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { describe, expect, it } from "vitest";

import { JobRunner, type ScheduledJob } from "../src/jobs/job-runner";
import { runSteps } from "../src/jobs/notify.job";
import { notifyFailedLinks } from "../src/modules/affiliate/application/notify-failed-links.use-case";
import { notifyLateLinks } from "../src/modules/affiliate/application/notify-late-links.use-case";
import { notifyPayouts } from "../src/modules/ledger/application/notify-payouts.use-case";
import { notifyOrderChanges } from "../src/modules/orders/application/notify-order-changes.use-case";
import { HttpDelivery, type DeliveryPort } from "../src/notifications/delivery";
import { loadMessages } from "../src/notifications/messages";
import type { Db } from "../src/shared/database/connection";
import { customers, linkRequests, orders, paymentTransfers } from "../src/shared/database/schema";
import * as schema from "../src/shared/database/schema";

const messages = loadMessages(
  fileURLToPath(new URL("../../../resources/messages.vi.json", import.meta.url)),
);

class FakeDelivery implements DeliveryPort {
  readonly sent: Array<{ to: string; text: string }> = [];

  constructor(private readonly ok = true) {}

  async sendPrivate(zaloUserId: string, text: string): Promise<boolean> {
    if (!this.ok) return false;
    this.sent.push({ to: zaloUserId, text });
    return true;
  }

  async sendGroup(): Promise<boolean> {
    return this.ok;
  }

  async sendTelegram(): Promise<boolean> {
    return this.ok;
  }
}

function makeDb(): Db {
  const sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE customers (customer_id TEXT PRIMARY KEY, customer_code TEXT, zalo_user_id TEXT,
      private_chat_id TEXT, display_name TEXT, bank_name TEXT, bank_account TEXT,
      account_holder TEXT, consent_at TEXT, status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL, password_hash TEXT, password_set_at TEXT,
      failed_logins INTEGER NOT NULL DEFAULT 0, locked_until TEXT, role TEXT NOT NULL DEFAULT 'user',
      last_login_at TEXT, login_count INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE orders (order_id TEXT PRIMARY KEY, customer_id TEXT, request_id TEXT,
      order_value INTEGER, estimated_commission INTEGER, approved_commission INTEGER,
      cashback_amount INTEGER, status TEXT NOT NULL, rejection_reason TEXT, recorded_at TEXT,
      approved_at TEXT, paid_at TEXT, updated_at TEXT NOT NULL, notified_status TEXT,
      platform TEXT NOT NULL DEFAULT 'shopee', settlement_status TEXT NOT NULL DEFAULT 'unsettled',
      payout_batch_id TEXT, settled_at TEXT);
    CREATE TABLE payment_transfers (id INTEGER PRIMARY KEY AUTOINCREMENT, customer_id TEXT NOT NULL,
      amount INTEGER NOT NULL, transfer_code TEXT, note TEXT, proof_image TEXT, order_ids TEXT,
      created_at TEXT NOT NULL, created_by TEXT, notify_mode TEXT, notified_at TEXT,
      target_group TEXT);
    CREATE TABLE link_requests (request_id TEXT PRIMARY KEY, customer_id TEXT NOT NULL,
      created_at TEXT NOT NULL, source_url TEXT NOT NULL, affiliate_url TEXT, estimated_commission INTEGER,
      channel TEXT, status TEXT NOT NULL DEFAULT 'pending', notified_at TEXT, estimate_source TEXT,
      estimate_detail TEXT, attempts INTEGER NOT NULL DEFAULT 0, platform TEXT NOT NULL DEFAULT 'shopee',
      share_code TEXT);
  `);
  return drizzle(sqlite, { schema });
}

function seedCustomer(db: Db, withBank = true): void {
  db.insert(customers)
    .values({
      customerId: "C1",
      zaloUserId: "U1",
      bankName: withBank ? "VCB" : null,
      bankAccount: withBank ? "123" : null,
      accountHolder: withBank ? "LAN" : null,
      createdAt: "2026-10-07T00:00:00",
    })
    .run();
}

function seedOrder(db: Db, over: Partial<typeof orders.$inferInsert> = {}): void {
  db.insert(orders)
    .values({
      orderId: "O1",
      customerId: "C1",
      status: "awaiting_approval",
      estimatedCommission: 30_000,
      updatedAt: "2026-10-07T00:00:00",
      ...over,
    })
    .run();
}

function notifiedStatusOf(db: Db): string | null {
  return (
    db
      .select({ notifiedStatus: orders.notifiedStatus })
      .from(orders)
      .where(eq(orders.orderId, "O1"))
      .get()?.notifiedStatus ?? null
  );
}

function notifiedAtOf(db: Db): string | null {
  return (
    db
      .select({ notifiedAt: paymentTransfers.notifiedAt })
      .from(paymentTransfers)
      .get()?.notifiedAt ?? null
  );
}

describe("notifyOrderChanges", () => {
  it("messages a recorded order and marks it notified", async () => {
    const db = makeDb();
    seedCustomer(db);
    seedOrder(db);
    const delivery = new FakeDelivery();

    const result = await notifyOrderChanges({ db, delivery, messages });

    expect(result).toEqual({ sent: 1, failed: 0 });
    expect(delivery.sent[0]?.to).toBe("U1");
    expect(delivery.sent[0]?.text).toContain("O1");
    expect(notifiedStatusOf(db)).toBe("awaiting_approval");
  });

  it("does not mark an order when delivery fails, so it is retried", async () => {
    const db = makeDb();
    seedCustomer(db);
    seedOrder(db);
    const delivery = new FakeDelivery(false);

    expect(await notifyOrderChanges({ db, delivery, messages })).toEqual({ sent: 0, failed: 1 });
    expect(notifiedStatusOf(db)).toBeNull();
  });

  it("does not message an order that is already up to date", async () => {
    const db = makeDb();
    seedCustomer(db);
    seedOrder(db, { notifiedStatus: "awaiting_approval" });
    const delivery = new FakeDelivery();

    expect(await notifyOrderChanges({ db, delivery, messages })).toEqual({ sent: 0, failed: 0 });
    expect(delivery.sent).toHaveLength(0);
  });

  it("asks for a bank account when an approved order has none", async () => {
    const db = makeDb();
    seedCustomer(db, false);
    seedOrder(db, { status: "approved", cashbackAmount: 9506 });
    const delivery = new FakeDelivery();

    await notifyOrderChanges({ db, delivery, messages });

    expect(delivery.sent[0]?.text).toContain("Cài đặt ngân hàng");
  });

  it("never messages a paid order (that is told by the payout)", async () => {
    const db = makeDb();
    seedCustomer(db);
    seedOrder(db, { status: "paid", cashbackAmount: 9506, paidAt: "2026-10-07T00:00:00" });
    const delivery = new FakeDelivery();

    expect(await notifyOrderChanges({ db, delivery, messages })).toEqual({ sent: 0, failed: 0 });
  });
});

describe("notifyPayouts", () => {
  it("confirms a transfer and marks it notified", async () => {
    const db = makeDb();
    seedCustomer(db);
    db.insert(paymentTransfers)
      .values({
        customerId: "C1",
        amount: 18_000,
        transferCode: "FT1",
        orderIds: JSON.stringify(["O1", "O2"]),
        createdAt: "2026-10-07T00:00:00",
      })
      .run();
    const delivery = new FakeDelivery();

    const result = await notifyPayouts({
      db,
      delivery,
      messages,
      now: () => "2026-10-07T01:00:00",
    });

    expect(result).toEqual({ sent: 1, failed: 0 });
    expect(delivery.sent[0]?.text).toContain("18.000");
    expect(delivery.sent[0]?.text).toContain("2 đơn");
    expect(notifiedAtOf(db)).toBe("2026-10-07T01:00:00");
  });
});

function requestNotifiedAt(db: Db, requestId: string): string | null {
  return (
    db
      .select({ notifiedAt: linkRequests.notifiedAt })
      .from(linkRequests)
      .where(eq(linkRequests.requestId, requestId))
      .get()?.notifiedAt ?? null
  );
}

function seedFailedLink(db: Db, over: Partial<typeof linkRequests.$inferInsert> = {}): void {
  db.insert(linkRequests)
    .values({
      requestId: "R1",
      customerId: "C1",
      sourceUrl: "https://shopee.vn/x",
      platform: "shopee",
      status: "failed",
      createdAt: "2026-10-07T00:30:00",
      ...over,
    })
    .run();
}

function seedLink(db: Db, over: Partial<typeof linkRequests.$inferInsert> = {}): void {
  db.insert(linkRequests)
    .values({
      requestId: "R1",
      customerId: "C1",
      sourceUrl: "https://shopee.vn/x",
      affiliateUrl: "https://shope.ee/abc",
      platform: "shopee",
      status: "ready",
      createdAt: "2026-10-07T00:00:00",
      ...over,
    })
    .run();
}

describe("notifyFailedLinks", () => {
  it("apologises for a fresh failure and marks it notified", async () => {
    const db = makeDb();
    seedCustomer(db);
    seedFailedLink(db);
    const delivery = new FakeDelivery();

    const result = await notifyFailedLinks({
      db,
      delivery,
      messages,
      now: () => "2026-10-07T01:00:00",
    });

    expect(result).toEqual({ sent: 1, failed: 0 });
    expect(delivery.sent[0]?.to).toBe("U1");
    expect(delivery.sent[0]?.text).toContain("link");
    expect(requestNotifiedAt(db, "R1")).toBe("2026-10-07T01:00:00");
  });

  it("drops a stale failure without sending, so an outage is not spam", async () => {
    const db = makeDb();
    seedCustomer(db);
    seedFailedLink(db, { createdAt: "2026-10-06T20:00:00" });
    const delivery = new FakeDelivery();

    const result = await notifyFailedLinks({
      db,
      delivery,
      messages,
      now: () => "2026-10-07T01:00:00",
    });

    expect(result).toEqual({ sent: 0, failed: 0 });
    expect(delivery.sent).toHaveLength(0);
    expect(requestNotifiedAt(db, "R1")).toBe("2026-10-07T01:00:00");
  });

  it("leaves the row unmarked when delivery fails, so it is retried", async () => {
    const db = makeDb();
    seedCustomer(db);
    seedFailedLink(db);
    const delivery = new FakeDelivery(false);

    expect(
      await notifyFailedLinks({ db, delivery, messages, now: () => "2026-10-07T01:00:00" }),
    ).toEqual({ sent: 0, failed: 1 });
    expect(requestNotifiedAt(db, "R1")).toBeNull();
  });

  it("ignores a pending request", async () => {
    const db = makeDb();
    seedCustomer(db);
    seedFailedLink(db, { status: "pending" });
    const delivery = new FakeDelivery();

    expect(
      await notifyFailedLinks({ db, delivery, messages, now: () => "2026-10-07T01:00:00" }),
    ).toEqual({ sent: 0, failed: 0 });
  });

  it("ignores a customer without a Zalo id", async () => {
    const db = makeDb();
    seedCustomer(db);
    db.update(customers).set({ zaloUserId: null }).run();
    seedFailedLink(db);
    const delivery = new FakeDelivery();

    expect(
      await notifyFailedLinks({ db, delivery, messages, now: () => "2026-10-07T01:00:00" }),
    ).toEqual({ sent: 0, failed: 0 });
  });
});

describe("notifyLateLinks", () => {
  const deps = (db: Db, delivery: DeliveryPort) => ({
    db,
    delivery,
    messages,
    now: () => "2026-10-07T01:00:00",
    cashbackRate: 0.8,
  });

  it("sends a link the chat never collected and marks it", async () => {
    const db = makeDb();
    seedCustomer(db);
    seedLink(db);
    const delivery = new FakeDelivery();

    expect(await notifyLateLinks(deps(db, delivery))).toEqual({ sent: 1, failed: 0 });
    expect(delivery.sent[0]?.to).toBe("U1");
    expect(delivery.sent[0]?.text).toContain("https://shope.ee/abc");
    expect(delivery.sent[0]?.text).toContain("80%");
    expect(requestNotifiedAt(db, "R1")).toBe("2026-10-07T01:00:00");
  });

  it("leaves a fresh link to the chat (within the assistant wait)", async () => {
    const db = makeDb();
    seedCustomer(db);
    seedLink(db, { createdAt: "2026-10-07T00:59:30" });
    const delivery = new FakeDelivery();

    expect(await notifyLateLinks(deps(db, delivery))).toEqual({ sent: 0, failed: 0 });
    expect(requestNotifiedAt(db, "R1")).toBeNull();
  });

  it("drops a stale link without sending", async () => {
    const db = makeDb();
    seedCustomer(db);
    seedLink(db, { createdAt: "2026-10-06T20:00:00" });
    const delivery = new FakeDelivery();

    expect(await notifyLateLinks(deps(db, delivery))).toEqual({ sent: 0, failed: 0 });
    expect(delivery.sent).toHaveLength(0);
    expect(requestNotifiedAt(db, "R1")).toBe("2026-10-07T01:00:00");
  });

  it("ignores a request that has no link yet", async () => {
    const db = makeDb();
    seedCustomer(db);
    seedLink(db, { affiliateUrl: null });
    const delivery = new FakeDelivery();

    expect(await notifyLateLinks(deps(db, delivery))).toEqual({ sent: 0, failed: 0 });
  });
});

describe("runSteps", () => {
  it("runs every step even when an earlier one throws", async () => {
    const order: string[] = [];
    await expect(
      runSteps([
        async () => {
          order.push("a");
          throw new Error("a failed");
        },
        async () => {
          order.push("b");
        },
      ]),
    ).rejects.toThrow("a failed");
    expect(order).toEqual(["a", "b"]);
  });
});

describe("JobRunner", () => {
  const failingJob = (): ScheduledJob => ({
    name: "bad",
    intervalMs: 1000,
    run: async () => {
      throw new Error("boom");
    },
  });

  it("skips a tick while the previous pass is still running", async () => {
    let running = 0;
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const job: ScheduledJob = {
      name: "slow",
      intervalMs: 1000,
      run: async () => {
        calls += 1;
        running += 1;
        await gate;
        running -= 1;
      },
    };
    const runner = new JobRunner([job], { enabled: false, alert: async () => undefined });

    const first = runner.tick(job);
    await runner.tick(job);
    release();
    await first;

    expect(calls).toBe(1);
    expect(running).toBe(0);
  });

  it("alerts the owner only after three failed passes in a row", async () => {
    const alerts: string[] = [];
    const runner = new JobRunner([failingJob()], {
      enabled: false,
      alert: async (text) => {
        alerts.push(text);
      },
    });

    await runner.tick(failingJob());
    await runner.tick(failingJob());
    expect(alerts).toHaveLength(0);
    await runner.tick(failingJob());
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toContain("bad");
  });
});

describe("HttpDelivery", () => {
  it("posts an assistant payload with the token and reports ok", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fakeFetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return { ok: true, json: async () => ({ ok: true }) } as unknown as Response;
    }) as unknown as typeof fetch;

    const delivery = new HttpDelivery({
      assistantUrl: "http://127.0.0.1:8891",
      assistantToken: "secret",
      fetchImpl: fakeFetch,
    });

    expect(await delivery.sendPrivate("U1", "hi")).toBe(true);
    expect(calls[0]?.url).toBe("http://127.0.0.1:8891/api/notify");
    expect((calls[0]?.init.headers as Record<string, string>)["x-assistant-token"]).toBe("secret");
    expect(JSON.parse(calls[0]?.init.body as string)).toMatchObject({
      targetId: "U1",
      type: "user",
      message: "hi",
    });
  });

  it("treats a failed call as not delivered instead of throwing", async () => {
    const fakeFetch = (async () => {
      throw new Error("assistant down");
    }) as unknown as typeof fetch;
    const delivery = new HttpDelivery({
      assistantUrl: "http://127.0.0.1:8891",
      assistantToken: "secret",
      fetchImpl: fakeFetch,
    });

    expect(await delivery.sendPrivate("U1", "hi")).toBe(false);
  });
});
