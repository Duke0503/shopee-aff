/**
 * Story 5.7: TikTok Shop links through AccessTrade and a polite Lazada refusal (AD-22, D17, D20,
 * D47). The AccessTrade API is always a fake here; no test reaches AccessTrade.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NETWORK_MONEY_RULES } from "@cashback/money";
import { afterEach, describe, expect, it } from "vitest";

import { accessTradeLinksFor } from "../src/links/link-jobs";
import { ACCESSTRADE_LINK_PATH, accessTradeLinkCreator, fakeAccessTradeLinks, linkRequestInternalRoutes, networkDefinition, readProductLink, type HttpPost } from "../src/modules/linking/index";
import { REPOSITORY_ROOT } from "../src/platform/config/env.config";
import type { Ledger } from "../src/platform/db/ledger";
import { ASSISTANT_TOKEN_HEADER } from "../src/platform/http/internal-token.guard";
import { buildServers, type Servers } from "../src/platform/http/servers";
import { answeringBridge, C1, linkLedger, linkRow, memoryLogger, movingClock, outboxRows, queueLink, runLinks } from "./helpers/link-ledger";

const ledgers: Ledger[] = [];
const servers: Servers[] = [];
afterEach(async () => {
  for (const s of servers.splice(0)) await Promise.all([s.publicApp.close(), s.internalApp.close()]);
  for (const l of ledgers.splice(0)) l.close();
});

const TIKTOK = "https://vt.tiktok.com/ZSBKCcJrf/";
const API_KEY = "at-test-key-7f3a9c0e5b1d";
const NO_BRIDGE = answeringBridge(() => {
  throw new Error("an AccessTrade request never reaches the bridge");
});

interface Posted {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Record<string, unknown>;
}

/** A fake AccessTrade API: records each call and answers with `status` and `body` (or throws). */
function fakeApi(answer: (n: number) => { status: number; body: unknown } | Error): HttpPost & { calls: Posted[]; discarded: number[] } {
  const calls: Posted[] = [];
  const discarded: number[] = [];
  const post: HttpPost = async (url, headers, body) => {
    calls.push({ url, headers, body: JSON.parse(body) as Record<string, unknown> });
    const n = calls.length;
    const next = answer(n);
    if (next instanceof Error) throw next;
    return { status: next.status, json: async () => next.body, discard: async () => void discarded.push(n) };
  };
  return Object.assign(post, { calls, discarded });
}

