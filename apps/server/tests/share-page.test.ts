/**
 * Story 5.8: the share page `/s/<code>` gets the buyer out of Zalo's own browser, shows the product
 * and the estimated cashback in a real browser and then opens the stored link only, records one
 * click per visit by a person, and keeps imported 8-character codes working. Requests are injected
 * into the public listener; nothing leaves the process.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fixedClock } from "@cashback/core";
import pages from "@cashback/labels/vi/pages.json" with { type: "json" };
import { afterEach, describe, expect, it } from "vitest";

import { chromeIntentUrl, linkReplyData, shareAgentOf, type SharePageLink } from "../src/modules/linking/index";
import { escapeHtml } from "../src/pages/receipt.page";
import { IMAGE_HOSTS, percentOf, SHARE_CSP, shareHtml, sharePageRoutes } from "../src/pages/share.page";
import { parseConfig, REPOSITORY_ROOT } from "../src/platform/config/env.config";
import { isolationProblems, productionIdentifiers } from "../src/platform/config/isolation.config";
import type { Ledger } from "../src/platform/db/ledger";
import { buildServers, type Servers } from "../src/platform/http/servers";
import { C1, LINK_START, linkLedger } from "./helpers/link-ledger";
import { tempDir } from "./helpers/live-fixture";

const CLOCK = fixedClock(LINK_START);
const BASE = "https://hoantiendp.com";
const TARGET = "https://s.shopee.vn/AbC123x";
const IMPORTED = "Ab3dE5gH";
const NEW_CODE = "Zx9Yw8Vu7T";
const GUEST_CODE = "Gu3stC0de1";
const BARE_CODE = "N0Facts000";

const UA = {
  androidZalo: "Mozilla/5.0 (Linux; Android 13; SM-A536E Build/TP1A.220624.014; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/119.0.6045.193 Mobile Safari/537.36 Zalo android/12100542 ZaloTheme/light ZaloLanguage/vi",
  iosZalo: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Zalo iOS/24.11.1 ZaloTheme/light ZaloLanguage/vi",
  chrome: "Mozilla/5.0 (Linux; Android 13; SM-A536E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36",
  safari: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1",
  facebookPreview: "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
  googlebot: "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
} as const;

const ledgers: Ledger[] = [];
const servers: Servers[] = [];
afterEach(async () => {
  for (const s of servers.splice(0)) await Promise.all([s.publicApp.close(), s.internalApp.close()]);
  for (const l of ledgers.splice(0)) l.close();
});

/** A ledger with an imported request (8-character code), a new one with a snapshot, a guest one and one without facts. */
function shareLedger(): Ledger {
  const ledger = linkLedger(ledgers);
  ledger.sqlite.exec(`
    INSERT INTO link_requests (request_id, customer_id, network, platform, status, source_url, affiliate_url, product_name, product_image_url, product_price, shopee_rate_bps, seller_rate_bps, origin, created_at) VALUES
      ('26091100001', '${C1}', 'shopee', 'shopee', 'DELIVERED', 'https://shopee.vn/product/11001/22001', '${TARGET}', 'Noi com dien 1.8L', 'https://down-vn.img.susercontent.com/file/abc', 450000, 260, 0, 'CUTOVER', '2026-09-11T03:00:00.000Z'),
      ('26110100001', '${C1}', 'shopee', 'shopee', 'ISSUED', 'https://shopee.vn/product/11001/22002', 'https://s.shopee.vn/New777', 'Quat dung', 'http://plain.example/q.jpg', 2000000, 300, 150, 'REQUEST', '${LINK_START}'),
      ('26110100002', 'HOUSE', 'shopee', 'shopee', 'ISSUED', 'https://shopee.vn/product/11001/22003', 'https://s.shopee.vn/Guest88', 'Ban chai', NULL, 99000, 300, 0, 'REQUEST', '${LINK_START}'),
      ('26110100003', '${C1}', 'shopee', 'shopee', 'ISSUED', 'https://s.shopee.vn/Short1', 'https://s.shopee.vn/Bare999', NULL, NULL, NULL, NULL, NULL, 'REQUEST', '${LINK_START}'),
      ('26110100004', '${C1}', 'shopee', 'shopee', 'QUEUED', 'https://shopee.vn/product/11001/22004', NULL, NULL, NULL, NULL, NULL, NULL, 'REQUEST', '${LINK_START}'),
      ('26110100005', '${C1}', 'shopee', 'shopee', 'ISSUED', 'https://shopee.vn/product/11001/22005', 'https://evil.example/go', NULL, NULL, NULL, NULL, NULL, 'REQUEST', '${LINK_START}');
    INSERT INTO share_codes (code, request_id) VALUES ('${IMPORTED}', '26091100001'), ('${NEW_CODE}', '26110100001'), ('${GUEST_CODE}', '26110100002'), ('${BARE_CODE}', '26110100003'), ('Queued0000', '26110100004'), ('Evil000000', '26110100005');`);
  return ledger;
}

