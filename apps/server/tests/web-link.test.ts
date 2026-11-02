/**
 * Story 7.6 (server side): the home page's link converter on the public listener. An unknown
 * customer code creates nothing (D10, INV-6); no code is a guest link of HOUSE (D5); the website
 * quota hands over to Zalo, counted per client for guests and typed codes, per customer once
 * signed in, with a safety cap that alerts the owner (review item 4); a made link answers product,
 * price, the estimate from packages/money and the share path, and only its signed-in owner's view
 * counts as delivered (review item 5); a Lazada link gets the polite refusal; a ticket is signed
 * and a malformed one is not found (review item 1). The website side is in
 * apps/web/tests/home-link.test.tsx.
 */
import { WEB_LINK_PATH, webLinkPath, webLinkQueuedSchema, webLinkResultSchema } from "@cashback/contracts";
import { fixedClock } from "@cashback/core";
import { shopeeEstimate } from "@cashback/money";
import { afterEach, describe, expect, it } from "vitest";

import { openSession } from "../src/modules/identity/index";
import { fakeBridge, WEB_LINKS_PER_CLIENT_HOUR, WEB_LINKS_PER_CUSTOMER_DAY, WEB_LINKS_SAFETY_CAP_HOUR } from "../src/modules/linking/index";
import type { Ledger } from "../src/platform/db/ledger";
import { clientKeyer } from "../src/platform/http/client-key";
import { buildServers, close, type Servers } from "../src/platform/http/servers";
import { CUSTOMER_SESSION_COOKIE } from "../src/platform/http/session-cookie";
import { requestOfTicket, ticketOf, webLinkRoutes } from "../src/web/web-link.routes";
import { alertRows, C1, C2, LINK_START, linkLedger, runLinks, SHOPEE_PRODUCT } from "./helpers/link-ledger";

const ORIGIN = "https://hoantiendp.com";
const SECRET = "t".repeat(40);
const CLOCK = fixedClock(LINK_START);
const ledgers: Ledger[] = [];
const opened: Servers[] = [];
afterEach(async () => {
  for (const s of opened.splice(0)) await close(s);
  for (const l of ledgers.splice(0)) l.close();
});

interface From {
  readonly cookie?: string;
  /** The caller's address as Cloudflare names it (the request comes through the loopback tunnel). */
  readonly ip?: string;
}

function site() {
  const ledger = linkLedger(ledgers);
  const routes = webLinkRoutes({ ledger, clock: CLOCK, origins: [ORIGIN], requestIdPrefix: "", tikTok: true, ticketSecret: SECRET, clientKey: clientKeyer("k".repeat(40)) });
  const servers = buildServers({ clock: CLOCK, internalToken: "i".repeat(40), public: [routes] });
  opened.push(servers);
  const headers = (from: From) => ({ "cf-connecting-ip": from.ip ?? "203.0.113.7", ...(from.cookie === undefined ? {} : { cookie: from.cookie }) });
  const post = async (payload: Record<string, unknown>, from: From = {}) => {
    const res = await servers.publicApp.inject({ method: "POST", url: WEB_LINK_PATH, headers: { origin: ORIGIN, ...headers(from) }, payload });
    return { status: res.statusCode, body: res.json() as Record<string, unknown> & { error?: { code: string; messageKey: string; fields?: Record<string, string> } } };
  };
  const result = async (ticket: string, from: From = {}) => {
    const res = await servers.publicApp.inject({ method: "GET", url: webLinkPath(ticket), headers: headers(from) });
    return { status: res.statusCode, body: res.json() as unknown };
  };
  const cookieOf = (customerId: string): string => `${CUSTOMER_SESSION_COOKIE}=${ledger.tx((db) => openSession(db, { kind: "CUSTOMER", customerId }, CLOCK, null)).token}`;
  const counts = () => ledger.sqlite.prepare("SELECT (SELECT count(*) FROM customers) AS customers, (SELECT count(*) FROM link_requests) AS requests").get() as { customers: number; requests: number };
  const owners = () => (ledger.sqlite.prepare("SELECT customer_id, channel, web_access FROM link_requests ORDER BY request_id").all() as { customer_id: string; channel: string; web_access: string }[]).map((r) => `${r.customer_id}/${r.channel}/${r.web_access}`);
  const status = () => (ledger.sqlite.prepare("SELECT status FROM link_requests").get() as { status: string }).status;
  return { ledger, servers, post, result, cookieOf, counts, owners, status };
}

