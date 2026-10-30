// Screenshots of the admin desk shell, the Orders DataList, the Payouts list and the payout panel (with its confirm step,
// the amount-changed and recorded states, and the netting-only variant) at phone, tablet and desktop
// widths, for the design review. Starts the Vite dev server, answers /api/admin from fixtures
// in the browser (the real staff routes need a Cloudflare Access JWT), and checks every page for
// sideways scrolling. The proof upload and the void dialog (Stories 4.9 and 4.10) are shot too.
// Usage: node scripts/take-screenshots.mjs <output folder> [name prefix, to shoot only those]
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const out = process.argv[2];
const only = process.argv[3];
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

const payoutFixtures = JSON.parse(readFileSync(join(root, "tests/fixtures/payouts.json"), "utf8"));
const PAYABLE = [135216, 24860, 9263, 31008, 0, 58400];
const SETTLED = [["PARTLY_SETTLED", 1, 3], ["SETTLED", 2, 2], ["UNSETTLED", 0, 1], ["SETTLED", 3, 3], ["UNSETTLED", 0, 1], ["PARTLY_SETTLED", 2, 4]];

function payoutRows(url) {
  const action = url.searchParams.get("filter[queue]") === "ACTION";
  const rows = payoutFixtures.names.map((name, i) => ({ name, i })).filter(({ i }) => action || i !== 4).map(({ name, i }) => {
    const [settlement, settledCount, orderCount] = SETTLED[i];
    const flags = action ? ["NO_BANK", "BANK_HELD", "BANK_CHANGED,SHARED_BANK", "SHARED_BANK", "NETTING_ONLY", "NO_BANK"][i] : "";
    const noBank = flags.includes("NO_BANK");
    return {
      customerId: `P${i}`, customerCode: `DP${String(12 + i * 19).padStart(5, "0")}`, customerName: name,
      bankName: noBank ? null : payoutFixtures.banks[i], accountLastFour: noBank ? null : String(6789 - i * 1201).padStart(4, "0"),
      orderCount, settledCount, settlement, flags, bankChangedAt: flags.includes("BANK_CHANGED") ? "2026-10-29T05:10:00.000Z" : null,
      payable: action && i === 4 ? 0 : PAYABLE[i], queue: action ? "ACTION" : "PAYABLE",
      claimStaffId: !action && i === 2 ? "stf_2" : null, claimStaffName: !action && i === 2 ? "tuan" : null,
    };
  });
  return { rows, total: rows.length, page: 1, pageSize: 25, facets: {}, summary: { payable: rows.reduce((sum, r) => sum + r.payable, 0) }, asOf: "2026-10-30T12:42:00.000Z", queues: { payable: 5, action: 6 } };
}

const PREVIEW = {
  outcome: "claimed", claimId: "K7Q2M9XA", transferReference: "DP00012 K7Q2M9XA", openedAt: "2026-10-30T12:42:00.000Z",
  customerId: "P0", customerCode: "DP00012", customerName: payoutFixtures.names[0], amount: 135216, gross: 135216, deductedNext: 0,
  bankName: "Vietcombank", holderName: payoutFixtures.holder, accountLastFour: "3456", qrPayload: payoutFixtures.qrPayload, qrMissing: null,
  flags: ["BANK_CHANGED"],
  orders: [
    { orderId: "261001A0001", productName: payoutFixtures.products[0], productImageUrl: "https://cf.example.test/file/deal_home_1.jpg", cashback: 79216, settled: true },
    { orderId: "261001A0002", productName: payoutFixtures.products[2], productImageUrl: "https://cf.example.test/file/deal_home_4.jpg", cashback: 36000, settled: false },
  ],
  bonuses: [{ awardId: 1, orderId: "261001A0001", campaignName: payoutFixtures.campaign, amount: 20000 }],
  clawbacks: [], refunds: [],
  warning: { amount: 79216, at: "2026-10-30T12:21:00.000Z" },
  snapshotHash: "a".repeat(64), netted: 0, carriedForward: 0,
};
const CHANGED = { ...PREVIEW, claimId: "N3WCLA1M", snapshotHash: "c".repeat(64), amount: 144479, gross: 144479, warning: null,
  orders: [...PREVIEW.orders, { orderId: "261001A0003", productName: payoutFixtures.products[1], productImageUrl: "https://cf.example.test/file/deal_tech_2.jpg", cashback: 9263, settled: false }] };
