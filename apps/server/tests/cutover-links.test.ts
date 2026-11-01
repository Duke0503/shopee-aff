/**
 * Story 2.5: link requests, share codes and products imported unchanged, with the D56 product
 * snapshot, and the outbox seeded with every notification the live system already sent (D46),
 * from a read-only copy of the live ledger (fixtures/live-schema.sql + fixtures/live-rows.sql).
 */
import { fixedClock } from "@cashback/core";
import { describe, expect, it } from "vitest";

import { COMPARISON_SKIPS } from "../src/cutover/import-report";
import { wholeDong } from "../src/cutover/live-values";
import { percentToBps } from "../src/cutover/product-snapshot";
import { findShareCode, isShareCode } from "../src/modules/linking/index";
import { dedupKey, dedupKeyParts, enqueue, outboxFor, setSilent } from "../src/modules/messaging/index";
import { openLedger } from "../src/platform/db/ledger";
import { auditBy, buildLiveCopy, importOnce, rows, TEST_CLOCK } from "./helpers/live-fixture";

type Row = Record<string, string | number | null>;

const source = buildLiveCopy();
const run = importOnce(source);
const requests = new Map((rows(run.targetPath, "SELECT * FROM link_requests") as Row[]).map((r) => [r["request_id"], r]));
const LATER = fixedClock("2026-10-31T07:00:00.000Z");
const message = (key: string, customerId = "1000000000000000001") => ({ dedupKey: key, customerId, messageKey: "order_approved", params: { cashback: 6228 } });

function withLedger<T>(fn: (ledger: ReturnType<typeof openLedger>) => T): T {
  const ledger = openLedger(importOnce(source).targetPath);
  try {
    return fn(ledger);
  } finally {
    ledger.close();
  }
}