const product = (n: number) => `https://shopee.vn/San-pham-i.11001.${22000 + n}`;
const ticketIn = (body: unknown) => webLinkQueuedSchema.parse(body).ticket;

describe("Story 7.6: Home link converter with a customer code or as a guest", () => {
  it("AC1: an unknown customer code shows 'not found' under the field and creates no link and no customer", async () => {
    const s = site();
    const before = s.counts();
    for (const code of ["DP99999", "dp99999", "HOUSE", C1]) {
      const answer = await s.post({ url: SHOPEE_PRODUCT, customerCode: code });
      expect([code, answer.status, answer.body.error?.fields]).toEqual([code, 404, { customerCode: "error.web_link.customer_unknown" }]);
    }
    expect(s.counts()).toEqual(before);
  });

  it("AC2: without a code the link is the guest account's (HOUSE): no estimate, and the answer says it is a guest link", async () => {
    const s = site();
    const queued = await s.post({ url: SHOPEE_PRODUCT });
    expect(webLinkQueuedSchema.parse(queued.body)).toMatchObject({ guest: true, customerCode: null });
    expect(s.owners()).toEqual(["HOUSE/web/GUEST"]);
    await runLinks(s.ledger, fakeBridge());
    s.ledger.sqlite.exec("UPDATE link_requests SET product_name = 'Ao thun', product_price = 159000, shopee_rate_bps = 350");
    const result = webLinkResultSchema.parse((await s.result(ticketIn(queued.body))).body);
    expect(result).toMatchObject({ state: "ready", guest: true, estimate: null });
    expect(result.sharePath).toMatch(/^\/s\/[A-Za-z0-9]+$/);
    // One guest link per product: the same product again is the same request (D5, D6).
    expect(ticketIn((await s.post({ url: SHOPEE_PRODUCT })).body)).toBe(ticketIn(queued.body));
    expect(s.ledger.sqlite.prepare("SELECT count(*) AS n FROM outbox").get()).toEqual({ n: 0 });
  });

  it("AC3 (review): guest links count per client: the 11th new one in an hour from one client is the Zalo hand-off (web_busy), another client is not affected", async () => {
    const s = site();
    for (let n = 0; n < WEB_LINKS_PER_CLIENT_HOUR; n++) expect((await s.post({ url: product(n) })).status).toBe(200);
    expect((await s.post({ url: product(0) })).status).toBe(200);
    const busy = await s.post({ url: product(99) });
    expect([busy.status, busy.body.error?.code, busy.body.error?.messageKey]).toEqual([429, "rate_limited", "error.link.web_busy"]);
    expect((await s.post({ url: product(99) }, { ip: "198.51.100.9" })).status).toBe(200);
  });

  it("AC3 (review): a typed code counts per client and is never charged to that customer's own allowance", async () => {
    const s = site();
    for (let n = 0; n < WEB_LINKS_PER_CLIENT_HOUR; n++) expect((await s.post({ url: product(n), customerCode: "DP00001" })).status).toBe(200);
    expect((await s.post({ url: product(50), customerCode: "DP00001" })).body.error?.messageKey).toBe("error.link.web_busy");
    expect((await s.post({ url: product(50), customerCode: "DP00001" }, { ip: "198.51.100.9" })).status).toBe(200);
    const own = s.cookieOf(C1);
    for (let n = 100; n < 100 + WEB_LINKS_PER_CUSTOMER_DAY; n++) expect([n, (await s.post({ url: product(n) }, { cookie: own })).status]).toEqual([n, 200]);
  });

  it("AC3 (review): a signed-in customer has 20 new links a Vietnam day; the 21st is the Zalo hand-off", async () => {
    const s = site();
    const own = s.cookieOf(C1);
    for (let n = 0; n < WEB_LINKS_PER_CUSTOMER_DAY; n++) expect((await s.post({ url: product(n) }, { cookie: own, ip: `198.51.100.${n}` })).status).toBe(200);
    expect((await s.post({ url: product(99) }, { cookie: own, ip: "198.51.100.200" })).body.error?.messageKey).toBe("error.link.web_busy");
    expect((await s.post({ url: product(99) }, { cookie: s.cookieOf(C2) })).status).toBe(200);
  });

  it("AC3 (review): over everyone, 600 new website links in an hour is a safety cap that hands over to Zalo and alerts the owner", async () => {
    const s = site();
    const insert = s.ledger.sqlite.prepare("INSERT INTO link_requests (request_id, customer_id, network, platform, channel, status, source_url, created_at, origin, web_access) VALUES (?, ?, 'shopee', 'shopee', 'web', 'ISSUED', 'https://shopee.vn/x', ?, 'REQUEST', 'SESSION')");
    for (let n = 0; n < WEB_LINKS_SAFETY_CAP_HOUR; n++) insert.run(`Q${n}`, C2, "2026-11-01T02:30:00.000Z");
    const busy = await s.post({ url: product(1), customerCode: "DP00001" });
    expect(busy.body.error?.messageKey).toBe("error.link.web_busy");
    expect(alertRows(s.ledger)).toEqual([{ kind: "web_link_safety_cap", severity: "high", suppressed: 0 }]);
  });

  it("AC4: with a valid code the made link shows product, price, the server's estimate and the share path", async () => {
    const s = site();
    const queued = webLinkQueuedSchema.parse((await s.post({ url: SHOPEE_PRODUCT, customerCode: " dp00001 " })).body);
    expect(queued).toMatchObject({ guest: false, customerCode: "DP00001" });
    expect(webLinkResultSchema.parse((await s.result(queued.ticket)).body)).toMatchObject({ state: "creating", sharePath: null });
    await runLinks(s.ledger, fakeBridge());
    s.ledger.sqlite.exec("UPDATE link_requests SET product_name = 'Ao thun', product_price = 159000, shopee_rate_bps = 350, seller_rate_bps = 200");
    const result = webLinkResultSchema.parse((await s.result(queued.ticket)).body);
    const expected = shopeeEstimate({ price: 159000, shopeeRateBps: 350, sellerRateBps: 200, withheld: true });
    expect(result).toMatchObject({ state: "ready", guest: false, factsSettled: true, product: { name: "Ao thun", price: 159000 }, estimate: { cashback: expected.cashback, withheld: true } });
    expect(s.owners()).toEqual([`${C1}/web/CODE`]);
  });

  it("review 5: a typed-code or another customer's view never touches delivery; only the signed-in owner's view hands the link over", async () => {
    const s = site();
    const queued = ticketIn((await s.post({ url: SHOPEE_PRODUCT, customerCode: "DP00001" })).body);
    await runLinks(s.ledger, fakeBridge());
    expect(webLinkResultSchema.parse((await s.result(queued)).body).state).toBe("ready");
    expect(s.status()).toBe("ISSUED");
    await s.result(queued, { cookie: s.cookieOf(C2) });
    expect(s.status()).toBe("ISSUED");
    await s.result(queued, { cookie: s.cookieOf(C1) });
    expect(s.status()).toBe("DELIVERED");
  });

  it("AC4: a signed-in customer's link is always their own, whatever code is typed", async () => {
    const s = site();
    const queued = await s.post({ url: SHOPEE_PRODUCT, customerCode: "DP00001" }, { cookie: s.cookieOf(C2) });
    expect(webLinkQueuedSchema.parse(queued.body).customerCode).toBe("DP00002");
    expect(s.owners()).toEqual([`${C2}/web/SESSION`]);
  });

  it("AC5: a Lazada link gets the server's polite refusal and nothing is queued", async () => {
    const s = site();
    const refused = await s.post({ url: "https://www.lazada.vn/products/ao-thun-i123.html" });
    expect([refused.status, refused.body.error?.messageKey]).toEqual([400, "error.link.network_unsupported"]);
    expect(s.counts().requests).toBe(0);
  });

  it("review 1: a ticket is signed; a guessed id, a changed or non-ASCII signature is not found (never a server error); a change needs the website's Origin", async () => {
    const s = site();
    const queued = ticketIn((await s.post({ url: SHOPEE_PRODUCT, customerCode: "DP00001" })).body);
    const requestId = requestOfTicket(SECRET, queued) ?? "";
    expect(ticketOf(SECRET, requestId)).toBe(queued);
    for (const bad of [requestId, `${requestId}.${"A".repeat(24)}`, ticketOf("x".repeat(40), requestId), `${requestId}.${"\u00e9".repeat(24)}`, `${requestId}.${"\u00e9".repeat(12)}`, `${requestId}.${"A".repeat(23)}\u00e9`, "..", `${queued}.x`]) {
      expect([bad, (await s.result(bad)).status]).toEqual([bad, 404]);
    }
    expect((await s.servers.publicApp.inject({ method: "POST", url: WEB_LINK_PATH, payload: { url: SHOPEE_PRODUCT } })).statusCode).toBe(403);
  });
});
