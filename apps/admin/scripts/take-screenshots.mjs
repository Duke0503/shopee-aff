// Screenshots of the admin desk shell, the Orders DataList, the Payouts list and the payout panel (with its confirm step,
// the amount-changed and recorded states, and the netting-only variant), the payout history with its void dialog,
// the network payouts tab with one payout's orders, and Settings with the withheld periods, at phone, tablet and desktop
// widths, for the design review. Starts the Vite dev server, answers /api/admin from fixtures
// in the browser (the real staff routes need a Cloudflare Access JWT), and checks every page for
// sideways scrolling. The proof upload and the void dialog (Stories 4.9 and 4.10) are shot too, and
// Customers with one customer's page and the review queue with a case's panel (Stories 4.14, 4.15).
// The Overview at every period preset, the erase flow on a customer's page and the erased page (Stories 4.16, 4.17)
// are shot too; every grid row of the Overview is checked for cards of equal height.
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
    network: i % 4 === 3 ? "accesstrade" : "shopee",
    status: STATUSES[i % STATUSES.length],
    orderValue: 159000 + i * 21000,
    approvedCommission: AMOUNTS[i % AMOUNTS.length] === null ? null : Math.floor((AMOUNTS[i % AMOUNTS.length] * 5) / 4),
    cashback: AMOUNTS[i % AMOUNTS.length],
    recordedAt: i === 22 ? "2025-12-28T03:15:00.000Z" : `2026-10-${String(30 - (i % 9)).padStart(2, "0")}T0${i % 9}:15:00.000Z`,
    approvedAt: AMOUNTS[i % AMOUNTS.length] === null ? null : "2026-10-29T03:00:00.000Z",
    paidAt: STATUSES[i % STATUSES.length] === "PAID" ? "2026-10-30T05:00:00.000Z" : null,
    settledBy: i % 3 === 0 ? "1034567" : null,
  }));
  const rows = status.length === 0 ? all : all.filter((r) => status.includes(r.status));
  const facets = { status: ["AWAITING_APPROVAL", "FROZEN", "APPROVED", "REVERSED", "PAID", "REJECTED"].map((value) => ({ value, count: rows.filter((r) => r.status === value).length })) };
  const summary = { approvedCommission: rows.reduce((sum, r) => sum + (r.approvedCommission ?? 0), 0), cashback: rows.reduce((sum, r) => sum + (r.cashback ?? 0), 0) };
  return { rows: rows.slice(0, 25), total: rows.length + 1261, page: 1, pageSize: 25, facets, summary, asOf: "2026-10-30T12:42:00.000Z", overall: 4912 };
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
    { orderId: "261001A0001", productName: payoutFixtures.products[0], productImageUrl: "https://cf.example.test/file/deal_home_1.jpg", cashback: 79216, settled: true, settledBy: "1034567" },
    { orderId: "261001A0002", productName: payoutFixtures.products[2], productImageUrl: "https://cf.example.test/file/deal_home_4.jpg", cashback: 36000, settled: false, settledBy: null },
  ],
  bonuses: [{ awardId: 1, orderId: "261001A0001", campaignName: payoutFixtures.campaign, amount: 20000 }],
  clawbacks: [], refunds: [],
  warning: { amount: 79216, at: "2026-10-30T12:21:00.000Z" },
  snapshotHash: "a".repeat(64), netted: 0, carriedForward: 0,
};
const CHANGED = { ...PREVIEW, claimId: "N3WCLA1M", snapshotHash: "c".repeat(64), amount: 144479, gross: 144479, warning: null,
  orders: [...PREVIEW.orders, { orderId: "261001A0003", productName: payoutFixtures.products[1], productImageUrl: "https://cf.example.test/file/deal_tech_2.jpg", cashback: 9263, settled: false, settledBy: null }] };