describe("Story 2.5 acceptance criteria", () => {
  it("AC1: a live 8-character share code is stored unchanged with its link request and owner, and still resolves", () => {
    expect(rows(run.targetPath, "SELECT s.code, s.request_id, r.customer_id FROM share_codes s JOIN link_requests r USING (request_id) ORDER BY s.code")).toEqual([
      { code: "Ab3dE5gH", request_id: "26091100001", customer_id: "1000000000000000001" },
      { code: "HoUsE123", request_id: "26091400004", customer_id: "HOUSE" },
      { code: "Zx9Yw8Vu", request_id: "26091200002", customer_id: "1000000000000000002" },
    ]);
    withLedger((ledger) => {
      expect(findShareCode(ledger.db, "Ab3dE5gH")).toEqual({ code: "Ab3dE5gH", requestId: "26091100001", customerId: "1000000000000000001", affiliateUrl: "https://s.shopee.vn/AAA111" });
      expect(findShareCode(ledger.db, "ab3de5gh")).toBeNull();
      expect(findShareCode(ledger.db, "../../x")).toBeNull();
      expect(() => ledger.sqlite.exec("UPDATE share_codes SET request_id = '26091200002' WHERE code = 'Ab3dE5gH'")).toThrow("a share code never changes");
      expect(() => ledger.sqlite.exec("INSERT INTO share_codes (code, request_id) VALUES ('short', '26102900003')")).toThrow("CHECK");
    });
    expect(run.report.comparison["share_codes"]).toEqual({ source: 5, imported: 3, mismatches: [] });
    expect(run.report.notes).toContainEqual({ kind: "share_code_invalid", table: "link_requests", key: "26091900009" });
    expect([isShareCode("Ab3dE5gH"), isShareCode("Ab3dE5gH12"), isShareCode("Ab3dE5g"), isShareCode("Ab3dE5gH1"), isShareCode("bad-code")]).toEqual([true, true, false, false, false]);
  });

  it("AC2: every (entity, event) the live system told has an outbox row with that key marked sent; enqueueing it again is a no-op", () => {
    // Payout and campaign award keys are Story 2.4's (tests/cutover-payouts.test.ts).
    const seeded = rows(run.targetPath, "SELECT dedup_key, customer_id, message_key, due_at, sent_at, origin FROM outbox WHERE dedup_key LIKE 'order:%' OR dedup_key LIKE 'link_request:%' ORDER BY dedup_key") as Row[];
    expect(seeded.map((r) => r["dedup_key"])).toEqual([
      "link_request:26081700007:delivered",
      "link_request:26091100001:delivered",
      "link_request:26091500005:failed",
      "link_request:26091900009:delivered",
      "order:260911AAAA0001:paid",
      "order:260912BBBB0002:recorded",
      "order:260915EEEE0005:rejected",
      "order:260919IIII0009:approved",
      "order:261001JJJJ0010:paid",
      "order:TT0000000000000007:paid",
    ]);
    for (const row of seeded) expect(row).toMatchObject({ due_at: null, origin: "CUTOVER_SEED" });
    expect(seeded.find((r) => r["dedup_key"] === "link_request:26091100001:delivered")).toMatchObject({ sent_at: "2026-09-11T06:00:20.000Z", message_key: "link_ready", customer_id: "1000000000000000001" });
    expect(seeded.find((r) => r["dedup_key"] === "order:260912BBBB0002:recorded")).toMatchObject({ sent_at: TEST_CLOCK.now(), message_key: "order_recorded", customer_id: "1000000000000000002" });
    expect(run.report.notifications).toMatchObject({ seeded: 16, seededByEvent: { "order:paid": 3, "order:recorded": 1, "order:rejected": 1, "order:approved": 1, "link_request:delivered": 3, "link_request:failed": 1 } });

    withLedger((ledger) => {
      const results = ledger.tx((db) => [enqueue(db, LATER, message("order:260911AAAA0001:paid"), auditBy(db, LATER)), outboxFor(db, LATER, auditBy(db, LATER)).enqueue(message("link_request:26091100001:delivered"))]);
      expect(results).toEqual(["duplicate", "duplicate"]);
      expect(ledger.sqlite.prepare("SELECT count(*) AS n FROM outbox WHERE due_at IS NOT NULL").get()).toEqual({ n: 0 });
      // The import leaves the ledger quiet (Story 6.10); once the owner turns that off, a new event is due.
      expect(ledger.tx((db) => setSilent(db, false, LATER.now(), auditBy(db, LATER)))).toEqual({ silent: false, changed: true });
      // A new event is enqueued and due; the same key again is a no-op.
      expect(ledger.tx((db) => enqueue(db, LATER, message("order:260912BBBB0002:approved", "1000000000000000002"), auditBy(db, LATER)))).toBe("enqueued");
      expect(ledger.tx((db) => enqueue(db, LATER, message("order:260912BBBB0002:approved", "1000000000000000002"), auditBy(db, LATER)))).toBe("duplicate");
      expect(ledger.sqlite.prepare("SELECT dedup_key, due_at, sent_at, origin, params FROM outbox WHERE due_at IS NOT NULL").all()).toEqual([
        { dedup_key: "order:260912BBBB0002:approved", due_at: "2026-10-31T07:00:00.000Z", sent_at: null, origin: "EVENT", params: '{"cashback":6228}' },
      ]);
    });
  });

  it("AC3: live requests still waiting for their link are imported QUEUED and listed; none is lost silently", () => {
    expect(requests.get("26102900003")).toMatchObject({ status: "QUEUED", affiliate_url: null, attempts: 1, channel: "web" });
    expect(run.report.links?.queued).toEqual(["26102900003"]);
    expect(run.report.links?.byStatus).toEqual({ CONVERTED: 2, DELIVERED: 2, FAILED: 2, ISSUED: 1, QUEUED: 1 });
    // Every live request is imported or named in the report.
    const live = (rows(source, "SELECT request_id FROM link_requests ORDER BY request_id") as Row[]).map((r) => r["request_id"]);
    const named = new Set(run.report.notes.filter((n) => n.kind === "link_customer_missing").map((n) => n.key));
    expect(live.filter((id) => !requests.has(id))).toEqual([...named]);
    // The request under the old Zalo id is named in the report (link_customer_via_alias) and not compared again.
    expect(run.report.comparison["link_requests"]).toEqual({ source: 9, imported: 8, mismatches: [] });
    expect(COMPARISON_SKIPS).toEqual({
      customer_aliases: ["alias_target_missing"],
      orders: ["order_customer_missing", "order_customer_via_alias", "amount_not_whole_dong"],
      link_requests: ["link_customer_missing", "link_customer_via_alias"],
      share_codes: ["link_customer_missing", "share_code_invalid"],
      payouts: ["payout_customer_missing", "payout_customer_via_alias", "payout_to_guest", "payout_amount_not_whole_dong"],
      campaign_awards: ["duplicate_live_award", "award_campaign_missing", "award_customer_missing", "award_customer_via_alias", "award_to_guest", "award_order_missing", "unknown_award_status", "award_amount_not_whole_dong"],
    });
  });

  it("AC4: unsent live notifications are listed (none imported as due) and the report counts both", () => {
    expect(run.report.notifications?.importedAsDue).toBe(0);
    expect(run.report.notifications?.listed.filter((k) => k.startsWith("order:") || k.startsWith("link_request:"))).toEqual([
        "link_request:26081600006:failed",
        "link_request:26091200002:delivered",
        "order:260912BBBB0002:approved",
        "order:260913CCCC0003:recorded",
        "order:260919IIII0009:paid",
    ]);
    expect(rows(run.targetPath, "SELECT count(*) AS n FROM outbox WHERE origin = 'EVENT'")).toEqual([{ n: 0 }]);
  });

  it("AC5: a guest (HOUSE) link request keeps HOUSE as owner, and no outbox row is created for it or its order", () => {
    expect(requests.get("26091400004")).toMatchObject({ customer_id: "HOUSE", status: "CONVERTED" });
    expect(rows(run.targetPath, "SELECT count(*) AS n FROM outbox WHERE customer_id = 'HOUSE' OR dedup_key LIKE '%26091400004%' OR dedup_key LIKE '%260914DDDD0004%'")).toEqual([{ n: 0 }]);
    expect(run.report.notifications?.listed.filter((k) => k.includes("26091400004") || k.includes("260914DDDD0004"))).toEqual([]);
    withLedger((ledger) => {
      expect(ledger.tx((db) => enqueue(db, LATER, message("order:260914DDDD0004:approved", "HOUSE"), auditBy(db, LATER)))).toBe("refused_guest");
      expect(ledger.tx((db) => enqueue(db, LATER, message("order:260918HHHH0008:recorded", "ghost"), auditBy(db, LATER)))).toBe("refused_unknown_customer");
      expect(ledger.sqlite.prepare("SELECT count(*) AS n FROM outbox WHERE origin = 'EVENT'").get()).toEqual({ n: 0 });
    });
  });
});

