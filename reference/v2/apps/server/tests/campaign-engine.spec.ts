import { fileURLToPath } from "node:url";

import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { describe, expect, it } from "vitest";

import { notifyCampaignChanges } from "../src/modules/orders/application/notify-campaign-changes.use-case";
import {
  AWARD_CONFIRMED,
  AWARD_HELD,
  AWARD_PAID,
  AWARD_VOID,
  evaluateCampaigns,
  standingForOrder,
} from "../src/modules/orders/infrastructure/campaign.repository";
import type { DeliveryPort } from "../src/notifications/delivery";
import { loadMessages } from "../src/notifications/messages";
import type { Db } from "../src/shared/database/connection";
import { campaignAwards, campaigns, customers, orders } from "../src/shared/database/schema";
import * as schema from "../src/shared/database/schema";

const messages = loadMessages(
  fileURLToPath(new URL("../../../resources/messages.vi.json", import.meta.url)),
);

const ACTIVITY_START = "2026-10-01T00:00:00";
const ACTIVITY_END = "2026-10-03T23:59:59";
const DURING = "2026-10-02T00:00:00";

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
    CREATE TABLE campaigns (campaign_id TEXT PRIMARY KEY, name TEXT NOT NULL, starts_at TEXT NOT NULL,
      ends_at TEXT NOT NULL, slots INTEGER NOT NULL, bonus_vnd INTEGER NOT NULL,
      min_order_value INTEGER NOT NULL DEFAULT 0,
      platforms TEXT NOT NULL DEFAULT 'shopee,shopeefood,tiktok',
      excluded_customers TEXT NOT NULL DEFAULT '', per_customer INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL);
    CREATE TABLE campaign_awards (id INTEGER PRIMARY KEY AUTOINCREMENT, campaign_id TEXT NOT NULL,
      customer_id TEXT NOT NULL, order_id TEXT NOT NULL, amount INTEGER NOT NULL,
      status TEXT NOT NULL, created_at TEXT NOT NULL, confirmed_at TEXT, paid_at TEXT,
      voided_at TEXT, notified_status TEXT);
    CREATE TABLE link_requests (request_id TEXT PRIMARY KEY, customer_id TEXT NOT NULL,
      created_at TEXT NOT NULL, source_url TEXT NOT NULL, affiliate_url TEXT, estimated_commission INTEGER,
      channel TEXT, status TEXT NOT NULL DEFAULT 'pending', notified_at TEXT, estimate_source TEXT,
      estimate_detail TEXT, attempts INTEGER NOT NULL DEFAULT 0, platform TEXT NOT NULL DEFAULT 'shopee',
      share_code TEXT);
  `);
  return drizzle(sqlite, { schema });
}

function seedCustomer(db: Db, id: string, role = "user"): void {
  db.insert(customers)
    .values({
      customerId: id,
      zaloUserId: `U_${id}`,
      role,
      createdAt: "2026-09-01T00:00:00",
    })
    .run();
}

function seedCampaign(db: Db, over: Partial<typeof campaigns.$inferInsert> = {}): void {
  db.insert(campaigns)
    .values({
      campaignId: "K1",
      name: "Trung thu",
      startsAt: ACTIVITY_START,
      endsAt: ACTIVITY_END,
      slots: 2,
      bonusVnd: 20_000,
      platforms: "shopee",
      createdAt: "2026-09-01T00:00:00",
      ...over,
    })
    .run();
}

function seedOrder(db: Db, over: Partial<typeof orders.$inferInsert> & { orderId: string; customerId: string; recordedAt: string }): void {
  db.insert(orders)
    .values({
      status: "awaiting_approval",
      orderValue: 100_000,
      platform: "shopee",
      updatedAt: over.recordedAt,
      ...over,
    })
    .run();
}

function awardRows(db: Db) {
  return db.select().from(campaignAwards).orderBy(campaignAwards.id).all();
}

describe("evaluateCampaigns", () => {
  it("fills the slots with the earliest orders", () => {
    const db = makeDb();
    seedCustomer(db, "C1");
    seedCustomer(db, "C2");
    seedCampaign(db);
    seedOrder(db, { orderId: "O1", customerId: "C1", recordedAt: "2026-10-01T09:01:00" });
    seedOrder(db, { orderId: "O2", customerId: "C2", recordedAt: "2026-10-01T09:00:00" });

    const changes = evaluateCampaigns(db, DURING);

    expect(changes.held).toBe(2);
    const awards = awardRows(db);
    expect(awards.map((a) => a.orderId)).toEqual(["O2", "O1"]);
    expect(awards.every((a) => a.status === AWARD_HELD && a.amount === 20_000)).toBe(true);
  });

  it("keeps orders outside the window, staff and the house out", () => {
    const db = makeDb();
    seedCustomer(db, "C1");
    seedCustomer(db, "STAFF", "employee");
    seedCustomer(db, "HOUSE", "house");
    seedCampaign(db, { slots: 5 });
    seedOrder(db, { orderId: "OUT", customerId: "C1", recordedAt: "2026-09-30T09:00:00" });
    seedOrder(db, { orderId: "EMP", customerId: "STAFF", recordedAt: "2026-10-01T09:00:00" });
    seedOrder(db, { orderId: "HSE", customerId: "HOUSE", recordedAt: "2026-10-01T09:00:00" });
    seedOrder(db, { orderId: "OK", customerId: "C1", recordedAt: "2026-10-01T09:00:00" });

    evaluateCampaigns(db, DURING);

    expect(awardRows(db).map((a) => a.orderId)).toEqual(["OK"]);
  });

  it("confirms a slot once its order is approved", () => {
    const db = makeDb();
    seedCustomer(db, "C1");
    seedCampaign(db);
    seedOrder(db, { orderId: "O1", customerId: "C1", recordedAt: "2026-10-01T09:00:00" });
    evaluateCampaigns(db, DURING);

    db.update(orders).set({ status: "approved" }).where(eq(orders.orderId, "O1")).run();
    const changes = evaluateCampaigns(db, DURING);

    expect(changes.confirmed).toBe(1);
    expect(awardRows(db)[0]?.status).toBe(AWARD_CONFIRMED);
  });

  it("passes a freed slot to the next order when cancelled during the event", () => {
    const db = makeDb();
    seedCustomer(db, "C1");
    seedCustomer(db, "C2");
    seedCampaign(db, { slots: 1 });
    seedOrder(db, { orderId: "O1", customerId: "C1", recordedAt: "2026-10-01T09:00:00" });
    seedOrder(db, { orderId: "O2", customerId: "C2", recordedAt: "2026-10-01T09:01:00" });
    evaluateCampaigns(db, DURING);
    expect(awardRows(db).map((a) => a.orderId)).toEqual(["O1"]);

    db.update(orders).set({ status: "rejected" }).where(eq(orders.orderId, "O1")).run();
    evaluateCampaigns(db, DURING);

    const awards = awardRows(db);
    expect(awards.find((a) => a.orderId === "O1")?.status).toBe(AWARD_VOID);
    expect(awards.find((a) => a.orderId === "O2")?.status).toBe(AWARD_HELD);
  });

  it("respects the per-customer limit", () => {
    const db = makeDb();
    seedCustomer(db, "C1");
    seedCustomer(db, "C2");
    seedCampaign(db, { slots: 3, perCustomer: 1 });
    seedOrder(db, { orderId: "A", customerId: "C1", recordedAt: "2026-10-01T09:00:00" });
    seedOrder(db, { orderId: "B", customerId: "C1", recordedAt: "2026-10-01T09:01:00" });
    seedOrder(db, { orderId: "C", customerId: "C2", recordedAt: "2026-10-01T09:02:00" });

    evaluateCampaigns(db, DURING);

    expect(awardRows(db).map((a) => a.orderId)).toEqual(["A", "C"]);
  });

  it("pays a slot once its order is paid", () => {
    const db = makeDb();
    seedCustomer(db, "C1");
    seedCampaign(db);
    seedOrder(db, { orderId: "O1", customerId: "C1", recordedAt: "2026-10-01T09:00:00" });
    evaluateCampaigns(db, DURING);

    db.update(orders)
      .set({ status: "paid", paidAt: "2026-10-04T09:00:00" })
      .where(eq(orders.orderId, "O1"))
      .run();
    const changes = evaluateCampaigns(db, "2026-10-04T10:00:00");

    expect(changes.paid).toBe(1);
    expect(awardRows(db)[0]?.status).toBe(AWARD_PAID);
    expect(awardRows(db)[0]?.paidAt).toBe("2026-10-04T09:00:00");
  });

  it("ranks the standing of an order among the live slots", () => {
    const db = makeDb();
    seedCustomer(db, "C1");
    seedCustomer(db, "C2");
    seedCampaign(db);
    seedOrder(db, { orderId: "O1", customerId: "C1", recordedAt: "2026-10-01T09:01:00" });
    seedOrder(db, { orderId: "O2", customerId: "C2", recordedAt: "2026-10-01T09:00:00" });
    evaluateCampaigns(db, DURING);

    expect(standingForOrder(db, "O1")?.rank).toBe(2);
    expect(standingForOrder(db, "O2")?.rank).toBe(1);
    expect(standingForOrder(db, "NOPE")).toBeNull();
  });
});

describe("notifyCampaignChanges", () => {
  it("congratulates a winner once the order has been announced", async () => {
    const db = makeDb();
    seedCustomer(db, "C1");
    seedCampaign(db);
    seedOrder(db, {
      orderId: "O1",
      customerId: "C1",
      recordedAt: "2026-10-01T09:00:00",
      status: "approved",
      notifiedStatus: "approved",
    });
    // A slot is created as `held` on one pass and confirmed on the next,
    // exactly as the loop sees it, so run the prior pass first.
    evaluateCampaigns(db, DURING);
    const delivery = new FakeDelivery();

    const result = await notifyCampaignChanges({ db, delivery, messages, now: () => DURING });

    expect(result).toEqual({ sent: 1, failed: 0 });
    expect(delivery.sent[0]?.to).toBe("U_C1");
    expect(delivery.sent[0]?.text).toContain("Trung thu");
    expect(delivery.sent[0]?.text).toContain("20.000");
    expect(awardRows(db)[0]?.notifiedStatus).toBe(AWARD_CONFIRMED);
  });

  it("waits until the order itself has been announced", async () => {
    const db = makeDb();
    seedCustomer(db, "C1");
    seedCampaign(db);
    seedOrder(db, { orderId: "O1", customerId: "C1", recordedAt: "2026-10-01T09:00:00" });
    const delivery = new FakeDelivery();

    expect(await notifyCampaignChanges({ db, delivery, messages, now: () => DURING })).toEqual({
      sent: 0,
      failed: 0,
    });
  });

  it("tells a customer their slot was lost when the order is cancelled", async () => {
    const db = makeDb();
    seedCustomer(db, "C1");
    seedCampaign(db);
    seedOrder(db, { orderId: "O1", customerId: "C1", recordedAt: "2026-10-01T09:00:00" });
    db.insert(campaignAwards)
      .values({
        campaignId: "K1",
        customerId: "C1",
        orderId: "O1",
        amount: 20_000,
        status: AWARD_HELD,
        createdAt: DURING,
        notifiedStatus: AWARD_HELD,
      })
      .run();
    db.update(orders).set({ status: "rejected" }).where(eq(orders.orderId, "O1")).run();
    const delivery = new FakeDelivery();

    const result = await notifyCampaignChanges({ db, delivery, messages, now: () => DURING });

    expect(result).toEqual({ sent: 1, failed: 0 });
    expect(delivery.sent[0]?.text).toContain("chuyển cho đơn kế tiếp");
    expect(awardRows(db)[0]?.notifiedStatus).toBe(AWARD_VOID);
  });
});
