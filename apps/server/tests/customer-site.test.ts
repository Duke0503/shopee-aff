/**
 * Story 7.1 (server side): the customer website on the public listener (AD-18, AD-21, FR-36).
 * `GET /api/site-status` reports the assistant down exactly while the health check has it marked
 * down, with the fallback contact path and the assistant's chat from the config; the built
 * website is served for its own pages (404 for any other page), its hashed files are cached, and
 * the server pages /b/<token> and /s/<code> and the JSON 404 of /api keep working beside it. The
 * admin desk's build is served on the admin host only, and neither host gets the other's files.
 * The pages themselves are tested in apps/web/tests.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CUSTOMER_PATHS, SITE_STATUS_PATH, type AssistantHeartbeat } from "@cashback/contracts";
import { afterEach, describe, expect, it } from "vitest";

import { adminBuildRoutes } from "../src/admin/admin-build";
import { assistantHeartbeats, ledgerAlerts, runAssistantHealthCheck } from "../src/modules/operations/index";
import { receiptPageRoutes } from "../src/pages/receipt.page";
import { sharePageRoutes } from "../src/pages/share.page";
import { ConfigError, parseConfig, REPOSITORY_ROOT } from "../src/platform/config/env.config";
import { isolationProblems, productionIdentifiers } from "../src/platform/config/isolation.config";
import { buildServers, close, type PublicRoutes, type Servers } from "../src/platform/http/servers";
import { DESK_CSP, SITE_CSP, staticBuildRoutes } from "../src/platform/http/static-site";
import { customerOrigins, customerSite } from "../src/web/customer-site";
import { closeLedgers, movingClock } from "./helpers/order-ledger";
import { tempDir } from "./helpers/live-fixture";
import { NOW, payoutLedger } from "./helpers/payout-ledger";

const MINUTE = 60_000;
const FALLBACK = "https://m.me/hoantiendp.test";
const ASSISTANT = "https://zalo.me/0900000000";
const ADMIN_HOST = "admin.hoantiendp.com";
const INDEX = '<!doctype html><html lang="vi"><head><script type="module" src="/assets/index-abc123.js"></script></head><body><div id="root"></div></body></html>';
const DESK_INDEX = '<!doctype html><html lang="vi"><head><script type="module" src="/admin/assets/desk-def456.js"></script></head><body><div id="root"></div></body></html>';
const beat: AssistantHeartbeat = { zalo: "account", session: "connected", startedAt: NOW, queuedSends: 0 };
const SITE_CONFIG = { env: "prod", publicBaseUrl: "https://hoantiendp.com", publicPort: 8080, fallbackContactUrl: FALLBACK, zaloAssistantUrl: ASSISTANT, staffAccess: null, fingerprintKey: "k".repeat(40) } as const;

const opened: Servers[] = [];
afterEach(async () => {
  for (const s of opened.splice(0)) await close(s);
  closeLedgers();
});

/** A website build as Vite writes it: the page, one hashed script, one public file. */
function fakeBuild(): string {
  const dist = tempDir("cashback-web-dist-");
  mkdirSync(join(dist, "assets"));
  writeFileSync(join(dist, "index.html"), INDEX);
  writeFileSync(join(dist, "assets", "index-abc123.js"), "console.log('site')");
  writeFileSync(join(dist, "logo-mark-64.webp"), Buffer.from([0x52, 0x49, 0x46, 0x46]));
  return dist;
}

/** The admin desk's build, made with base /admin/. */
function fakeDeskBuild(): string {
  const dist = tempDir("cashback-admin-dist-");
  mkdirSync(join(dist, "assets"));
  writeFileSync(join(dist, "index.html"), DESK_INDEX);
  writeFileSync(join(dist, "assets", "desk-def456.js"), "console.log('desk')");
  return dist;
}

function publicApp(routes: PublicRoutes[]) {
  const servers = buildServers({ clock: movingClock(NOW), internalToken: "i".repeat(40), public: routes });
  opened.push(servers);
  return servers.publicApp;
}