describe("Story 2.5: link states, owners and the product snapshot (D56)", () => {
  it("maps the live states: a link not handed over is ISSUED, handed over DELIVERED, expired without a link FAILED", () => {
    expect(requests.get("26091200002")).toMatchObject({ status: "ISSUED", delivered_at: null });
    expect(requests.get("26081700007")).toMatchObject({ status: "DELIVERED", delivered_at: "2026-08-17T01:00:30.000Z" });
    expect(requests.get("26081600006")).toMatchObject({ status: "FAILED", affiliate_url: null });
    expect(requests.get("26091500005")).toMatchObject({ status: "FAILED", attempts: 3 });
    expect(requests.get("26091100001")).toMatchObject({ status: "CONVERTED", created_at: "2026-09-11T06:00:00.000Z", estimated_commission: 8745, network: "shopee", origin: "CUTOVER" });
    expect(run.report.notes).toContainEqual({ kind: "expired_without_link", table: "link_requests", key: "26081600006" });
  });

  it("reads live ready (AccessTrade providers) and September success rows like pending: a link made keeps them issued, none is FAILED and listed", () => {
    const copy = buildLiveCopy({
      extraSql: `INSERT INTO link_requests (request_id, customer_id, created_at, source_url, affiliate_url, estimated_commission, channel, status, notified_at, platform, estimate_source, estimate_detail, attempts, share_code) VALUES
        ('26102000101', '1000000000000000001', '2026-10-20T21:31:14+07:00', 'https://vt.tiktok.com/ZSready/', 'https://go.isclix.com/deep/ready', NULL, 'web', 'ready', '2026-10-20T21:31:20+07:00', 'tiktok', 'accesstrade', NULL, 1, NULL),
        ('26092100102', '1000000000000000001', '2026-09-21T11:40:33+07:00', 'https://s.shopee.vn/success', 'https://s.shopee.vn/an_redir?sub=x', NULL, 'zalo', 'success', NULL, 'shopee', NULL, NULL, 1, NULL),
        ('26102000103', '1000000000000000001', '2026-10-20T21:40:00+07:00', 'https://vt.tiktok.com/ZSnolink/', NULL, NULL, 'web', 'ready', NULL, 'tiktok', NULL, NULL, 1, NULL);`,
    });
    const imported = importOnce(copy);
    const status = new Map((rows(imported.targetPath, "SELECT request_id, status FROM link_requests WHERE request_id LIKE '%001__'") as Row[]).map((r) => [r["request_id"], r["status"]]));
    expect(status.get("26102000101")).toBe("DELIVERED");
    expect(status.get("26092100102")).toBe("ISSUED");
    expect(status.get("26102000103")).toBe("FAILED");
    expect(imported.report.notes.filter((n) => n.kind === "unknown_link_status")).toEqual([{ kind: "unknown_link_status", table: "link_requests", key: "26102000103", detail: "ready without link" }]);
  });

  it("follows the merged customer's old Zalo id to the survivor and lists a request whose customer is gone", () => {
    expect(requests.get("26091900009")).toMatchObject({ customer_id: "1000000000000000002", network: "accesstrade", platform: "tiktok", status: "DELIVERED" });
    expect(requests.has("26091800008")).toBe(false);
    expect(run.report.notes).toEqual(expect.arrayContaining([
      { kind: "link_customer_via_alias", table: "link_requests", key: "26091900009" },
      { kind: "link_customer_missing", table: "link_requests", key: "26091800008" },
    ]));
  });

  it("takes the snapshot from the stored estimate first, then the product cache by link, canonical URL and item id", () => {
    const snapshot = (id: string) => {
      const r = requests.get(id) ?? {};
      return { offer: r["product_offer_id"], image: r["product_image_url"], price: r["product_price"], shopee: r["shopee_rate_bps"], seller: r["seller_rate_bps"], named: r["product_name"] !== null };
    };
    // The estimate's own image wins over the cache's.
    expect(snapshot("26091100001")).toEqual({ offer: "22001", image: "https://cf.shopee.vn/file/img-a-est", price: 159000, shopee: 350, seller: 200, named: true });
    expect(snapshot("26091200002")).toEqual({ offer: "22002", image: null, price: 499000, shopee: 950, seller: 0, named: true });
    // The item id in the source URL; the 3.333% rate has no whole basis point and is left out.
    expect(snapshot("26102900003")).toEqual({ offer: "22003", image: "https://cf.shopee.vn/file/img-c", price: 210000, shopee: 225, seller: null, named: true });
    expect(snapshot("26091400004")).toEqual({ offer: "22001", image: "https://cf.shopee.vn/file/img-a", price: 159000, shopee: 350, seller: 200, named: true });
    expect(snapshot("26081700007")).toMatchObject({ offer: "22001", named: true });
    expect(snapshot("26091500005")).toEqual({ offer: null, image: null, price: null, shopee: null, seller: null, named: false });
    expect(requests.get("26091100001")?.["product_name"]).toBe((rows(source, "SELECT name FROM products_cache WHERE item_id = '22001'")[0] as Row)["name"]);
    expect(run.report.links?.snapshots).toEqual({ estimate: 1, product_cache: 4, none: 3 });
    expect(run.report.notes).toEqual(expect.arrayContaining([
      { kind: "estimate_unreadable", table: "link_requests", key: "26081700007" },
      { kind: "rate_not_whole_bps", table: "link_requests", key: "26102900003", detail: "seller_rate" },
    ]));
  });

  it("imports the product cache as product offers with rates in basis points and no computed estimate", () => {
    expect(rows(run.targetPath, "SELECT product_offer_id, shop_id, price, shopee_rate_bps, seller_rate_bps, canonical_url, first_seen_at, origin FROM product_offers ORDER BY 1")).toEqual([
      { product_offer_id: "22001", shop_id: "11001", price: 159000, shopee_rate_bps: 350, seller_rate_bps: 200, canonical_url: "https://shopee.vn/product/11001/22001", first_seen_at: "2026-09-11T06:00:05.000Z", origin: "CUTOVER" },
      { product_offer_id: "22002", shop_id: "11002", price: 499000, shopee_rate_bps: 950, seller_rate_bps: 0, canonical_url: "https://shopee.vn/product/11002/22002", first_seen_at: "2026-09-12T03:00:05.000Z", origin: "CUTOVER" },
      { product_offer_id: "22003", shop_id: "11003", price: 210000, shopee_rate_bps: 225, seller_rate_bps: null, canonical_url: null, first_seen_at: "2026-10-29T02:00:05.000Z", origin: "CUTOVER" },
    ]);
    expect(run.report.notes).toContainEqual({ kind: "rate_not_whole_bps", table: "products_cache", key: "22003", detail: "seller_rate" });
  });

  it("reads live percent rates as exact basis points or not at all", () => {
    expect([3.5, 2, 0, 9.55, 2.25, 12].map(percentToBps)).toEqual([350, 200, 0, 955, 225, 1200]);
    expect([3.333, -1, Number.NaN, "3.5", 1e-7].map(percentToBps)).toEqual(["inexact", "inexact", "inexact", "inexact", "inexact"]);
    expect([null, undefined, ""].map(percentToBps)).toEqual([null, null, null]);
  });

  it("builds dedup keys in the <entity>:<id>:<event> form, percent-encoding colons, spaces and % in the id, round trip", () => {
    expect(dedupKey("order", "260911AAAA0001", "paid")).toBe("order:260911AAAA0001:paid");
    expect(dedupKey("order", "AT 12345", "paid")).toBe("order:AT%2012345:paid");
    expect(dedupKey("order", "x:1", "paid")).toBe("order:x%3A1:paid");
    expect(dedupKey("order", "50%	", "paid")).toBe("order:50%25%09:paid");
    for (const id of ["AT 12345", "x:1", "50%	", "260911AAAA0001", "x%3A1"]) expect(dedupKeyParts(dedupKey("order", id, "paid"))).toEqual({ entity: "order", id, event: "paid" });
    expect(dedupKey("order", "x%3A1", "paid")).not.toBe(dedupKey("order", "x:1", "paid"));
    expect(() => dedupKey("order", "", "paid")).toThrow(RangeError);
    expect(() => dedupKey("Order", "1", "paid")).toThrow(RangeError);
    withLedger((ledger) => expect(() => ledger.tx((db) => enqueue(db, LATER, message("not a key"), auditBy(db, LATER)))).toThrow(RangeError));
  });

  it("an order id with a space or a colon gets an encoded key and never stops the import", () => {
    const copy = buildLiveCopy({
      extraSql: `INSERT INTO orders (order_id, customer_id, order_value, estimated_commission, approved_commission, cashback_amount, status, recorded_at, approved_at, paid_at, updated_at, platform, notified_status) VALUES
        ('AT 12345', '1000000000000000001', 100000, 5000, 5000, 3561, 'paid', '2026-10-02T09:00:00+07:00', '2026-10-03T09:00:00+07:00', '2026-10-09 02:00:00', '2026-10-09 02:00:00', 'tiktok', 'paid'),
        ('x:1', '1000000000000000001', 100000, 5000, NULL, NULL, 'awaiting_approval', '2026-10-02T09:00:00+07:00', NULL, NULL, '2026-10-09 02:00:00', 'shopee', NULL);`,
    });
    const imported = importOnce(copy);
    expect(imported.report.outcome.ok).toBe(true);
    expect(rows(imported.targetPath, "SELECT dedup_key FROM outbox WHERE dedup_key LIKE 'order:AT%'")).toEqual([{ dedup_key: "order:AT%2012345:paid" }]);
    expect(imported.report.notifications?.listed).toContain("order:x%3A1:recorded");
  });

  it("pending and seeded order events follow the imported status: a forced-PAID order told 'approved' still owes 'paid'", () => {
    const copy = buildLiveCopy({
      extraSql: "INSERT INTO orders (order_id, customer_id, order_value, estimated_commission, approved_commission, cashback_amount, status, recorded_at, approved_at, paid_at, updated_at, platform, notified_status) VALUES ('261002KKKK0011', '1000000000000000005', 100000, 5000, 5000, 3561, 'approved', '2026-10-02T09:00:00+07:00', '2026-10-03T09:00:00+07:00', '2026-10-09 02:00:00', '2026-10-09 02:00:00', 'shopee', 'approved');",
    });
    const notifications = importOnce(copy).report.notifications;
    expect(notifications?.listed).toContain("order:261002KKKK0011:paid");
    expect(notifications?.listed).not.toContain("order:261002KKKK0011:approved");
    // The FROZEN order (an unknown live status) owes no message.
    expect(notifications?.listed.filter((k) => k.includes("260916FFFF0006"))).toEqual([]);
  });

  it("reads whole dong with zero allowed or not", () => {
    expect([0, 1, 159000, -1, 1.5, "100", null, undefined, Number.MAX_SAFE_INTEGER + 1].map((v) => wholeDong(v, { allowZero: true }))).toEqual([0, 1, 159000, null, null, null, null, null, null]);
    expect([0, 1].map((v) => wholeDong(v, { allowZero: false }))).toEqual([null, 1]);
  });

  it("is deterministic: two imports of one source give identical link, product and outbox tables", () => {
    const second = importOnce(source);
    for (const table of ["product_offers", "link_requests", "share_codes", "outbox"]) expect(rows(second.targetPath, `SELECT * FROM ${table} ORDER BY 1`)).toEqual(rows(run.targetPath, `SELECT * FROM ${table} ORDER BY 1`));
  });
});

