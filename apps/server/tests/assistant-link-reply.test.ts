/**
 * Story 6.3 (server side): a product link pasted in Zalo is queued for its sender and its reply
 * carries the share link `/s/<code>` (never the affiliate link), the product, the price and the
 * estimated cashback, through the fake bridge (FR-1, AD-14, AD-15, D6, D17). The assistant side
 * (waiting, "on its way", the texts) is in apps/assistant/tests/link-reply.test.ts.
 */
import { ASSISTANT_LINK_REPLY_PATH, ASSISTANT_LINK_REQUEST_PATH, type BridgeLookupValue } from "@cashback/contracts";
import { fixedClock } from "@cashback/core";
import { shopeeEstimate } from "@cashback/money";
import { afterEach, describe, expect, it } from "vitest";

import { assistantChatRoutes } from "../src/links/assistant-chat.routes";
import { linkEffectsFor, shareBaseUrlFor } from "../src/links/link-jobs";
import { fakeBridge, runProductLookups, type LinkJobRun } from "../src/modules/linking/index";
import type { Ledger } from "../src/platform/db/ledger";
import { ASSISTANT_TOKEN_HEADER } from "../src/platform/http/internal-token.guard";
import { buildServers, close, type Servers } from "../src/platform/http/servers";
import type { BridgePort, LinkBridgeJob } from "../src/platform/ports/bridge.port";
import { C1, C2, LINK_START, linkLedger, runLinks, SILENT } from "./helpers/link-ledger";

const CLOCK = fixedClock(LINK_START);
const INTERNAL = "i".repeat(40);
const ASSISTANT = "a".repeat(40);
const PRODUCT = "https://shopee.vn/Noi-com-i.11001.22001";
const COOKER: BridgeLookupValue = { found: true, shopId: "11001", itemId: "22001", name: "Noi com dien 1.8L", imageUrl: null, priceText: "\u20ab450.000", rates: { commissionTexts: ["Hoa h\u1ed3ng 2,6%"], xtraTexts: [] } };

const ledgers: Ledger[] = [];
const opened: Servers[] = [];
afterEach(async () => {
  for (const s of opened.splice(0)) await close(s);
  for (const l of ledgers.splice(0)) l.close();
});

function app() {
  const ledger = linkLedger(ledgers);
  const servers = buildServers({ clock: CLOCK, internalToken: INTERNAL, assistantToken: ASSISTANT, internal: [assistantChatRoutes({ ledger, clock: CLOCK, requestIdPrefix: "", tikTok: true, shareBaseUrl: "https://hoantiendp.com/" })] });
  opened.push(servers);
  const post = (url: string, payload: object) => servers.internalApp.inject({ method: "POST", url, headers: { [ASSISTANT_TOKEN_HEADER]: ASSISTANT }, payload });
  return { ledger, post };
}

/** The fake bridge, watched: every link job it was handed. */
function watchedBridge(): BridgePort & { jobs: LinkBridgeJob[] } {
  const fake = fakeBridge(() => COOKER);
  const jobs: LinkBridgeJob[] = [];
  return { ...fake, jobs, createLink: async (job, signal) => (jobs.push(job), fake.createLink(job, signal)) };
}

async function linkJobRun(ledger: Ledger, bridge: BridgePort): Promise<LinkJobRun> {
  const run = await runLinks(ledger, bridge);
  await runProductLookups({ ledger, clock: CLOCK, bridge, logger: SILENT, effects: linkEffectsFor(CLOCK) }, new AbortController().signal);
  return run;
}