describe("Story 7.1 AC1 and AC2: the site status follows the assistant's down state", () => {
  it("reports up, then down with the fallback contact path once the health check marks it down, then up again when a beat returns", async () => {
    const ledger = payoutLedger();
    const clock = movingClock(NOW);
    const heartbeats = assistantHeartbeats(clock.now());
    const check = () => runAssistantHealthCheck({ heartbeats, clock, alerts: ledgerAlerts(ledger, clock) });
    const app = publicApp(customerSite({ config: SITE_CONFIG, ledger, clock, heartbeats, dist: tempDir("cashback-no-build-") }).routes);
    const status = async () => {
      const res = await app.inject({ method: "GET", url: SITE_STATUS_PATH });
      expect(res.headers["cache-control"]).toBe("no-store");
      return res.json();
    };
    heartbeats.record(beat, clock.now());
    expect(await status()).toEqual({ assistant: "up", fallbackContactUrl: FALLBACK, assistantUrl: ASSISTANT });
    clock.advance(5 * MINUTE + 1);
    expect(check()).toBe("went_down");
    expect(await status()).toEqual({ assistant: "down", fallbackContactUrl: FALLBACK, assistantUrl: ASSISTANT });
    clock.advance(MINUTE);
    heartbeats.record(beat, clock.now());
    expect(check()).toBe("came_back");
    expect(await status()).toEqual({ assistant: "up", fallbackContactUrl: FALLBACK, assistantUrl: ASSISTANT });
  });

  it("takes the fallback contact path only as an https page or a tel: number, and the assistant's chat only as a zalo.me link", () => {
    const base = { INTERNAL_TOKEN: "t".repeat(40) };
    expect(parseConfig("dev", base)).toMatchObject({ fallbackContactUrl: null, zaloAssistantUrl: null });
    expect(parseConfig("dev", { ...base, FALLBACK_CONTACT_URL: FALLBACK }).fallbackContactUrl).toBe(FALLBACK);
    expect(parseConfig("dev", { ...base, FALLBACK_CONTACT_URL: "tel:+84901234567" }).fallbackContactUrl).toBe("tel:+84901234567");
    expect(parseConfig("dev", { ...base, ZALO_ASSISTANT_URL: ASSISTANT }).zaloAssistantUrl).toBe(ASSISTANT);
    for (const bad of ["http://example.com", "javascript:alert(1)", "zalo.me/123"]) expect(() => parseConfig("dev", { ...base, FALLBACK_CONTACT_URL: bad })).toThrow(ConfigError);
    for (const bad of ["https://evil.example/zalo.me/1", "http://zalo.me/123", "https://zalo.me/"]) expect(() => parseConfig("dev", { ...base, ZALO_ASSISTANT_URL: bad })).toThrow(ConfigError);
  });
});

describe("Story 7.1: the built website is served by the public listener beside the server pages", () => {
  const site = () => staticBuildRoutes({ kind: "site", root: fakeBuild(), pagePaths: Object.values(CUSTOMER_PATHS), otherHosts: [ADMIN_HOST] });

  it("answers each website page with the page and 200, any other page with the page and 404, never cached, with the CSP", async () => {
    const app = publicApp([site()]);
    for (const path of [...Object.values(CUSTOMER_PATHS), "/tien-cua-toi/", "/dang-nhap?redirect=%2Ftien-cua-toi"]) {
      const res = await app.inject({ method: "GET", url: path });
      expect([path, res.statusCode]).toEqual([path, 200]);
      expect(res.body).toBe(INDEX);
      expect(res.headers["content-type"]).toBe("text/html; charset=utf-8");
      expect(res.headers["cache-control"]).toBe("no-cache");
      expect(res.headers["content-security-policy"]).toBe(SITE_CSP);
    }
    const missing = await app.inject({ method: "GET", url: "/khong-co-trang-nay" });
    expect([missing.statusCode, missing.body]).toEqual([404, INDEX]);
  });

  it("review item 6: /index.html is the website's page, never a JSON 404", async () => {
    const res = await publicApp([site()]).inject({ method: "GET", url: "/index.html" });
    expect([res.statusCode, res.body, res.headers["cache-control"]]).toEqual([200, INDEX, "no-cache"]);
  });

  it("serves hashed files for a year and other files for an hour; a missing file or a path outside the build is a 404", async () => {
    const app = publicApp([site()]);
    const script = await app.inject({ method: "GET", url: "/assets/index-abc123.js" });
    expect([script.statusCode, script.headers["content-type"], script.headers["cache-control"]]).toEqual([200, "text/javascript; charset=utf-8", "public, max-age=31536000, immutable"]);
    const logo = await app.inject({ method: "GET", url: "/logo-mark-64.webp" });
    expect([logo.statusCode, logo.headers["content-type"], logo.headers["cache-control"]]).toEqual([200, "image/webp", "public, max-age=3600"]);
    for (const path of ["/assets/missing.js", "/../package.json", "/assets/..%2f..%2fpackage.json", "/%2e%2e/etc/passwd.txt"]) {
      const res = await app.inject({ method: "GET", url: path });
      expect([path, res.statusCode]).toEqual([path, 404]);
      expect(res.body).not.toContain("console.log");
    }
  });

  it("keeps /api, /internal and the admin host out of the website, and the receipt and share pages working beside it", async () => {
    const ledger = payoutLedger();
    const clock = movingClock(NOW);
    const app = publicApp([receiptPageRoutes({ ledger, clock }), sharePageRoutes({ ledger, clock, baseUrl: "https://hoantiendp.com", acceptFakeHost: false }), site()]);
    for (const path of ["/api/nothing", "/api", "/internal/ping"]) {
      const res = await app.inject({ method: "GET", url: path });
      expect([path, res.statusCode, res.json()]).toEqual([path, 404, { error: { code: "not_found", messageKey: "error.not_found" } }]);
    }
    expect((await app.inject({ method: "GET", url: "/", headers: { host: ADMIN_HOST } })).statusCode).toBe(404);
    const receipt = await app.inject({ method: "GET", url: "/b/unknown-token" });
    expect([receipt.statusCode, receipt.body === INDEX]).toEqual([404, false]);
    expect(receipt.body).toContain("<html");
    const share = await app.inject({ method: "GET", url: "/s/NOSUCHCODE" });
    expect([share.statusCode, share.body === INDEX]).toEqual([404, false]);
    expect((await app.inject({ method: "GET", url: "/api/health" })).statusCode).toBe(200);
  });
});