const NETTING = { ...PREVIEW, claimId: "N3TT1NG0", snapshotHash: "b".repeat(64), transferReference: "DP00088 N3TT1NG0", customerId: "P4", customerCode: "DP00088", customerName: payoutFixtures.names[4],
  amount: 0, gross: 50000, deductedNext: 80000, netted: 50000, carriedForward: 30000, qrPayload: null, qrMissing: "netting_only", flags: ["NETTING_ONLY"], warning: null,
  orders: [{ orderId: "261002N0001", productName: payoutFixtures.products[1], productImageUrl: "https://cf.example.test/file/deal_tech_2.jpg", cashback: 30000, settled: false }],
  bonuses: [{ awardId: 2, orderId: "261002N0001", campaignName: payoutFixtures.campaign, amount: 20000 }],
  clawbacks: [{ clawbackId: "260901PAID07-1", orderId: "260901PAID07", open: 80000 }] };
const RECORDED = { outcome: "recorded", payoutId: 41, claimId: "K7Q2M9XA", customerId: "P0", amount: 135216, netted: 0, nettingOnly: false, orderCount: 2, awardCount: 1, receiptToken: "rcpt_test_token_0001", recordedAt: "2026-10-30T12:45:00.000Z", replay: false };
const NETTING_RECORDED = { ...RECORDED, claimId: "N3TT1NG0", customerId: "P4", amount: 0, netted: 50000, nettingOnly: true, orderCount: 1, receiptToken: null };
const PROOF_PHOTO = join(photoDir, "deal_tech_1.jpg");
const PROOF_SAVED = { payoutId: 41, byteSize: 48213, width: 800, height: 800, uploadedAt: "2026-10-30T12:45:02.000Z", replaced: false };
const VOID_PREVIEW = {
  payoutId: 41, customerId: "P0", customerCode: "DP00012", amount: 135216, status: "RECORDED", recordedAt: "2026-10-30T12:45:00.000Z", voidedAt: null,
  orders: [{ orderId: "261001A0001", cashback: 79216, to: "REVERSED" }, { orderId: "261001A0002", cashback: 36000, to: "APPROVED" }],
  awards: [{ awardId: 1, orderId: "261001A0001", amount: 20000, to: "VOID" }], nettingReversed: 0, clawbacksClosed: 99216, refunded: 0, told: true,
};
const VOIDED = { payoutId: 41, customerId: "P0", amount: 135216, voidedAt: "2026-10-30T12:50:00.000Z", orders: [{ orderId: "261001A0001", to: "REVERSED" }, { orderId: "261001A0002", to: "APPROVED" }], offsets: 1, corrected: true, replay: false };

const server = await createServer({ root, configFile: join(root, "vite.config.ts"), server: { port: 5174, strictPort: true }, logLevel: "error" });
await server.listen();
const browser = await chromium.launch();
const problems = [];