function app(ledger: Ledger, baseUrl: string | null = BASE): Servers {
  const s = buildServers({ clock: CLOCK, internalToken: "i".repeat(40), public: [sharePageRoutes({ ledger, clock: CLOCK, baseUrl })] });
  servers.push(s);
  return s;
}

const open = (s: Servers, code: string, userAgent: string = UA.chrome, method: "GET" | "HEAD" = "GET", query = "", host?: string) => s.publicApp.inject({ method, url: `/s/${code}${query}`, headers: { "user-agent": userAgent, ...(host === undefined ? {} : { host }) } });
const clicks = (ledger: Ledger) => ledger.sqlite.prepare("SELECT share_code, request_id, agent FROM link_clicks ORDER BY click_id").all() as { share_code: string; request_id: string; agent: string }[];
const refreshOf = (html: string): string | null => /<meta http-equiv="refresh" content="([^"]*)">/.exec(html)?.[1]?.replaceAll("&amp;", "&") ?? null;
const hrefs = (html: string): string[] => [...html.matchAll(/href="([^"]*)"/g)].map((m) => (m[1] ?? "").replaceAll("&amp;", "&"));
const label = (key: keyof typeof pages, params: Record<string, string> = {}): string => escapeHtml(pages[key].replace(/\{(\w+)\}/g, (w, n: string) => params[n] ?? w));

describe("Story 5.8 AC1: Android in Zalo goes to Chrome", () => {
  it("AC1: an Android Zalo user agent is sent at once to Chrome by intent to the same share URL, with the intent on its button", async () => {
    const res = await open(app(shareLedger()), NEW_CODE, UA.androidZalo);
    expect(res.statusCode).toBe(200);
    const intent = chromeIntentUrl(`${BASE}/s/${NEW_CODE}?via=app`, "https://s.shopee.vn/New777");
    expect(intent).toBe(`intent://hoantiendp.com/s/${NEW_CODE}?via=app#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent("https://s.shopee.vn/New777")};end`);
    expect(refreshOf(res.body)).toBe(`0;url=${intent}`);
    expect(hrefs(res.body)).toContain(intent);
    expect(res.body).toContain(label("share_open_chrome"));
  });
});

describe("Story 5.8 AC2: iPhone in Zalo shows the Safari step", () => {
  it("AC2: an iOS Zalo user agent sees the step and a copy-link button, and the page does not redirect", async () => {
    const res = await open(app(shareLedger()), NEW_CODE, UA.iosZalo);
    expect(res.body).toContain(escapeHtml("B\u1ea5m \u2022\u2022\u2022 r\u1ed3i ch\u1ecdn M\u1edf b\u1eb1ng Safari"));
    expect(res.body).toContain(`data-copy="${BASE}/s/${NEW_CODE}"`);
    expect(res.body).toContain(label("share_copy_link"));
    expect(refreshOf(res.body)).toBeNull();
    expect(hrefs(res.body).some((h) => h.startsWith("https://s.shopee.vn"))).toBe(false);
  });
});