const NETTING = { ...PREVIEW, claimId: "N3TT1NG0", snapshotHash: "b".repeat(64), transferReference: "DP00088 N3TT1NG0", customerId: "P4", customerCode: "DP00088", customerName: payoutFixtures.names[4],
  amount: 0, gross: 50000, deductedNext: 80000, netted: 50000, carriedForward: 30000, qrPayload: null, qrMissing: "netting_only", flags: ["NETTING_ONLY"], warning: null,
  orders: [{ orderId: "261002N0001", productName: payoutFixtures.products[1], productImageUrl: "https://cf.example.test/file/deal_tech_2.jpg", cashback: 30000, settled: false, settledBy: null }],
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

const HISTORY_AMOUNTS = [135216, 24860, 9263, 0, 58400, 31008];
function historyRows() {
  const rows = payoutFixtures.names.map((name, i) => ({
    payoutId: 41 + i, customerId: `P${i}`, customerCode: `DP${String(12 + i * 19).padStart(5, "0")}`, customerName: name,
    amount: HISTORY_AMOUNTS[i], paidAmount: i === 1 ? 0 : HISTORY_AMOUNTS[i], status: i === 1 ? "VOIDED" : "RECORDED",
    recordedAt: i === 5 ? "2025-12-30T04:10:00.000Z" : `2026-10-${String(30 - i * 3).padStart(2, "0")}T05:45:00.000Z`, recordedBy: i % 2 === 0 ? "minh" : "tuan",
    voidedAt: i === 1 ? "2026-10-28T09:00:00.000Z" : null, receiptToken: HISTORY_AMOUNTS[i] === 0 ? null : `rcpt_${i}`,
  }));
  return { rows, total: 150, page: 1, pageSize: 25, facets: { status: [{ value: "RECORDED", count: 149 }, { value: "VOIDED", count: 1 }] }, summary: { paidAmount: 12345678 }, asOf: "2026-10-30T12:42:00.000Z" };
}
const NETWORK_ROWS = [
  { settlementId: 11, network: "shopee", networkPayoutId: "1034567", status: "PROCESSING", match: "PENDING", amount: 54073, eligibleAmount: 60743, withheld: true, fee: 596, tax: 6074, matchedGross: null, unattributed: null, orderCount: 0, createdAt: "2026-10-29T03:00:00.000Z", paidAt: null },
  { settlementId: 10, network: "shopee", networkPayoutId: "1033120", status: "PAID", match: "MISMATCH", amount: 89020, eligibleAmount: 100000, withheld: true, fee: 980, tax: 10000, matchedGross: 106000, unattributed: -6000, orderCount: 4, createdAt: "2026-10-26T03:00:00.000Z", paidAt: "2026-10-28T03:00:00.000Z" },
  { settlementId: 9, network: "shopee", networkPayoutId: "1031877", status: "PAID", match: "MATCHED", amount: 386938, eligibleAmount: 434665, withheld: true, fee: 4260, tax: 43467, matchedGross: 411665, unattributed: 23000, orderCount: 12, createdAt: "2026-10-22T03:00:00.000Z", paidAt: "2026-10-24T03:00:00.000Z" },
  { settlementId: 1, network: "shopee", networkPayoutId: "1020455", status: "PAID", match: "HISTORIC", amount: 166698, eligibleAmount: 168347, withheld: false, fee: 1649, tax: 0, matchedGross: null, unattributed: null, orderCount: 0, createdAt: "2026-09-24T03:00:00.000Z", paidAt: "2026-09-26T03:00:00.000Z" },
];
const networkRows = () => ({ rows: NETWORK_ROWS, total: NETWORK_ROWS.length, page: 1, pageSize: 25, facets: {}, summary: { amount: 696729, eligibleAmount: 763755, matchedGross: 669012, fee: 7485, tax: 59541 }, asOf: "2026-10-30T12:42:00.000Z" });
const NETWORK_DETAIL = {
  ...NETWORK_ROWS[2], listed: false, windowFrom: "2026-10-19T03:00:00.000Z", openCaseIds: [],
  orders: [
    { orderId: "251019ZT45LB", outcome: "SETTLED", gross: 371665, net: 330856, customerCode: "DP00012", customerName: payoutFixtures.names[0], productName: payoutFixtures.products[0], productImageUrl: "https://cf.example.test/file/deal_home_1.jpg", status: "PAID", settledBy: "1031877" },
    { orderId: "251020M8RR0Q", outcome: "SETTLED", gross: 25000, net: 22255, customerCode: "DP00031", customerName: payoutFixtures.names[1], productName: payoutFixtures.products[1], productImageUrl: "https://cf.example.test/file/deal_tech_2.jpg", status: "APPROVED", settledBy: "1031877" },
    { orderId: "251021C4DD9E", outcome: "SETTLED", gross: 15000, net: 13353, customerCode: "DP00050", customerName: payoutFixtures.names[2], productName: null, productImageUrl: null, status: "APPROVED", settledBy: "1031877" },
  ],
};
const PERIODS = { currentMonth: "2026-10", periods: [
  { network: "shopee", periodMonth: "2026-10", withheld: true, editable: true, origin: "NETWORK", basedOn: "1034567" },
  { network: "shopee", periodMonth: "2026-09", withheld: false, editable: true, origin: "STAFF", basedOn: null },
  { network: "shopee", periodMonth: "2026-08", withheld: true, editable: true, origin: "CUTOVER", basedOn: null },
  { network: "accesstrade", periodMonth: "2026-10", withheld: true, editable: false, origin: "DEFAULT", basedOn: null },
  { network: "accesstrade", periodMonth: "2026-09", withheld: true, editable: false, origin: "CUTOVER", basedOn: null },
] };

const CUSTOMER_FLAGS = ["", "BANK_CHANGED", "NO_BANK", "SHARED_BANK", "", "BANK_HELD"];
function customerRows() {
  const rows = payoutFixtures.names.map((name, i) => {
    const flags = CUSTOMER_FLAGS[i];
    const noBank = flags === "NO_BANK";
    return {
      customerId: `P${i}`, customerCode: `DP${String(12 + i * 19).padStart(5, "0")}`, customerName: name,
      bankName: noBank ? null : payoutFixtures.banks[i], accountLastFour: noBank ? null : String(6789 - i * 1201).padStart(4, "0"),
      orderCount: [18, 7, 3, 1, 26, 4][i], payable: [79216, 24860, 9263, 0, 135216, 31008][i], paid: [212400, 61300, 0, 0, 1204500, 58000][i],
      flags, bankChangedAt: flags === "BANK_CHANGED" ? "2026-10-29T05:10:00.000Z" : null,
      owed: i === 3 ? "NO" : "YES", flagged: flags === "" ? "NO" : "YES", bank: noBank ? "NONE" : flags === "BANK_HELD" ? "HELD" : "SAVED",
    };
  });
  const facets = { owed: [{ value: "NO", count: 45 }, { value: "YES", count: 12 }], flagged: [{ value: "NO", count: 53 }, { value: "YES", count: 4 }], bank: [] };
  return { rows, total: 57, page: 1, pageSize: 25, facets, summary: { payable: 279563, paid: 1536200 }, asOf: "2026-10-30T12:42:00.000Z", overall: 57 };
}
const CUSTOMER_PAGE = {
  customerId: "P0", customerCode: "DP00012", customerName: payoutFixtures.names[0], status: "ACTIVE", zaloUserId: "8812447100930012", joinedAt: "2026-09-12T03:00:00.000Z", erasedAt: null,
  balance: { payable: 79216, gross: 88479, waiting: 15880, paid: 212400, deductedNext: 9263 },
  flags: ["BANK_CHANGED"],
  bank: { bankName: "Vietcombank", holderName: payoutFixtures.holder, lastFour: "6789", changedAt: "2026-10-29T05:10:00.000Z", held: false, changedRecently: true },
  clawbacks: [{ clawbackId: "260901PAID07-1", orderId: "260901PAID07", open: 9263 }],
  counts: { orders: 18, linkRequests: 41, payouts: 3 },
};
const linkRows = () => ({ rows: fixtures.products.map((productName, i) => ({ requestId: `R2610${String(2714023 + i * 97)}`, productName, productImageUrl: i === 3 ? null : `https://cf.example.test/file/${PHOTOS[i % PHOTOS.length]}`, network: i === 2 ? "accesstrade" : "shopee", status: ["DELIVERED", "CONVERTED", "DELIVERED", "FAILED", "CONVERTED"][i], createdAt: `2026-10-${String(28 - i * 3).padStart(2, "0")}T03:00:00.000Z` })), total: 41, page: 1, pageSize: 25, facets: { status: [] }, summary: {}, asOf: "2026-10-30T12:42:00.000Z" });

const ERASED_PAGE = { ...CUSTOMER_PAGE, customerName: null, status: "ERASED", zaloUserId: null, erasedAt: "2026-10-30T12:00:00.000Z", balance: { payable: 0, gross: 0, waiting: 0, paid: 212400, deductedNext: 0 }, flags: [], bank: null, clawbacks: [] };

// The Overview: the golden ledger's server answer, with each preset's own period; "today" has no approval yet (dashes).
const GOLDEN_OVERVIEW = JSON.parse(readFileSync(join(root, "tests/fixtures/overview.json"), "utf8")).overview;
const PERIODS_BY_PRESET = {
  today: { from: "2026-10-30", to: "2026-10-30", previousFrom: "2026-10-29", previousTo: "2026-10-29" },
  last7: { from: "2026-10-24", to: "2026-10-30", previousFrom: "2026-10-17", previousTo: "2026-10-23" },
  thisMonth: { from: "2026-10-01", to: "2026-10-30", previousFrom: "2026-09-01", previousTo: "2026-09-30" },
  lastMonth: { from: "2026-09-01", to: "2026-09-30", previousFrom: "2026-08-01", previousTo: "2026-08-31" },
  custom: { from: "2026-10-01", to: "2026-10-15", previousFrom: "2026-09-16", previousTo: "2026-09-30" },
};
const NONE = { value: null, previous: null, change: null };
function overviewOf(url) {
  const preset = url.searchParams.get("period") ?? "thisMonth";
  const base = { ...GOLDEN_OVERVIEW, period: { preset, ...PERIODS_BY_PRESET[preset] } };
  if (preset !== "today") return base;
  const b = base.business;
  return { ...base, business: { ...b, commission: NONE, approvedOrders: NONE, fee: NONE, tax: NONE, cashback: NONE, eventBonus: NONE, clawbackNetted: NONE, profit: NONE, margin: { bps: null, previousBps: null, changeBps: null, enoughData: true }, split: null, byNetwork: [], byCampaign: [], withheldPeriods: [], cashbackPaid: 0, cashbackOwed: 0 }, events: [], customers: { ...base.customers, concentration: null } };
}

const REVIEW_ROWS = [
  { caseId: 7, network: "shopee", subject: "241027F3HQ", orderId: null, reason: "unattributed_sub_id1", status: "OPEN", resolution: null, openedAt: "2026-10-27T03:10:00.000Z", resolvedAt: null },
  { caseId: 9, network: "accesstrade", subject: "AT8812300417", orderId: "AT8812300417", reason: "unknown_status", status: "OPEN", resolution: null, openedAt: "2026-10-28T08:40:00.000Z", resolvedAt: null },
  { caseId: 12, network: "shopee", subject: "251019ZT45LB", orderId: "251019ZT45LB", reason: "cancel_after_payout", status: "OPEN", resolution: null, openedAt: "2026-10-29T02:00:00.000Z", resolvedAt: null },
  { caseId: 14, network: "shopee", subject: "payout:1033120", orderId: null, reason: "settlement_mismatch", status: "OPEN", resolution: null, openedAt: "2026-10-30T03:00:00.000Z", resolvedAt: null },
];
function reviewRows(url) {
  const reason = url.searchParams.get("filter[reason]")?.split(",") ?? [];
  const rows = reason.length === 0 ? REVIEW_ROWS : REVIEW_ROWS.filter((r) => reason.includes(r.reason));
  const facets = { reason: [...new Set(rows.map((r) => r.reason))].map((value) => ({ value, count: rows.filter((r) => r.reason === value).length })) };
  return { rows, total: rows.length, page: 1, pageSize: 25, facets, summary: {}, asOf: "2026-10-30T12:42:00.000Z", counts: { open: 4, resolved: 41 } };
}
const REVIEW_DETAIL = {
  ...REVIEW_ROWS[0], resolutionReason: null, order: null, applicable: true, frozen: false,
  facts: [
    { key: "orderId", kind: "code", value: "241027F3HQ", detail: null }, { key: "networkStatus", kind: "orderStatus", value: "APPROVED", detail: "completed" }, { key: "purchasedAt", kind: "instant", value: "2026-10-26T13:20:00.000Z", detail: null },
    { key: "subId1", kind: "code", value: "C0042", detail: null }, { key: "subId2", kind: "code", value: "R26102714023", detail: null }, { key: "itemCount", kind: "text", value: 1, detail: null },
    { key: "orderValue", kind: "money", value: 389000, detail: null }, { key: "reportedCommission", kind: "money", value: 8210, detail: null },
  ],
  candidates: [{ customerId: "P1", customerCode: "DP00031", customerName: payoutFixtures.names[1], recentOrders: [
    { orderId: "261020A0031", productName: fixtures.products[1], productImageUrl: "https://cf.example.test/file/deal_tech_2.jpg", status: "APPROVED", cashback: 9263, recordedAt: "2026-10-20T03:00:00.000Z" },
    { orderId: "261002A0031", productName: fixtures.products[3], productImageUrl: null, status: "PAID", cashback: 12640, recordedAt: "2026-10-02T03:00:00.000Z" },
  ] }],
};
const REVIEW_PREVIEW = { caseId: 7, orderId: "241027F3HQ", customerId: "P1", customerCode: "DP00031", from: null, to: "AWAITING_APPROVAL", cashback: null };

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
    if (url.pathname === "/api/admin/orders" || /^\/api\/admin\/customers\/[^/]+\/orders$/.test(url.pathname)) return route.fulfill({ json: orders(url) });
    if (url.pathname === "/api/admin/customers") return route.fulfill({ json: customerRows() });
    if (url.pathname.endsWith("/link-requests")) return route.fulfill({ json: linkRows() });
    if (/^\/api\/admin\/customers\/[^/]+\/payouts$/.test(url.pathname)) return route.fulfill({ json: historyRows() });
    if (url.pathname === "/api/admin/customers/DP00099") return route.fulfill({ json: ERASED_PAGE });
    if (/^\/api\/admin\/customers\/[^/]+$/.test(url.pathname)) return route.fulfill({ json: CUSTOMER_PAGE });
    if (url.pathname === "/api/admin/overview") return route.fulfill({ json: overviewOf(url) });
    if (url.pathname === "/api/admin/review-cases") return route.fulfill({ json: reviewRows(url) });
    if (/^\/api\/admin\/review-cases\/\d+$/.test(url.pathname)) return route.fulfill({ json: REVIEW_DETAIL });
    if (url.pathname.endsWith("/preview")) return route.fulfill({ json: REVIEW_PREVIEW });
    if (url.pathname === "/api/admin/payouts") return route.fulfill({ json: payoutRows(url) });
    if (url.pathname === "/api/admin/payout-history") return route.fulfill({ json: historyRows() });
    if (url.pathname === "/api/admin/network-settlements") return route.fulfill({ json: networkRows() });
    if (url.pathname.startsWith("/api/admin/network-settlements/")) return route.fulfill({ json: NETWORK_DETAIL });
    if (url.pathname.endsWith("/impact")) return route.fulfill({ json: { network: "shopee", periodMonth: "2026-10", withheld: false, affected: 7 } });
    if (url.pathname === "/api/admin/settlement-periods") return route.fulfill({ json: PERIODS });
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
    // Every row of an Overview card grid: the cards that share a top edge have one height.
    const uneven = [...document.querySelectorAll("[data-overview] .grid")].flatMap((grid) => {
      const rows = new Map();
      for (const card of grid.children) {
        const box = card.getBoundingClientRect();
        const top = Math.round(box.top);
        rows.set(top, [...(rows.get(top) ?? []), Math.round(box.height)]);
      }
      return [...rows.values()].filter((heights) => new Set(heights).size > 1).map((heights) => `${grid.className.slice(0, 60)}: ${heights.join("/")}`);
    });
    return { sideways: doc.scrollWidth > window.innerWidth, wide: wide.slice(0, 5).map((el) => el.outerHTML.slice(0, 120)), small: small.slice(0, 5).map((el) => el.outerHTML.slice(0, 120)), uneven };
  });
  if (overflow.sideways || overflow.wide.length > 0 || overflow.small.length > 0 || overflow.uneven.length > 0) problems.push({ name, ...overflow });
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
for (const [label, width, height] of WIDTHS) {
  await shoot(`payout-proof-${label}-sheet`, width, height, "/admin/payouts", (page) => openPanel(page).then(() => chooseProof(page)).then(() => toConfirm(page)));
  await shoot(`payout-proof-saved-${label}-sheet`, width, height, "/admin/payouts", (page) =>
    openPanel(page).then(() => chooseProof(page)).then(() => toConfirm(page)).then(() => press(page)).then(() => page.locator("[data-proof-state=saved] img").waitFor({ timeout: 10_000 })));
}
const openHistoryVoid = (page) => page.locator("[data-card=payout-history] button, tbody button").filter({ hasText: /^Hu/ }).first().click().then(() => page.locator("[data-void-lines]").waitFor({ timeout: 10_000 }));
for (const [label, width, height] of WIDTHS) {
  await shoot(`payout-history-${label}`, width, height, "/admin/payouts/history");
  await shoot(`payout-void-${label}-sheet`, width, height, "/admin/payouts/history", (page) => openHistoryVoid(page).then(() => page.getByRole("alertdialog").locator("textarea").fill("Ghi nh\u1ea7m kh\u00e1ch, ch\u01b0a chuy\u1ec3n kho\u1ea3n")));
  await shoot(`network-payouts-${label}`, width, height, "/admin/payouts/network");
  await shoot(`network-payout-${label}-sheet`, width, height, "/admin/payouts/network", (page) => page.getByRole("button", { name: /^Xem/ }).nth(2).click().then(() => page.locator("[data-settlement-order]").first().waitFor({ timeout: 10_000 })));
  await shoot(`settings-${label}`, width, height, "/admin/settings");
  await shoot(`settings-confirm-${label}-sheet`, width, height, "/admin/settings", (page) => page.getByRole("switch").first().click().then(() => page.locator("[data-affected]").waitFor({ timeout: 10_000 })));
}
const reviewPreview = (page) =>
  page.getByRole("button", { name: /^Xem ca 241027F3HQ/ }).click()
    .then(() => page.locator("[data-review-facts]").waitFor({ timeout: 10_000 }))
    .then(() => page.getByRole("dialog").getByRole("button", { name: /^\u00c1p d\u1ee5ng$/ }).click())
    .then(() => page.getByRole("dialog").locator("textarea").fill("Link R26102714023 l\u00e0 c\u1ee7a DP00031"))
    .then(() => page.getByRole("dialog").getByRole("button", { name: /^Xem k\u1ebft qu\u1ea3$/ }).click())
    .then(() => page.locator("[data-review-preview]").waitFor({ timeout: 10_000 }));
