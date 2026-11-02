// Story 7.1 AC3: how long Home takes to become interactive on a mid-range phone over 4G. Builds the
// website, serves dist/ from a local HTTP server (no CDN, no compression proxy: the files go out
// gzip-compressed as the Cloudflare edge sends them), and loads Home in Chromium as a mid-range
// phone (4x CPU slowdown) on two networks: Chrome DevTools' "Fast 4G" preset (165 ms round trip,
// 8.1 Mbit/s down, 1.35 Mbit/s up), the profile the 2-second budget is checked on, and, for
// reference, Lighthouse's "Slow 4G" (150 ms round trip, 1.6 Mbit/s down, 750 kbit/s up). /api answers come from fixtures; Google Fonts is blocked, so the system
// fallback stack renders (font-display: swap never blocks interaction anyway).
// "Interactive" is measured as a real interaction: the time from navigation start until a tap on
// the Guide tab has been dispatched to the page React rendered, with the time the tabs appeared,
// the time the Guide page (a lazily loaded chunk) showed, and the long tasks on the way. A Playwright trace is written next to the JSON result.
// Usage: node scripts/perf-trace.mjs <output folder> [runs per profile]
import { createServer } from "node:http";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

import { chromium } from "@playwright/test";
import { build } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const out = process.argv[2];
const runs = Number(process.argv[3] ?? 5);
if (!out) {
  console.error("usage: node scripts/perf-trace.mjs <output folder> [runs]");
  process.exit(2);
}
mkdirSync(out, { recursive: true });

const dist = join(root, "dist");
await build({ root, configFile: join(root, "vite.config.ts"), logLevel: "silent" });

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".webp": "image/webp", ".ico": "image/x-icon" };
const server = createServer((req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^([/\\])+/, "");
  let file = join(dist, path);
  try {
    if (!statSync(file).isFile()) throw new Error("dir");
  } catch {
    file = join(dist, "index.html");
  }
  const body = readFileSync(file);
  const type = TYPES[extname(file)] ?? "application/octet-stream";
  const zip = /text|javascript/.test(type);
  res.writeHead(200, { "content-type": type, ...(zip ? { "content-encoding": "gzip" } : {}), "cache-control": "no-store" });
  res.end(zip ? gzipSync(body) : body);
});
await new Promise((resolve) => server.listen(5176, "127.0.0.1", resolve));

const PROFILES = {
  "fast-4g": { latency: 165, downloadThroughput: (8.1 * 1024 * 1024) / 8, uploadThroughput: (1.35 * 1024 * 1024) / 8 },
  "slow-4g": { latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 },
};
const browser = await chromium.launch();

async function measure(profile, run) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const trace = run === 0;
  if (trace) await context.tracing.start({ screenshots: true, snapshots: false });
  const page = await context.newPage();
  await page.route("https://fonts.googleapis.com/**", (route) => route.abort());
  await page.route("**/api/site-status", (route) => route.fulfill({ json: { assistant: "up", fallbackContactUrl: null } }));
  await page.route("**/api/session", (route) => route.fulfill({ status: 401, json: { error: { code: "unauthorized", messageKey: "error.unauthorized" } } }));
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  await cdp.send("Network.emulateNetworkConditions", { offline: false, ...PROFILES[profile] });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await page.addInitScript(() => {
    window.__longTasks = [];
    new PerformanceObserver((list) => window.__longTasks.push(...list.getEntries().map((e) => [Math.round(e.startTime), Math.round(e.duration)]))).observe({ type: "longtask", buffered: true });
    // The moment React has put the real tabs on the page (the skeleton has none).
    new MutationObserver((_, observer) => {
      if (document.querySelector("[data-bottom-tabs] a") === null) return;
      window.__tabsAt = performance.now();
      observer.disconnect();
    }).observe(document, { childList: true, subtree: true });
  });
  await page.goto("http://127.0.0.1:5176/", { waitUntil: "commit" });
  // A real tap: Playwright waits until the Guide tab is visible, stable and receives the event.
  await page.locator("[data-bottom-tabs] a").nth(2).click();
  const tapHandledMs = Math.round(await page.evaluate(() => performance.now()));
  await page.waitForURL("**/huong-dan");
  await page.locator("main h1").waitFor();
  const metrics = await page.evaluate((tap) => {
    const nav = performance.getEntriesByType("navigation")[0];
    const fcp = performance.getEntriesByName("first-contentful-paint")[0];
    return { interactiveMs: tap, tabsRenderedMs: Math.round(window.__tabsAt ?? -1), guideShownMs: Math.round(performance.now()), fcpMs: fcp ? Math.round(fcp.startTime) : null, domContentLoadedMs: Math.round(nav.domContentLoadedEventEnd), longTasks: window.__longTasks };
  }, tapHandledMs);
  if (trace) await context.tracing.stop({ path: join(out, `home-${profile}-trace.zip`) });
  await context.close();
  return metrics;
}

const report = {};
for (const profile of Object.keys(PROFILES)) {
  const results = [];
  for (let run = 0; run < runs; run++) results.push(await measure(profile, run));
  const sorted = results.map((r) => r.interactiveMs).sort((a, b) => a - b);
  report[profile] = { network: PROFILES[profile], medianInteractiveMs: sorted[Math.floor(sorted.length / 2)], interactiveMs: sorted, runs: results };
}
await browser.close();
server.close();

const median = report["fast-4g"].medianInteractiveMs;
const assets = Object.fromEntries(["js", "css"].map((kind) => [kind, readFileSync(join(dist, "index.html"), "utf8").match(new RegExp(`/assets/[^"]+\\.${kind}`, "g")).map((p) => ({ path: p, gzipBytes: gzipSync(readFileSync(join(dist, p))).length }))]));
const summary = { cpu: "4x slowdown", viewport: "390x844 @3x", budgetMs: 2000, budgetProfile: "fast-4g", profiles: report, assets };
writeFileSync(join(out, "home-4g.json"), `${JSON.stringify(summary, null, 2)}
`);
console.log(JSON.stringify(Object.fromEntries(Object.entries(report).map(([k, v]) => [k, v.interactiveMs])), null, 2));
console.log(JSON.stringify(assets));
process.exit(median <= 2000 ? 0 : 1);