describe("Story 5.7: TikTok Shop links through AccessTrade and a polite Lazada refusal", () => {
  it("AC1: a TikTok Shop URL is served through the AccessTrade API with sub1 = customer id and sub2 = request id, and the request becomes ISSUED", async () => {
    const ledger = linkLedger(ledgers);
    const requestId = queueLink(ledger, "DP00001", TIKTOK);
    expect(linkRow(ledger, requestId)).toMatchObject({ status: "QUEUED", network: "accesstrade", platform: "tiktok" });
    const api = fakeApi(() => ({ status: 200, body: { status: true, data: { aff_short_url: "https://shorten.asia/AbCd1234", product_name: "x" } } }));
    const accessTrade = accessTradeLinkCreator({ apiKey: API_KEY, baseUrl: "https://api.accesstrade.test", post: api });
    expect(await runLinks(ledger, NO_BRIDGE, { accessTrade })).toEqual({ issued: 1, failed: 0, interrupted: false });
    expect(api.calls).toEqual([{ url: `https://api.accesstrade.test${ACCESSTRADE_LINK_PATH}`, headers: { Authorization: `Token ${API_KEY}`, "Content-Type": "application/json" }, body: { product_url: TIKTOK, sub1: C1, sub2: requestId } }]);
    expect(linkRow(ledger, requestId)).toMatchObject({ status: "ISSUED", affiliate_url: "https://shorten.asia/AbCd1234", attempts: 1 });
    expect(NO_BRIDGE.jobs).toEqual([]);
    expect(ledger.sqlite.prepare("SELECT count(*) AS n FROM bridge_jobs").get()).toEqual({ n: 0 });
    expect(ledger.sqlite.prepare("SELECT count(*) AS n FROM share_codes WHERE request_id = ?").get(requestId)).toEqual({ n: 1 });
  });

  it("AC1: a TikTok product link gets its own product key, and an AccessTrade link off its hosts is dropped", async () => {
    expect(readProductLink("https://shop.tiktok.com/view/product/1729384756123?region=VN")).toMatchObject({ ok: true, network: "accesstrade", platform: "tiktok", productKey: "tiktok:1729384756123" });
    expect(readProductLink(TIKTOK)).toMatchObject({ ok: true, network: "accesstrade", productKey: null });
    expect(readProductLink("https://tiktok.com.evil.example/x")).toEqual({ ok: false, reason: "network_unsupported" });
    const ledger = linkLedger(ledgers);
    const requestId = queueLink(ledger, "DP00001", TIKTOK);
    const api = fakeApi(() => ({ status: 200, body: { aff_short_url: "https://evil.example/x" } }));
    expect(await runLinks(ledger, NO_BRIDGE, { accessTrade: accessTradeLinkCreator({ apiKey: API_KEY, post: api }) })).toEqual({ issued: 0, failed: 1, interrupted: false });
    expect(linkRow(ledger, requestId)).toMatchObject({ status: "QUEUED", affiliate_url: null, attempts: 1 });
  });

  it("AC2: a Lazada URL is refused with network_unsupported and the message key that names Shopee and TikTok Shop", async () => {
    const ledger = linkLedger(ledgers);
    const s = buildServers({ clock: movingClock(), internalToken: "i".repeat(40), assistantToken: "a".repeat(40), internal: [linkRequestInternalRoutes({ ledger, clock: movingClock(), requestIdPrefix: "" })] });
    servers.push(s);
    // Review 6: the host decides first, so a very long Lazada link gets the same answer.
    const longLazada = `https://www.lazada.vn/products/${"a".repeat(9000)}-i123456789.html`;
    expect(readProductLink(longLazada)).toEqual({ ok: false, reason: "network_unsupported" });
    for (const url of ["https://www.lazada.vn/products/ao-thun-i123456789.html", "https://s.lazada.vn/s.AbCd", "https://www.amazon.com/dp/B000", longLazada]) {
      const res = await s.internalApp.inject({ method: "POST", url: "/internal/link-requests", headers: { [ASSISTANT_TOKEN_HEADER]: "a".repeat(40) }, payload: { customer: "DP00001", url } });
      expect([res.statusCode, res.json()]).toEqual([400, { error: { code: "invalid_request", messageKey: "error.link.network_unsupported" } }]);
    }
    expect(ledger.sqlite.prepare("SELECT count(*) AS n FROM link_requests").get()).toEqual({ n: 0 });
    const errors = JSON.parse(readFileSync(join(REPOSITORY_ROOT, "packages/labels/vi/errors.json"), "utf8")) as Record<string, string>;
    expect(errors["error.link.network_unsupported"]).toContain("Shopee");
    expect(errors["error.link.network_unsupported"]).toContain("TikTok Shop");
  });

  it("AC3: an AccessTrade API error counts as a failure, and three counted failures fail the request and tell the customer", async () => {
    const ledger = linkLedger(ledgers);
    const clock = movingClock();
    const requestId = queueLink(ledger, "DP00001", TIKTOK, clock);
    const answers = [new TypeError("fetch failed"), { status: 500, body: { message: "busy" } }, { status: 200, body: { status: false, message: "try later" } }];
    const api = fakeApi((n) => answers[n - 1] ?? new Error("no more answers"));
    const accessTrade = accessTradeLinkCreator({ apiKey: API_KEY, post: api });
    const attempts: number[] = [];
    for (let attempt = 1; attempt <= 3; attempt++) {
      expect(await runLinks(ledger, NO_BRIDGE, { clock, accessTrade })).toEqual({ issued: 0, failed: 1, interrupted: false });
      attempts.push(linkRow(ledger, requestId).attempts);
      clock.advance(15 * 60_000);
    }
    expect(attempts).toEqual([1, 2, 3]);
    expect(linkRow(ledger, requestId)).toMatchObject({ status: "FAILED", affiliate_url: null });
    expect(outboxRows(ledger)).toEqual([{ dedup_key: `link_request:${requestId}:failed`, customer_id: C1, message_key: "link_failed" }]);
    expect(accessTradeLinksFor({ env: "dev", accesstradeApiKey: null })?.mode).toBe("fake");
    expect(accessTradeLinksFor({ env: "prod", accesstradeApiKey: API_KEY })?.mode).toBe("api");
  });

  it("review: a product outside the AccessTrade programme fails at once, with no retry, and the customer is told why", async () => {
    const ledger = linkLedger(ledgers);
    const requestId = queueLink(ledger, "DP00001", TIKTOK);
    const api = fakeApi(() => ({ status: 200, body: { status: false, code: "16666100", message: "Product is not part of the campaign" } }));
    expect(await runLinks(ledger, NO_BRIDGE, { accessTrade: accessTradeLinkCreator({ apiKey: API_KEY, post: api }) })).toEqual({ issued: 0, failed: 1, interrupted: false });
    expect(linkRow(ledger, requestId)).toMatchObject({ status: "FAILED", attempts: 1 });
    expect(outboxRows(ledger)).toEqual([{ dedup_key: `link_request:${requestId}:failed`, customer_id: C1, message_key: "link_not_in_affiliate" }]);
    expect(api.calls).toHaveLength(1);
    const messages = JSON.parse(readFileSync(join(REPOSITORY_ROOT, "packages/labels/vi/messages.json"), "utf8")) as Record<string, string>;
    expect(messages["link_not_in_affiliate"]).toContain("TikTok Shop");
  });

  it("review 4: a returned link or an API answer that carries another sub1 or sub2 fails the job", async () => {
    const bodies: unknown[] = [{ aff_short_url: `https://shorten.asia/x?sub1=${C1}&sub2=26110199999` }, { data: { aff_short_url: "https://shorten.asia/x", sub1: "1000000000000000002" } }];
    for (const body of bodies) {
      const ledger = linkLedger(ledgers);
      const requestId = queueLink(ledger, "DP00001", TIKTOK);
      const api = fakeApi(() => ({ status: 200, body }));
      expect(await runLinks(ledger, NO_BRIDGE, { accessTrade: accessTradeLinkCreator({ apiKey: API_KEY, post: api }) })).toEqual({ issued: 0, failed: 1, interrupted: false });
      expect(linkRow(ledger, requestId)).toMatchObject({ status: "QUEUED", affiliate_url: null, attempts: 1 });
    }
    // Echoed sub_ids that match are accepted.
    const ledger = linkLedger(ledgers);
    const requestId = queueLink(ledger, "DP00001", TIKTOK);
    const api = fakeApi(() => ({ status: 200, body: { data: { aff_short_url: `https://shorten.asia/x?sub1=${C1}`, sub1: C1, sub2: requestId } } }));
    expect(await runLinks(ledger, NO_BRIDGE, { accessTrade: accessTradeLinkCreator({ apiKey: API_KEY, post: api }) })).toEqual({ issued: 1, failed: 0, interrupted: false });
  });

  it("review 8: an answer other than 200 has its unread body dropped", async () => {
    const api = fakeApi((n) => (n === 1 ? { status: 503, body: {} } : { status: 200, body: { aff_short_url: "https://shorten.asia/ok" } }));
    const creator = accessTradeLinkCreator({ apiKey: API_KEY, post: api });
    const request = { network: "accesstrade", requestId: "R1", sourceUrl: TIKTOK, subId1: C1, subId2: "R1" } as const;
    expect(await creator.createLink(request, new AbortController().signal)).toEqual({ outcome: "failed", reason: "accesstrade_http_503" });
    expect((await creator.createLink(request, new AbortController().signal)).outcome).toBe("link");
    expect(api.discarded).toEqual([1]);
  });

  it("review: production without an AccessTrade key refuses a TikTok Shop link when it is submitted", async () => {
    const ledger = linkLedger(ledgers);
    expect(accessTradeLinksFor({ env: "prod", accesstradeApiKey: null })).toBeNull();
    const s = buildServers({ clock: movingClock(), internalToken: "i".repeat(40), assistantToken: "a".repeat(40), internal: [linkRequestInternalRoutes({ ledger, clock: movingClock(), requestIdPrefix: "", tikTok: false })] });
    servers.push(s);
    const post = (url: string) => s.internalApp.inject({ method: "POST", url: "/internal/link-requests", headers: { [ASSISTANT_TOKEN_HEADER]: "a".repeat(40) }, payload: { customer: "DP00001", url } });
    const res = await post(TIKTOK);
    expect([res.statusCode, res.json()]).toEqual([400, { error: { code: "invalid_request", messageKey: "error.link.tiktok_unavailable" } }]);
    expect((await post("https://shopee.vn/Ao-i.11001.22001")).statusCode).toBe(200);
    const errors = JSON.parse(readFileSync(join(REPOSITORY_ROOT, "packages/labels/vi/errors.json"), "utf8")) as Record<string, string>;
    expect(errors["error.link.tiktok_unavailable"]).toContain("TikTok Shop");
  });

  it("AC4: the AccessTrade key never appears in a log line, whatever the API answers", async () => {
    const ledger = linkLedger(ledgers);
    const clock = movingClock();
    queueLink(ledger, "DP00001", TIKTOK, clock);
    const { logger, lines } = memoryLogger();
    const answers = [new TypeError(`fetch failed Authorization: Token ${API_KEY}`), { status: 401, body: { message: `bad key ${API_KEY}` } }, { status: 200, body: { status: false, message: `key ${API_KEY} refused` } }];
    const accessTrade = accessTradeLinkCreator({ apiKey: API_KEY, post: fakeApi((n) => answers[n - 1] ?? new Error("none")) });
    for (let attempt = 1; attempt <= 3; attempt++) {
      await runLinks(ledger, NO_BRIDGE, { clock, accessTrade, logger });
      clock.advance(15 * 60_000);
    }
    expect(lines.length).toBeGreaterThanOrEqual(3);
    expect(lines.join("\n")).not.toContain(API_KEY);
    // Even a key logged by mistake under its own name is redacted.
    logger.info({ apiKey: API_KEY, accesstradeApiKey: API_KEY }, "test.key");
    expect(lines.join("\n")).not.toContain(API_KEY);
  });

  it("AccessTrade orders are always withheld 10% (D20), and dev links come from the fake creator on the fake host", async () => {
    expect(NETWORK_MONEY_RULES.accesstrade.alwaysWithheld).toBe(true);
    expect(networkDefinition("accesstrade").taxRule).toEqual({ kind: "always" });
    const ledger = linkLedger(ledgers);
    const requestId = queueLink(ledger, "DP00001", TIKTOK);
    expect(await runLinks(ledger, NO_BRIDGE, { accessTrade: fakeAccessTradeLinks() })).toEqual({ issued: 1, failed: 0, interrupted: false });
    expect(new URL(linkRow(ledger, requestId).affiliate_url ?? "").hostname).toBe("fake-bridge.invalid");
  });
});