describe("Story 5.8 (review Q3): the live share-link clicks are imported", () => {
  it("imports each live click with its share code, request, time and browser kind only, and lists one it cannot tie or read", () => {
    expect(rows(run.targetPath, "SELECT share_code, request_id, clicked_at, agent FROM link_clicks ORDER BY click_id")).toEqual([
      { share_code: "Ab3dE5gH", request_id: "26091100001", clicked_at: "2026-09-11T03:00:00.000Z", agent: "browser" },
      { share_code: "Ab3dE5gH", request_id: "26091100001", clicked_at: "2026-09-11T03:00:05.000Z", agent: "buy" },
      { share_code: "Zx9Yw8Vu", request_id: "26091200002", clicked_at: "2026-09-12T02:00:00.000Z", agent: "in_app" },
    ]);
    expect(rows(run.targetPath, "SELECT name FROM pragma_table_info('link_clicks') ORDER BY cid").map((r) => (r as { name: string }).name)).toEqual(["click_id", "share_code", "request_id", "clicked_at", "agent"]);
    expect(run.report.links?.clicks).toBe(3);
    expect(run.report.notes).toContainEqual({ kind: "click_request_missing", table: "link_clicks", key: "4", detail: "26091900009" });
    expect(run.report.notes).toContainEqual({ kind: "click_agent_unknown", table: "link_clicks", key: "5", detail: "bot" });
  });
});