describe("Story 5.8 AC3: a real browser sees the product, then the stored link", () => {
  it("AC3: product, price and the estimated cashback with an example, then the stored link after one second", async () => {
    const res = await open(app(shareLedger()), IMPORTED, UA.chrome);
    expect(res.body).toContain("Noi com dien 1.8L");
    expect(res.body).toContain("450.000\u0111");
    // No payout batch is known yet, so the estimate is withheld (D54): 11,700 commission, 8,332 cashback.
    expect(res.body).toContain('data-estimate="8332"');
    expect(res.body).toContain(`${label("share_about")} <b>8.332\u0111</b>`);
    expect(res.body).toContain(label("share_estimate_tag"));
    expect(res.body).toContain(`${label("share_rate_shopee", { rate: "2,6%" })}</span><span>11.700\u0111`);
    expect(res.body).toContain(`${label("share_rate_customer_share_withheld", { rate: "80%" })}</span><span>8.332\u0111`);
    expect(refreshOf(res.body)).toBe(`1;url=${TARGET}`);
    expect(hrefs(res.body)).toContain(TARGET);
  });

  it("AC3: the estimate follows the latest payout batch: a batch paid without tax gives the UJ-1 9,268 dong", async () => {
    const ledger = shareLedger();
    ledger.sqlite.exec(`INSERT INTO network_withholding (network, withheld, network_payout_id, observed_at, recorded_at) VALUES ('shopee', 0, 'P1', '2026-10-29T00:00:00.000Z', '2026-10-29T00:00:00.000Z')`);
    const res = await open(app(ledger), IMPORTED, UA.safari);
    expect(res.body).toContain('data-estimate="9268"');
    expect(res.body).toContain(`${label("share_rate_customer_share", { rate: "80%" })}</span><span>9.268\u0111`);
  });

  it("AC3: no query parameter can change the target, and a stored link off the networks is never opened", async () => {
    const s = app(shareLedger());
    for (const query of ["?url=https://evil.example", "?target=https%3A%2F%2Fevil.example&next=//evil.example", "?redirect=javascript:alert(1)"]) {
      const res = await open(s, IMPORTED, UA.chrome, "GET", query);
      expect(refreshOf(res.body)).toBe(`1;url=${TARGET}`);
      expect(res.body).not.toContain("evil.example");
      expect(res.body).not.toContain("javascript:");
    }
    const evil = await open(s, "Evil000000");
    expect(evil.statusCode).toBe(404);
    expect(evil.body).not.toContain("evil.example");
    expect((await open(s, "Queued0000")).statusCode).toBe(404);
  });

  it("AC3: a product with no rate shows a dash for the estimate, never 0; a capped product says so; a plain-http picture is left out", async () => {
    const s = app(shareLedger());
    const bare = await open(s, BARE_CODE);
    expect(bare.body).toContain('data-estimate="none"');
    expect(bare.body).toContain(`<span class="missing">${label("value_missing")}</span>`);
    expect(bare.body).not.toContain("0\u0111</b>");
    const capped = await open(s, NEW_CODE);
    expect(capped.body).toContain(label("share_capped"));
    expect(capped.body).not.toContain("plain.example");
    expect(percentOf(150)).toBe("1,5%");
  });

  it("AC3: the page is served with a strict CSP, no caching, no referrer and noindex", async () => {
    const res = await open(app(shareLedger()), IMPORTED);
    expect(res.headers["content-security-policy"]).toBe(SHARE_CSP);
    expect(SHARE_CSP).toContain("default-src 'none'");
    expect(SHARE_CSP).toContain("frame-ancestors 'none'");
    expect(SHARE_CSP).not.toContain("unsafe-inline");
    expect(res.headers).toMatchObject({ "cache-control": "no-store", "referrer-policy": "no-referrer", "x-robots-tag": "noindex, nofollow", "x-content-type-options": "nosniff" });
  });
});

describe("Story 5.8 AC4: clicks are recorded per visit by a person", () => {
  it("AC4: a HEAD request and preview bots record no click; a GET from a browser records one, with its browser kind only", async () => {
    const ledger = shareLedger();
    const s = app(ledger);
    expect((await open(s, IMPORTED, UA.chrome, "HEAD")).statusCode).toBe(200);
    await open(s, IMPORTED, UA.facebookPreview);
    await open(s, IMPORTED, UA.googlebot);
    await open(s, IMPORTED, "");
    expect(clicks(ledger)).toEqual([]);
    await open(s, IMPORTED, UA.chrome);
    expect(clicks(ledger)).toEqual([{ share_code: IMPORTED, request_id: "26091100001", agent: "browser" }]);
    await open(s, IMPORTED, UA.androidZalo);
    expect(clicks(ledger).map((c) => c.agent)).toEqual(["browser", "in_app"]);
    expect(Object.keys(ledger.sqlite.prepare("SELECT * FROM link_clicks LIMIT 1").get() as object).sort()).toEqual(["agent", "click_id", "clicked_at", "request_id", "share_code"]);
    expect([shareAgentOf(UA.iosZalo), shareAgentOf(UA.safari), shareAgentOf(UA.facebookPreview)]).toEqual(["in_app", "browser", "bot"]);
  });

  it("AC4: an unknown code records nothing", async () => {
    const ledger = shareLedger();
    await open(app(ledger), "Unknown123");
    expect(clicks(ledger)).toEqual([]);
  });
});