for (const [label, width, height] of WIDTHS) {
  await shoot(`customers-${label}`, width, height, "/admin/customers");
  await shoot(`customer-${label}`, width, height, "/admin/customers/DP00012");
  await shoot(`review-${label}`, width, height, "/admin/review");
  await shoot(`review-case-${label}-sheet`, width, height, "/admin/review", reviewPreview);
}
await shoot("review-case-phone-390-candidates-sheet", 390, 844, "/admin/review", (page) => reviewPreview(page).then(() => page.locator("[data-review-body]").evaluate((el) => el.scrollTo(0, el.scrollHeight))));
for (const [label, width, height] of WIDTHS) {
  for (const preset of ["today", "last7", "thisMonth", "lastMonth", "custom"]) {
    const query = preset === "thisMonth" ? "" : preset === "custom" ? "?period=custom&from=2026-10-01&to=2026-10-15" : `?period=${preset}`;
    await shoot(`overview-${preset}-${label}`, width, height, `/admin/${query}`);
  }
  await shoot(`customer-erase-${label}-sheet`, width, height, "/admin/customers/DP00012", (page) =>
    page.locator("[data-danger-zone] button").click().then(() => page.locator("[data-erase-dialog] textarea").fill("Kh\u00e1ch y\u00eau c\u1ea7u xo\u00e1 qua Zalo")));
  await shoot(`customer-erased-${label}`, width, height, "/admin/customers/DP00099");
}
await shoot("overview-desktop-1440-trend-table", 1440, 960, "/admin/", (page) => page.getByRole("button", { name: /^Xem b\u1ea3ng s\u1ed1$/ }).click());
await shoot("overview-desktop-1440-trend-tooltip-sheet", 1440, 960, "/admin/", (page) => page.locator("[data-trend-summary]").scrollIntoViewIfNeeded().then(() => page.getByRole("button", { name: /^Tu\u1ea7n 12\/10/ }).hover()));
await shoot("customer-tablet-768-columns", 768, 1024, "/admin/customers/DP00012", (page) => page.getByRole("button", { name: /^C\u1ed9t$/ }).click());
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