async function shoot(name, width, height, path, after, answers = {}) {
  if (only !== undefined && !name.startsWith(only)) return;
  let claims = 0;
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1, hasTouch: width < 1280, isMobile: width < 768 });
  await page.route("https://cf.example.test/file/*", (route) => route.fulfill({ contentType: "image/jpeg", body: readFileSync(join(photoDir, new URL(route.request().url()).pathname.split("/").pop())) }));
  await page.route("**/api/admin/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/admin/session") return route.fulfill({ json: { staffId: "stf_1", username: "minh", role: "ADMIN" } });
    if (url.pathname === "/api/admin/orders") return route.fulfill({ json: orders(url) });
    if (url.pathname === "/api/admin/payouts") return route.fulfill({ json: payoutRows(url) });
    if (url.pathname.endsWith("/claim")) return route.fulfill({ json: (answers.claim ?? (() => PREVIEW))(++claims) });
    if (url.pathname.endsWith("/confirm")) {
      const answer = (answers.confirm ?? (() => ({ json: RECORDED })))();
      return route.fulfill(answer);
    }
    if (url.pathname.endsWith("/release")) return route.fulfill({ json: { claimId: "K7Q2M9XA", status: "ABANDONED" } });
    if (url.pathname.endsWith("/proof")) return route.request().method() === "POST" ? route.fulfill({ json: PROOF_SAVED }) : route.fulfill({ contentType: "image/jpeg", body: readFileSync(PROOF_PHOTO) });
    if (url.pathname.endsWith("/void")) return route.fulfill({ json: route.request().method() === "POST" ? VOIDED : VOID_PREVIEW });
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
  await shoot(`payouts-${label}`, width, height, "/admin/payouts");
  await shoot(`payouts-action-${label}`, width, height, "/admin/payouts?filter[queue]=ACTION");
  await shoot(`payout-panel-${label}-sheet`, width, height, "/admin/payouts", (page) => page.getByRole("button", { name: /^Chuy/ }).first().click().then(() => page.getByRole("img").last().waitFor({ timeout: 10_000 })));
}
const openPanel = (page, name = /^Chuy/) => page.getByRole("button", { name }).first().click().then(() => page.getByRole("dialog").waitFor({ timeout: 10_000 }));
const toConfirm = (page) => page.locator("[data-confirm] button").waitFor({ timeout: 10_000 }).then(() => page.locator("[data-slot=sheet-content]").evaluate((el) => el.scrollTo(0, el.scrollHeight)));
const press = (page) => page.locator("[data-confirm] button").click();
const NETTING_ROW = /^Tr/;
for (const [label, width, height] of WIDTHS) {
  await shoot(`payout-confirm-${label}-sheet`, width, height, "/admin/payouts", (page) => openPanel(page).then(() => page.getByRole("img").last().waitFor({ timeout: 10_000 })).then(() => toConfirm(page)));
  await shoot(`payout-changed-${label}-sheet`, width, height, "/admin/payouts", (page) => openPanel(page).then(() => toConfirm(page)).then(() => press(page)).then(() => page.locator("[data-changed]").waitFor({ timeout: 10_000 })),
    { claim: (n) => (n === 1 ? PREVIEW : CHANGED), confirm: () => ({ status: 409, json: { error: { code: "conflict", messageKey: "error.payout.amount_changed" } } }) });
  await shoot(`payout-recorded-${label}-sheet`, width, height, "/admin/payouts", (page) => openPanel(page).then(() => toConfirm(page)).then(() => press(page)).then(() => page.locator("[data-recorded]").waitFor({ timeout: 10_000 })));
  await shoot(`payout-netting-${label}-sheet`, width, height, "/admin/payouts?filter[queue]=ACTION", (page) => openPanel(page, NETTING_ROW).then(() => page.locator("[data-facts=netting]").waitFor({ timeout: 10_000 })), { claim: () => NETTING });
  await shoot(`payout-netting-recorded-${label}-sheet`, width, height, "/admin/payouts?filter[queue]=ACTION", (page) => openPanel(page, NETTING_ROW).then(() => toConfirm(page)).then(() => press(page)).then(() => page.locator("[data-recorded]").waitFor({ timeout: 10_000 })),
    { claim: () => NETTING, confirm: () => ({ json: NETTING_RECORDED }) });
}
const chooseProof = (page) => page.locator("[data-proof] input[type=file]").setInputFiles(PROOF_PHOTO).then(() => page.locator("[data-proof] img").waitFor({ timeout: 10_000 }));
const openVoid = (page) => page.getByRole("button", { name: /^Hu/ }).click().then(() => page.locator("[data-void-lines]").waitFor({ timeout: 10_000 }));
for (const [label, width, height] of WIDTHS) {
  await shoot(`payout-proof-${label}-sheet`, width, height, "/admin/payouts", (page) => openPanel(page).then(() => chooseProof(page)).then(() => toConfirm(page)));
  await shoot(`payout-proof-saved-${label}-sheet`, width, height, "/admin/payouts", (page) =>
    openPanel(page).then(() => chooseProof(page)).then(() => toConfirm(page)).then(() => press(page)).then(() => page.locator("[data-proof-state=saved] img").waitFor({ timeout: 10_000 })));
  await shoot(`payout-void-${label}-sheet`, width, height, "/admin/payouts", (page) =>
    openPanel(page).then(() => toConfirm(page)).then(() => press(page)).then(() => openVoid(page)).then(() => page.getByRole("alertdialog").locator("textarea").fill("Ghi nh\u1ea7m kh\u00e1ch, ch\u01b0a chuy\u1ec3n kho\u1ea3n")));
  await shoot(`payout-voided-${label}-sheet`, width, height, "/admin/payouts", (page) =>
    openPanel(page).then(() => toConfirm(page)).then(() => press(page)).then(() => openVoid(page)).then(() => page.getByRole("alertdialog").locator("textarea").fill("Ghi nh\u1ea7m kh\u00e1ch")).then(() => page.getByRole("alertdialog").getByRole("button", { name: /^Hu/ }).click()).then(() => page.locator("[data-voided]").waitFor({ timeout: 10_000 })));
}
await shoot("payout-panel-phone-390-scrolled-sheet", 390, 844, "/admin/payouts", (page) =>
  page.getByRole("button", { name: /^Chuy/ }).first().click().then(() => page.getByRole("img").last().waitFor({ timeout: 10_000 })).then(() => page.locator("[data-slot=sheet-content]").evaluate((el) => el.scrollTo(0, el.scrollHeight))));
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