describe("Story 5.8 AC5: imported codes work, unknown codes say so", () => {
  it("AC5: an imported 8-character code opens its link; an unknown or malformed code shows the no-longer-works page with the Zalo button and 404", async () => {
    const s = app(shareLedger());
    const imported = await open(s, IMPORTED);
    expect(imported.statusCode).toBe(200);
    expect(refreshOf(imported.body)).toBe(`1;url=${TARGET}`);
    for (const code of ["Unknown123", "ab3de5gh", "short", "..%2F..%2Fetc"]) {
      const res = await open(s, code);
      expect(res.statusCode).toBe(404);
      expect(res.body).toContain(escapeHtml("Link n\u00e0y kh\u00f4ng c\u00f2n d\u00f9ng \u0111\u01b0\u1ee3c"));
      expect(hrefs(res.body)).toContain(pages.share_zalo_url);
      expect(refreshOf(res.body)).toBeNull();
    }
  });
});

describe("Story 5.8 AC6: guest links and accessibility", () => {
  it("AC6: a guest link shows the guest warning instead of the cashback line, with the Zalo button first and no automatic redirect", async () => {
    const res = await open(app(shareLedger()), GUEST_CODE, UA.chrome);
    expect(res.body).toContain("data-guest");
    expect(res.body).toContain(label("share_guest_title"));
    expect(res.body).not.toContain("data-estimate");
    expect(res.body).not.toContain(label("share_cashback_label"));
    const links = hrefs(res.body);
    expect(links.indexOf(pages.share_zalo_url)).toBeLessThan(links.indexOf("https://s.shopee.vn/Guest88"));
    expect(refreshOf(res.body)).toBeNull();
  });

  it("AC6: every page is lang=vi, zoomable, has one h1, alt on every image and a name on every control", async () => {
    const s = app(shareLedger());
    for (const [code, ua] of [[IMPORTED, UA.chrome], [GUEST_CODE, UA.chrome], [NEW_CODE, UA.androidZalo], [NEW_CODE, UA.iosZalo], ["Unknown123", UA.chrome]] as const) {
      const html = (await open(s, code, ua)).body;
      expect(html).toContain('<html lang="vi">');
      expect(html).toContain('<meta name="viewport" content="width=device-width, initial-scale=1">');
      expect(html.match(/<h1[ >]/g)).toHaveLength(1);
      for (const img of html.match(/<img [^>]*>/g) ?? []) expect(img).toMatch(/ alt="/);
      for (const control of html.match(/<(a|button) [^>]*>[^<]*<\/(a|button)>/g) ?? []) expect(control.replace(/<[^>]+>/g, "").trim()).not.toBe("");
    }
  });

  it("AC6: the colour pairs the page uses reach WCAG 2.2 AA contrast (4.5:1 for text)", () => {
    const tokens = readFileSync(join(REPOSITORY_ROOT, "packages/ui/src/styles/tokens.css"), "utf8");
    const hex = (name: string): string => new RegExp(`--${name}:\\s*(#[0-9A-Fa-f]{6})`).exec(tokens)?.[1] ?? "";
    const luminance = (h: string): number => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)) as [number, number, number];
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const ratio = (a: string, b: string): number => {
      const [x, y] = [luminance(hex(a)), luminance(hex(b))].sort((p, q) => q - p) as [number, number];
      return (x + 0.05) / (y + 0.05);
    };
    const pairs = [["foreground", "card"], ["muted-foreground", "card"], ["muted-foreground", "background"], ["money", "money-soft"], ["secondary-foreground", "money-soft"], ["muted-foreground", "money-soft"], ["muted-foreground", "muted"], ["warning", "warning-soft"], ["secondary-foreground", "secondary"], ["primary-foreground", "primary"]] as const;
    for (const [fg, bg] of pairs) expect(`${fg} on ${bg}: ${ratio(fg, bg) >= 4.5}`).toBe(`${fg} on ${bg}: true`);
  });
});