describe("Story 6.3: a product link pasted in Zalo gets a share link reply", () => {
  it("AC1: with the bridge healthy the reply has the product, the price, the estimate and the hoantiendp.com/s/<code> link, never the affiliate link", async () => {
    const { ledger, post } = app();
    const queued = (await post(ASSISTANT_LINK_REQUEST_PATH, { zaloUserId: C1, chat: "private", url: PRODUCT })).json() as { requestId: string; customerId: string };
    expect(queued.customerId).toBe(C1);
    const before = (await post(ASSISTANT_LINK_REPLY_PATH, { requestId: queued.requestId, customerId: C1 })).json();
    expect(before).toMatchObject({ status: "QUEUED", shareUrl: null, estimate: null });
    await linkJobRun(ledger, watchedBridge());
    const reply = (await post(ASSISTANT_LINK_REPLY_PATH, { requestId: queued.requestId, customerId: C1 })).json() as Record<string, unknown>;
    const code = (ledger.sqlite.prepare("SELECT code FROM share_codes WHERE request_id = ?").get(queued.requestId) as { code: string }).code;
    const expected = shopeeEstimate({ price: 450_000, shopeeRateBps: 260, sellerRateBps: 0, withheld: true });
    expect(reply).toEqual({
      requestId: queued.requestId,
      status: "ISSUED",
      shareUrl: `https://hoantiendp.com/s/${code}`,
      factsSettled: true,
      network: "shopee",
      perShop: false,
      product: { name: "Noi com dien 1.8L", price: 450_000 },
      estimate: { cashback: expected.cashback, shareBps: expected.cashbackShareBps, withheld: true },
    });
    expect(JSON.stringify(reply)).not.toContain("invalid");
    expect(shareBaseUrlFor({ publicBaseUrl: null, publicPort: 9080 })).toBe("http://127.0.0.1:9080");
    expect(shareBaseUrlFor({ publicBaseUrl: "https://hoantiendp.com", publicPort: 8080 })).toBe("https://hoantiendp.com");
  });

  it("AC2: a request asked again by the assistant is never queued twice: the same product is the customer's own request back", async () => {
    const { ledger, post } = app();
    const first = (await post(ASSISTANT_LINK_REQUEST_PATH, { zaloUserId: C1, chat: "private", url: PRODUCT })).json() as { requestId: string };
    const reply = (await post(ASSISTANT_LINK_REPLY_PATH, { requestId: first.requestId, customerId: C1 })).json();
    expect(reply).toMatchObject({ status: "QUEUED", shareUrl: null, factsSettled: false });
    const again = (await post(ASSISTANT_LINK_REQUEST_PATH, { zaloUserId: C1, chat: "private", url: PRODUCT })).json() as { requestId: string; reused: boolean };
    expect(again).toMatchObject({ requestId: first.requestId, reused: true });
    expect((ledger.sqlite.prepare("SELECT count(*) AS n FROM link_requests").get() as { n: number }).n).toBe(1);
  });

  it("AC3: a Lazada link is refused with the message naming the supported networks, and nothing is queued", async () => {
    const { ledger, post } = app();
    const res = await post(ASSISTANT_LINK_REQUEST_PATH, { zaloUserId: C1, chat: "private", url: "https://www.lazada.vn/products/noi-com-i123.html" });
    expect([res.statusCode, res.json()]).toEqual([200, { outcome: "refused", reason: "network_unsupported", customerId: C1, customerCode: "DP00001", registered: false }]);
    expect((ledger.sqlite.prepare("SELECT count(*) AS n FROM link_requests").get() as { n: number }).n).toBe(0);
  });

  it("AC4: a link pasted in the group by a registered customer carries that customer's sub_id1, and its reply is never given to another member", async () => {
    const { ledger, post } = app();
    const bridge = watchedBridge();
    const queued = (await post(ASSISTANT_LINK_REQUEST_PATH, { zaloUserId: C2, chat: "group", url: PRODUCT })).json() as { requestId: string; customerId: string };
    expect(queued.customerId).toBe(C2);
    await linkJobRun(ledger, bridge);
    expect(bridge.jobs.map((j) => [j.subId1, j.subId2])).toEqual([[C2, queued.requestId]]);
    expect(ledger.sqlite.prepare("SELECT customer_id, channel FROM link_requests").all()).toEqual([{ customer_id: C2, channel: "zalo" }]);
    const other = await post(ASSISTANT_LINK_REPLY_PATH, { requestId: queued.requestId, customerId: C1 });
    expect([other.statusCode, other.json()]).toEqual([404, { error: { code: "not_found", messageKey: "error.link.request_not_found" } }]);
    expect((await post(ASSISTANT_LINK_REPLY_PATH, { requestId: queued.requestId, customerId: "DP00002" })).statusCode).toBe(200);
  });

  it("review 1: every refusal of the link request is an answer with its reason, the full day included", async () => {
    const { ledger, post } = app();
    ledger.sqlite.exec("INSERT INTO customers (customer_id, customer_code, role, status, zalo_user_id) VALUES ('7000000000000000077', 'DP00077', 'USER', 'DISABLED', '7000000000000000077')");
    const disabled = await post(ASSISTANT_LINK_REQUEST_PATH, { zaloUserId: "7000000000000000077", chat: "private", url: PRODUCT });
    expect(disabled.json()).toMatchObject({ outcome: "refused", reason: "customer_disabled" });
    const day = PRODUCT.replace("22001", "22002");
    ledger.sqlite.exec(`INSERT INTO link_requests (request_id, customer_id, network, platform, status, source_url, origin) VALUES ('26110199999', '${C2}', 'shopee', 'shopee', 'FAILED', 'https://shopee.vn/x', 'REQUEST')`);
    const full = await post(ASSISTANT_LINK_REQUEST_PATH, { zaloUserId: C1, chat: "private", url: day });
    expect(full.json()).toMatchObject({ outcome: "refused", reason: "day_full", customerId: C1 });
    const long = await post(ASSISTANT_LINK_REQUEST_PATH, { zaloUserId: C1, chat: "group", url: `https://shopee.vn/search?keyword=${"a".repeat(2_100)}` });
    expect(long.json()).toMatchObject({ outcome: "refused", reason: "url_too_long" });
  });

  it("a ShopeeFood link replies per shop with no amount (D60)", async () => {
    const { ledger, post } = app();
    const queued = (await post(ASSISTANT_LINK_REQUEST_PATH, { zaloUserId: C1, chat: "private", url: "https://shopeefood.vn/ho-chi-minh/com-tam-ba-ghien" })).json() as { requestId: string };
    await linkJobRun(ledger, watchedBridge());
    const reply = (await post(ASSISTANT_LINK_REPLY_PATH, { requestId: queued.requestId, customerId: C1 })).json();
    expect(reply).toMatchObject({ perShop: true, estimate: null, factsSettled: true, product: { price: null } });
  });
});