describe("Story 7.1 review: the admin desk's build on the admin host only", () => {
  it("serves the desk under /admin/ on the admin host with its own CSP, and neither host gets the other's files", async () => {
    const desk = adminBuildRoutes({ staffAccess: { adminHost: ADMIN_HOST, accessTeamDomain: "t.cloudflareaccess.com", accessAudience: "a".repeat(32) } }, { dist: fakeDeskBuild() });
    expect(desk).toHaveLength(1);
    const app = publicApp([staticBuildRoutes({ kind: "site", root: fakeBuild(), pagePaths: Object.values(CUSTOMER_PATHS), otherHosts: [ADMIN_HOST] }), ...desk]);
    const get = (url: string, host: string) => app.inject({ method: "GET", url, headers: { host } });
    for (const path of ["/admin", "/admin/", "/admin/payouts", "/admin/customers/DP00012"]) {
      const page = await get(path, ADMIN_HOST);
      expect([path, page.statusCode, page.body, page.headers["content-security-policy"]]).toEqual([path, 200, DESK_INDEX, DESK_CSP]);
    }
    expect((await get("/admin/assets/desk-def456.js", ADMIN_HOST)).body).toBe("console.log('desk')");
    expect((await get("/admin/assets/index-abc123.js", ADMIN_HOST)).statusCode).toBe(404);
    for (const path of ["/", "/assets/index-abc123.js", "/dang-nhap"]) expect([path, (await get(path, ADMIN_HOST)).statusCode]).toEqual([path, 404]);
    for (const path of ["/admin", "/admin/", "/admin/payouts", "/admin/assets/desk-def456.js"]) {
      const res = await get(path, "hoantiendp.com");
      expect([path, res.body.includes("desk")]).toEqual([path, false]);
    }
    expect((await get("/assets/index-abc123.js", "hoantiendp.com")).body).toBe("console.log('site')");
  });

  it("serves no desk without the staff access config or without a build", () => {
    expect(adminBuildRoutes({ staffAccess: null }, { dist: fakeDeskBuild() })).toEqual([]);
    expect(adminBuildRoutes({ staffAccess: { adminHost: ADMIN_HOST, accessTeamDomain: "t.cloudflareaccess.com", accessAudience: "a".repeat(32) } }, { dist: tempDir("cashback-no-admin-") })).toEqual([]);
  });
});

describe("Story 7.1 review item 5: the website's origins come from PUBLIC_BASE_URL, which production requires", () => {
  it("review item 5: allows the public origin and its www twin, and the website's dev server only in development", () => {
    expect(customerOrigins({ env: "prod", publicBaseUrl: "https://hoantiendp.com/", publicPort: 8080 })).toEqual(["https://hoantiendp.com", "https://www.hoantiendp.com"]);
    expect(customerOrigins({ env: "prod", publicBaseUrl: "https://www.hoantiendp.com", publicPort: 8080 })).toEqual(["https://www.hoantiendp.com", "https://hoantiendp.com"]);
    expect(customerOrigins({ env: "dev", publicBaseUrl: null, publicPort: 9080 })).toEqual(["http://localhost:5175", "http://127.0.0.1:5175", "http://127.0.0.1:9080", "http://localhost:9080"]);
  });

  it("review item 5: production without PUBLIC_BASE_URL is refused at startup, so its sign-in never answers every POST with 403", () => {
    const context = { identifiers: productionIdentifiers(REPOSITORY_ROOT, tempDir("cashback-home-")), prodEnv: null, devFileIsProdFile: false, caseInsensitive: process.platform === "win32" };
    const prod = (values: Record<string, string>) => isolationProblems(parseConfig("prod", { INTERNAL_TOKEN: "t".repeat(40), BRIDGE_TOKEN: "k".repeat(40), ...values }), context).map((p) => `${p.key} ${p.reason}`);
    expect(prod({})).toEqual(["PUBLIC_BASE_URL required"]);
    expect(prod({ PUBLIC_BASE_URL: "https://hoantiendp.com" })).toEqual([]);
  });
});
