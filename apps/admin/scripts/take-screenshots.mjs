// Screenshots of the admin desk shell and the Orders DataList at phone, tablet and desktop
// widths, for the design review. Starts the Vite dev server, answers /api/admin from fixtures
// in the browser (the real staff routes need a Cloudflare Access JWT), and checks every page for
// sideways scrolling. Usage: node scripts/take-screenshots.mjs <output folder>
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const out = process.argv[2];
if (!out) {
  console.error("usage: node scripts/take-screenshots.mjs <output folder>");
  process.exit(2);
}
mkdirSync(out, { recursive: true });

const fixtures = JSON.parse(readFileSync(join(root, "tests/fixtures/orders.json"), "utf8"));
// Sample product photos from the wireframe folder, served in place of the network's image CDN.
const PHOTOS = ["deal_home_1.jpg", "deal_tech_2.jpg", "deal_beauty_3.jpg", "deal_home_4.jpg", "deal_tech_1.jpg"];
const photoDir = join(root, "../../docs/design/wireframe/images");
const STATUSES = ["APPROVED", "AWAITING_APPROVAL", "PAID", "APPROVED", "REJECTED", "FROZEN", "AWAITING_APPROVAL", "PAID"];
const AMOUNTS = [9263, null, 12640, 3120, null, 41580, null, 79216];

function orders(url) {
  const status = url.searchParams.get("filter[status]")?.split(",") ?? [];
  const all = Array.from({ length: 23 }, (_, i) => ({
    orderId: `26103${String(5000123 + i * 7919)}`,
    customerCode: `DP${String(12 + i * 3).padStart(5, "0")}`,
    customerName: fixtures.customerNames[i % fixtures.customerNames.length],
    productName: fixtures.products[i % fixtures.products.length],
    productImageUrl: i % 5 === 4 ? null : `https://cf.example.test/file/${PHOTOS[i % PHOTOS.length]}`,
    network: i % 4 === 3 ? "TikTok Shop" : "Shopee",
    status: STATUSES[i % STATUSES.length],
    cashback: AMOUNTS[i % AMOUNTS.length],
    recordedAt: `2026-10-${String(30 - (i % 9)).padStart(2, "0")}T0${i % 9}:15:00.000Z`,
  }));
  const rows = status.length === 0 ? all : all.filter((r) => status.includes(r.status));
  const facets = { status: ["AWAITING_APPROVAL", "FROZEN", "APPROVED", "REVERSED", "PAID", "REJECTED"].map((value) => ({ value, count: rows.filter((r) => r.status === value).length })) };
  const summary = { cashback: rows.reduce((sum, r) => sum + (r.cashback ?? 0), 0) };
  return { rows: rows.slice(0, 25), total: rows.length + 1261, page: 1, pageSize: 25, facets, summary, asOf: "2026-10-30T12:42:00.000Z" };
}

const server = await createServer({ root, configFile: join(root, "vite.config.ts"), server: { port: 5174, strictPort: true }, logLevel: "error" });
await server.listen();
const browser = await chromium.launch();
const problems = [];

async function shoot(name, width, height, path, after) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1, hasTouch: width < 1280, isMobile: width < 768 });
  await page.route("https://cf.example.test/file/*", (route) => route.fulfill({ contentType: "image/jpeg", body: readFileSync(join(photoDir, new URL(route.request().url()).pathname.split("/").pop())) }));
  await page.route("**/api/admin/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/admin/session") return route.fulfill({ json: { staffId: "stf_1", username: "minh", role: "ADMIN" } });
    if (url.pathname === "/api/admin/orders") return route.fulfill({ json: orders(url) });
    return route.fulfill({ status: 404, json: { error: { code: "not_found", messageKey: "error.not_found" } } });
  });
  await page.goto(`http://localhost:5174${path}`);
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.fonts.ready);
  // Lazy images load only near the viewport: scroll through once so the full-page shot has them.
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 400) {
      window.scrollTo(0, y);
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
    window.scrollTo(0, 0);
  });
  await page.waitForLoadState("networkidle");
  if (after) await after(page);
  await page.waitForTimeout(300);
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    const wide = [...document.querySelectorAll("body *")].filter((el) => el.getBoundingClientRect().right > window.innerWidth + 1 && getComputedStyle(el).position !== "fixed");
    const small = [...document.querySelectorAll("body *")].filter((el) => el.childNodes.length > 0 && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim() !== "") && parseFloat(getComputedStyle(el).fontSize) < 12);
    return { sideways: doc.scrollWidth > window.innerWidth, wide: wide.slice(0, 5).map((el) => el.outerHTML.slice(0, 120)), small: small.slice(0, 5).map((el) => el.outerHTML.slice(0, 120)) };
  });
  if (overflow.sideways || overflow.wide.length > 0 || overflow.small.length > 0) problems.push({ name, ...overflow });
  const file = join(out, `${name}.png`);
  await page.screenshot({ path: file, fullPage: !name.endsWith("-sheet") });
  console.log(file);
  await page.close();
}

const WIDTHS = [
  ["phone-390", 390, 844],
  ["tablet-768", 768, 1024],
  ["desktop-1440", 1440, 960],
];
for (const [label, width, height] of WIDTHS) {
  await shoot(`shell-${label}`, width, height, "/admin/");
  await shoot(`orders-${label}`, width, height, "/admin/orders?filter[status]=APPROVED,PAID");
}
await shoot("orders-phone-390-filter-sheet", 390, 844, "/admin/orders", (page) => page.getByRole("button", { name: /^B/ }).first().click());
await shoot("shell-phone-390-more-sheet", 390, 844, "/admin/", (page) => page.locator("nav button").last().click());
await shoot("orders-desktop-1440-error", 1440, 960, "/admin/orders?q=x", (page) => page.route("**/api/admin/orders**", (route) => route.fulfill({ status: 500, json: { error: { code: "internal", messageKey: "error.internal" } } })).then(() => page.reload()).then(() => page.getByRole("alert").waitFor({ timeout: 10_000 })));

await browser.close();
await server.close();
if (problems.length > 0) {
  console.error(JSON.stringify(problems, null, 2));
  process.exit(1);
}
console.log("no sideways scroll, nothing past the viewport, no text under 12 px");