describe("Story 5.8 review items 5, 6, 8 and 10", () => {
  it("item 5: an Android Zalo visit and the Chrome visit its hand-off opens count as one click; the flag never changes the target", async () => {
    const ledger = shareLedger();
    const s = app(ledger);
    await open(s, IMPORTED, UA.androidZalo);
    const followUp = await open(s, IMPORTED, UA.chrome, "GET", "?via=app");
    expect(clicks(ledger).map((c) => c.agent)).toEqual(["in_app"]);
    expect(refreshOf(followUp.body)).toBe(`1;url=${TARGET}`);
    await open(s, IMPORTED, UA.chrome);
    expect(clicks(ledger).map((c) => c.agent)).toEqual(["in_app", "browser"]);
  });

  it("item 6: without PUBLIC_BASE_URL the page is served only on this machine's own host; any other Host header is refused, never built into a link", async () => {
    const ledger = shareLedger();
    const s = app(ledger, null);
    const local = await open(s, NEW_CODE, UA.iosZalo, "GET", "", "127.0.0.1:9080");
    expect(local.statusCode).toBe(200);
    expect(local.body).toContain('data-copy="http://127.0.0.1:9080/s/Zx9Yw8Vu7T"');
    for (const host of ["evil.example", "hoantiendp.com.evil.example:443", "127.0.0.1.evil.example"]) {
      const refused = await open(s, NEW_CODE, UA.androidZalo, "GET", "", host);
      expect(refused.statusCode).toBe(503);
      expect(refused.body).not.toContain("evil");
      expect(refused.body).not.toContain("intent://");
    }
    expect(clicks(ledger).map((c) => c.agent)).toEqual(["in_app"]);
  });

  it("item 8: a picture is shown only from a host the CSP allows: the bare susercontent.com is left out, its subdomains and shopee.vn are kept", () => {
    expect(SHARE_CSP).toContain(`img-src data: ${IMAGE_HOSTS.map((h) => `https://${h}`).join(" ")};`);
    const page = (imageUrl: string) => {
      const link: SharePageLink = { code: NEW_CODE, requestId: "R1", target: TARGET, guest: false, network: "shopee", productName: "x", productImageUrl: imageUrl, productPrice: 1000, shopeeRateBps: 100, sellerRateBps: 0 };
      return shareHtml({ link, reply: linkReplyData(link, { guest: false, withheld: true }), variant: "browser", shareUrl: `${BASE}/s/${NEW_CODE}` });
    };
    expect(page("https://susercontent.com/file/a")).not.toContain("<img class=\"thumb\"");
    expect(page("https://evilsusercontent.com/file/a")).not.toContain("<img class=\"thumb\"");
    expect(page("https://down-vn.img.susercontent.com/file/a")).toContain('<img class="thumb" src="https://down-vn.img.susercontent.com/file/a"');
    expect(page("https://cf.shopee.vn/file/a")).toContain('<img class="thumb"');
    expect(page("https://shopee.vn/file/a")).toContain('<img class="thumb"');
  });

  it("item 10: the guest check is one lookup of the request's own customer, so a code of a customer is never shown as a guest link", async () => {
    const ledger = shareLedger();
    const s = app(ledger);
    expect((await open(s, GUEST_CODE)).body).toContain("data-guest");
    expect((await open(s, IMPORTED)).body).not.toContain("data-guest");
  });
});

describe("Story 5.8 review item 6: production must have PUBLIC_BASE_URL", () => {
  it("item 6: production without PUBLIC_BASE_URL is refused at startup; dev must leave it empty", () => {
    const context = { identifiers: productionIdentifiers(REPOSITORY_ROOT, tempDir("cashback-home-")), prodEnv: null, devFileIsProdFile: false, caseInsensitive: process.platform === "win32" };
    const prod = (values: Record<string, string>) => isolationProblems(parseConfig("prod", { INTERNAL_TOKEN: "t".repeat(40), BRIDGE_TOKEN: "k".repeat(40), ...values }), context).map((p) => `${p.key} ${p.reason}`);
    expect(prod({})).toEqual(["PUBLIC_BASE_URL required"]);
    expect(prod({ PUBLIC_BASE_URL: "https://hoantiendp.com" })).toEqual([]);
  });
});
