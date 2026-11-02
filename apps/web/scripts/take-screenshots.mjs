// Screenshots of the customer website for the design review (Stories 7.1 to 7.7): the shell
// (Home, Guide, My money) with and without the Zalo-down banner, the not-found page, sign-in
// empty, refused and waiting, the session-ended notice and the session check error, My money
// (normal, with a deduction, empty) and its order list (list, filtered, empty) from
// tests/fixtures/my-money.json, Account (no bank, held, saved, the bank picker, password and
// errors), the Home link converter (signed out, signed in, creating, result, guest, unsupported,
// unknown code, busy, no estimate) and the Guide, at phone 390, tablet 768 and desktop 1440. Starts the Vite dev
// server and answers /api from fixtures in the browser. Every page is also opened at 360 px with
// the Zalo in-app browser's user agent and checked (Story 7.1 AC4): nothing scrolls sideways or
// pokes past the viewport, no text is under 12 px, on touch screens every link, button and field
// is at least 44 px tall and wide (a code chip counts its invisible 44 px tap area), and the bottom bar hides while
// a field has focus.
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

const ZALO_UA = "Mozilla/5.0 (Linux; Android 13; SM-A145F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36 Zalo android/12100621 ZaloTheme/light ZaloLanguage/vi";
const UP = { assistant: "up", fallbackContactUrl: null, assistantUrl: "https://zalo.me/0900000000" };
const DOWN = { assistant: "down", fallbackContactUrl: "https://m.me/hoantiendp", assistantUrl: "https://zalo.me/0900000000" };
const SIGNED_OUT = { status: 401, json: { error: { code: "unauthorized", messageKey: "error.unauthorized" } } };
const LAN = { status: 200, json: { customerCode: "DP00012" } };
const REFUSED = { status: 401, json: { error: { code: "unauthorized", messageKey: "error.customer_sign_in_refused" } } };
const WAITING = { status: 429, json: { error: { code: "rate_limited", messageKey: "error.customer_sign_in_waiting", fields: { retryAt: "2026-11-02T12:57:00.000Z" } } } };

const MONEY = JSON.parse(readFileSync(join(root, "tests", "fixtures", "my-money.json"), "utf8"));
const IMAGES = join(root, "..", "..", "docs", "design", "wireframe", "images");
const MY = { money: "moneyNoDeduction", orders: "orders", payouts: "payouts" };
const BANKS = { banks: JSON.parse(readFileSync(join(root, "..", "server", "src", "modules", "identity", "domain", "vietqr-banks.json"), "utf8")).banks.map(({ bin, shortName, name }) => ({ bin, shortName, name })) };
const GUIDE = { feeBps: 98, taxBps: 1000, shareBps: 8000, shopeeCap: 40000, example: { price: 450000, shopeeRateBps: 260, commission: 11700, notWithheld: { fee: 115, tax: 0, net: 11585, cashback: 9268 }, withheld: { fee: 115, tax: 1170, net: 10415, cashback: 8332 } }, capExample: { price: 2000000, shopeeRateBps: 300, xtraRateBps: 200, shopeePart: 40000, xtraPart: 40000, commission: 80000 } };
const READY = { state: "ready", guest: false, factsSettled: true, network: "shopee", perShop: false, product: { name: "\u00c1o thun cotton nam n\u1eef form r\u1ed9ng Unisex basic", imageUrl: null, price: 159000 }, estimate: { cashback: 7234, withheld: true }, sharePath: "/s/Ab12Cd34Ef" };
const TICKET = { status: 200, json: { ticket: "26110100001.abcdefghijklmnopqrstuvwx", guest: false, customerCode: "DP00012" } };
const LINKS = {
  ready: { queue: TICKET, result: READY },
  noEstimate: { queue: TICKET, result: { ...READY, estimate: null } },
  guest: { queue: { status: 200, json: { ticket: "26110100001.abcdefghijklmnopqrstuvwx", guest: true, customerCode: null } }, result: { ...READY, guest: true, estimate: null } },
  creating: { queue: TICKET, result: { ...READY, state: "creating", sharePath: null, estimate: null, factsSettled: false } },
  unsupported: { queue: { status: 400, json: { error: { code: "invalid_request", messageKey: "error.link.network_unsupported" } } } },
  unknown: { queue: { status: 404, json: { error: { code: "not_found", messageKey: "error.web_link.customer_unknown", fields: { customerCode: "error.web_link.customer_unknown" } } } } },
  busy: { queue: { status: 429, json: { error: { code: "rate_limited", messageKey: "error.link.web_busy" } } } },
};

const server = await createServer({ root, configFile: join(root, "vite.config.ts"), server: { port: 5175, strictPort: true }, logLevel: "error" });
await server.listen();
const browser = await chromium.launch();
const problems = [];

async function open(width, height, path, { status = UP, session = SIGNED_OUT, signIn = REFUSED, zalo = false, my = MY, link = LINKS.ready, password = null } = {}) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: width < 768 ? 2 : 1, hasTouch: width < 1280, isMobile: width < 768, ...(zalo ? { userAgent: ZALO_UA } : {}) });
  await page.route("**/api/site-status", (route) => route.fulfill({ json: status }));
  await page.route("**/api/session", (route) => route.fulfill(route.request().method() === "POST" ? signIn : session));
  await page.route("**/api/me/money", (route) => route.fulfill({ json: MONEY[my.money] }));
  await page.route("**/api/me/orders?**", (route) => {
    const filtered = new URL(route.request().url()).searchParams.get("filter[status]");
    const answer = MONEY[filtered === "APPROVED" && my.orders === "orders" ? "ordersApproved" : my.orders];
    route.fulfill(answer === undefined ? { status: 503, json: { error: { code: "busy", messageKey: "error.busy" } } } : { json: answer });
  });
  await page.route("**/api/me/payouts?**", (route) => route.fulfill({ json: MONEY[my.payouts] }));
  await page.route("**/api/banks", (route) => route.fulfill({ json: BANKS }));
  await page.route("**/api/guide", (route) => route.fulfill({ json: GUIDE }));
  await page.route("**/api/me/bank-account", (route) => route.fulfill({ json: { result: "saved", bank: MONEY.moneyHeld.bank } }));
  await page.route("**/api/me/password", (route) => route.fulfill(password ?? { json: { changed: true, otherSessionsEnded: 1 } }));
  await page.route("**/api/links", (route) => route.fulfill(link.queue));
  await page.route("**/api/links/*", (route) => route.fulfill({ json: link.result }));
  await page.route("https://img.example.test/**", (route) => route.fulfill({ body: readFileSync(join(IMAGES, new URL(route.request().url()).pathname.slice(1))), contentType: "image/jpeg" }));
  await page.goto(`http://localhost:5175${path}`);
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.fonts.ready);
  return page;
}

/** The layout rules of DESIGN.md and Story 7.1 AC4, read from the rendered page. */
function layoutProblems() {
  const visible = (el) => {
    const box = el.getBoundingClientRect();
    return box.width > 0 && box.height > 0 && getComputedStyle(el).visibility !== "hidden";
  };
  const wide = [...document.querySelectorAll("body *")].filter((el) => el.getBoundingClientRect().right > window.innerWidth + 1 && getComputedStyle(el).position !== "fixed");
  const small = [...document.querySelectorAll("body *")].filter((el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim() !== "") && parseFloat(getComputedStyle(el).fontSize) < 12 && !el.closest(".sr-only"));
  const tapArea = (el) => {
    const box = el.getBoundingClientRect();
    const after = getComputedStyle(el, "::after");
    const grown = after.content !== "none" && after.position === "absolute" ? Math.max(0, -parseFloat(after.top) - parseFloat(after.bottom)) : 0;
    return { width: box.width, height: box.height + grown };
  };
  // The 44 px target rule is for touch screens (DESIGN.md); a mouse on the desktop needs less.
  const touch = matchMedia("(pointer: coarse)").matches;
  const tiny = [...document.querySelectorAll("a, button, input")].filter((el) => touch && visible(el)).filter((el) => {
    const { width, height } = tapArea(el);
    return height < 44 || width < 44;
  });
  const show = (els) => els.slice(0, 5).map((el) => el.outerHTML.slice(0, 140));
  return { sideways: document.documentElement.scrollWidth > window.innerWidth, wide: show(wide), small: show(small), tiny: show(tiny) };
}

function record(name, found) {
  if (found.sideways || found.wide.length > 0 || found.small.length > 0 || found.tiny.length > 0) problems.push({ name, ...found });
}

async function shoot(name, width, height, path, options = {}, after) {
  if (only !== undefined && !name.startsWith(only)) return;
  const page = await open(width, height, path, options);
  if (after) await after(page);
  // A full-page shot shows rows below the fold, so lazy product images load now.
  await page.evaluate(() => document.querySelectorAll("img[loading=lazy]").forEach((img) => (img.loading = "eager")));
  await page.waitForFunction(() => [...document.images].every((img) => img.complete && img.naturalWidth > 0), null, { timeout: 10_000 });
  await page.waitForTimeout(250);
  record(name, await page.evaluate(layoutProblems));
  const file = join(out, `${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  console.log(file);
  await page.close();
}

const submit = (code, password) => async (page) => {
  await page.locator("#customer-code").fill(code);
  await page.locator("#password").fill(password);
  await page.locator("form button[type=submit]").click();
  await page.getByRole("alert").waitFor({ timeout: 10_000 });
  await page.locator("#password").blur();
};

const WIDTHS = [
  ["phone-390", 390, 844],
  ["tablet-768", 768, 1024],
  ["desktop-1440", 1440, 900],
];
for (const [label, width, height] of WIDTHS) {
  await shoot(`shell-home-${label}`, width, height, "/");
  await shoot(`shell-home-zalo-down-${label}`, width, height, "/", { status: DOWN });
  await shoot(`shell-my-money-zalo-down-${label}`, width, height, "/tien-cua-toi", { status: DOWN, session: LAN });
  await shoot(`sign-in-empty-${label}`, width, height, "/dang-nhap");
  await shoot(`sign-in-error-${label}`, width, height, "/dang-nhap", {}, submit("dp00012", "sai-mat-khau"));
  await shoot(`sign-in-throttled-${label}`, width, height, "/dang-nhap", { signIn: WAITING }, submit("DP00012", "sai-mat-khau"));
}
// Stories 7.3 and 7.4: My money and its order list.
for (const [label, width, height] of WIDTHS) {
  await shoot(`my-money-normal-${label}`, width, height, "/tien-cua-toi", { session: LAN }, (page) => page.locator("[data-order-line]").first().waitFor());
  await shoot(`my-money-deduction-${label}`, width, height, "/tien-cua-toi", { session: LAN, my: { ...MY, money: "money" } }, (page) => page.locator("[data-deduction]").waitFor());
  await shoot(`my-money-empty-${label}`, width, height, "/tien-cua-toi", { session: LAN, my: { money: "moneyEmpty", orders: "ordersEmpty", payouts: "payoutsEmpty" } }, (page) => page.locator("[data-list-empty]").waitFor());
  await shoot(`my-orders-list-${label}`, width, height, "/tien-cua-toi", { session: LAN, my: { ...MY, money: "money" } }, async (page) => {
    await page.locator("[data-order-line]").first().waitFor();
    await page.locator("[data-order-line]").nth(1).getByRole("button").last().click();
    await page.locator("[data-order-line]").nth(1).locator("ol").scrollIntoViewIfNeeded();
  });
  await shoot(`my-orders-filtered-${label}`, width, height, "/tien-cua-toi?filter[status]=APPROVED", { session: LAN, my: { ...MY, money: "money" } }, (page) => page.locator("[data-order-line]").first().waitFor());
  await shoot(`my-orders-empty-${label}`, width, height, "/tien-cua-toi", { session: LAN, my: { ...MY, orders: "ordersEmpty" } }, (page) => page.locator("[data-list-empty]").waitFor());
}
await shoot("my-money-payable-view-phone-390", 390, 844, "/tien-cua-toi?filter[status]=APPROVED", { session: LAN, my: { ...MY, money: "money" } }, (page) => page.locator("[data-payable-breakdown]").waitFor());
await shoot("my-money-owed-phone-390", 390, 844, "/tien-cua-toi", { session: LAN, my: { ...MY, money: "moneyOwed" } }, (page) => page.locator("[data-deduction]").waitFor());
await shoot("my-money-deducted-view-phone-390", 390, 844, "/tien-cua-toi?view=deducted", { session: LAN, my: { ...MY, money: "moneyOwed" } }, (page) => page.locator("[data-deductions] li").first().waitFor());
await shoot("my-money-no-bank-phone-390", 390, 844, "/tien-cua-toi", { session: LAN, my: { ...MY, money: "moneyNoBank" } }, (page) => page.locator("[data-bank=missing]").waitFor());
await shoot("my-money-bank-held-phone-390", 390, 844, "/tien-cua-toi", { session: LAN, my: { ...MY, money: "moneyHeld" } }, (page) => page.locator("[data-bank=held]").waitFor());
await shoot("my-money-payouts-phone-390", 390, 844, "/tien-cua-toi?view=payouts", { session: LAN }, (page) => page.locator("[data-payout]").first().waitFor());
await shoot("my-money-orders-error-phone-390", 390, 844, "/tien-cua-toi", { session: LAN, my: { ...MY, orders: "missing" } }, (page) => page.getByRole("alert").first().waitFor());
await shoot("shell-guide-phone-390", 390, 844, "/huong-dan", { session: LAN });
await shoot("not-found-phone-390", 390, 844, "/khong-co");
await shoot("sign-in-session-ended-phone-390", 390, 844, "/tien-cua-toi", { session: { status: 401, json: { error: { code: "unauthorized", messageKey: "error.session_ended_new_password" } } } });
await shoot("my-money-session-error-phone-390", 390, 844, "/tien-cua-toi", { session: { status: 503, json: { error: { code: "busy", messageKey: "error.busy" } } } }, (page) => page.getByRole("alert").waitFor({ timeout: 10_000 }));
await shoot("sign-in-session-ended-guide-phone-390", 390, 844, "/huong-dan", { session: { status: 401, json: { error: { code: "unauthorized", messageKey: "error.session_ended_new_password" } } } }, (page) => page.locator("[data-session-ended]").waitFor());
await shoot("sign-in-field-errors-phone-390", 390, 844, "/dang-nhap", {}, async (page) => {
  await page.locator("#customer-code").fill("12345");
  await page.locator("form button[type=submit]").click();
});
await shoot("account-menu-phone-390", 390, 844, "/tien-cua-toi", { session: LAN }, async (page) => {
  await page.locator("header button").click();
  await page.getByRole("dialog").waitFor();
});

// Stories 7.5 to 7.7: Account, the Home link converter and the Guide.
const convert = (url, code) => async (page) => {
  await page.locator("#link-url").fill(url);
  if (code !== undefined) {
    await page.locator("[aria-controls=link-code]").click();
    await page.locator("#link-code").fill(code);
  }
  await page.locator("[data-link-form] button[type=submit]").click();
  await page.waitForTimeout(400);
};
const passwordOpen = (current, next) => async (page) => {
  await page.locator("#password-title").waitFor();
  await page.locator("section[aria-labelledby=password-title] button").click();
  await page.locator("#currentPassword").fill(current);
  await page.locator("#newPassword").fill(next);
  await page.locator("[data-password-form] button[type=submit]").click();
  await page.waitForTimeout(300);
};
const passwordChanged = async (page) => {
  await page.locator("#password-title").waitFor();
  await page.locator("section[aria-labelledby=password-title] button").click();
  await page.locator("#currentPassword").fill("matkhau-cu-1");
  await page.locator("#newPassword").fill("matkhau-moi-2");
  await page.locator("[data-password-form] button[type=submit]").click();
  await page.locator("[data-password-done]").waitFor();
};
const PRODUCT_LINK = "https://shopee.vn/Ao-thun-cotton-i.11001.22001";
const result = (selector) => async (page) => {
  await convert(PRODUCT_LINK)(page);
  await page.locator(selector).waitFor();
};
for (const [label, width, height] of WIDTHS) {
  const noBank = { session: LAN, my: { ...MY, money: "moneyNoBank" } };
  await shoot(`s31-account-no-bank-${label}`, width, height, "/tai-khoan", noBank, (page) => page.locator("[data-bank-form]").waitFor());
  await shoot(`s31-account-held-${label}`, width, height, "/tai-khoan", { session: LAN, my: { ...MY, money: "moneyHeld" } }, (page) => page.locator("[data-bank-held]").waitFor());
  await shoot(`s31-account-saved-${label}`, width, height, "/tai-khoan", { session: LAN }, (page) => page.locator("[data-bank=saved]").waitFor());
  await shoot(`s31-account-form-errors-${label}`, width, height, "/tai-khoan", noBank, async (page) => {
    await page.locator("#bank-number").fill("12");
    await page.locator("#bank-number").blur();
    await page.locator("[data-bank-form] button[type=submit]").click();
    await page.locator("#bank-consent-error").waitFor();
  });
  await shoot(`s31-account-picker-${label}`, width, height, "/tai-khoan", noBank, async (page) => {
    await page.locator("[data-bank-form] button[aria-haspopup=dialog]").click();
    await page.locator("[data-bank-list]").waitFor();
    await page.getByRole("searchbox").fill("vietcom");
  });
  await shoot(`s31-account-password-error-${label}`, width, height, "/tai-khoan", { session: LAN }, passwordOpen("", "1234567"));
  await shoot(`s31-account-password-wrong-${label}`, width, height, "/tai-khoan", { session: LAN, password: { status: 400, json: { error: { code: "invalid_request", messageKey: "error.password.wrong_current", fields: { currentPassword: "error.password.wrong_current" } } } } }, passwordOpen("sai-mat-khau", "matkhau-moi-2"));
  await shoot(`s31-account-password-changed-${label}`, width, height, "/tai-khoan", { session: LAN }, passwordChanged);
  await shoot(`s31-home-signed-out-${label}`, width, height, "/", {}, (page) => page.locator("[data-link-form]").waitFor());
  await shoot(`s31-home-signed-in-${label}`, width, height, "/", { session: LAN }, (page) => page.locator("[data-link-own-code]").waitFor());
  await shoot(`s31-home-result-${label}`, width, height, "/", { session: LAN }, result("[data-link-result]"));
  await shoot(`s31-home-guest-${label}`, width, height, "/", { link: LINKS.guest }, result("[data-link-result]"));
  await shoot(`s31-home-no-estimate-${label}`, width, height, "/", { session: LAN, link: LINKS.noEstimate }, result("[data-no-estimate]"));
  await shoot(`s31-home-creating-${label}`, width, height, "/", { session: LAN, link: LINKS.creating }, result("[data-link-creating]"));
  await shoot(`s31-home-unsupported-${label}`, width, height, "/", { link: LINKS.unsupported }, convert("https://www.lazada.vn/products/ao-thun-i123.html"));
  await shoot(`s31-home-unknown-code-${label}`, width, height, "/", { link: LINKS.unknown }, convert(PRODUCT_LINK, "DP99999"));
  await shoot(`s31-home-busy-${label}`, width, height, "/", { link: LINKS.busy }, convert(PRODUCT_LINK, "DP00012"));
  await shoot(`s31-guide-${label}`, width, height, "/huong-dan", {}, (page) => page.locator("[data-money-example]").waitFor());
}

// Story 7.1 AC4: 360 px in the Zalo in-app browser, each tab and the sign-in form.
if (only === undefined || "zalo-360".startsWith(only) || only.startsWith("zalo-360")) {
  for (const [path, status, session] of [["/", DOWN, SIGNED_OUT], ["/tien-cua-toi", UP, LAN], ["/huong-dan", UP, SIGNED_OUT], ["/dang-nhap", DOWN, SIGNED_OUT], ["/tai-khoan", UP, LAN]]) {
    const page = await open(360, 740, path, { status, session, zalo: true, my: { ...MY, money: "money" } });
    if (path === "/tien-cua-toi") await page.locator("[data-order-line]").first().waitFor();
    if (path === "/huong-dan") await page.locator("[data-money-example]").waitFor();
    if (path === "/tai-khoan") await page.locator("[data-bank]").waitFor();
    record(`zalo-360${path}`, await page.evaluate(layoutProblems));
    if (path === "/dang-nhap") {
      await page.locator("#customer-code").focus();
      await page.waitForTimeout(100);
      if ((await page.locator("[data-bottom-tabs]").count()) !== 0) problems.push({ name: "zalo-360 keyboard", bar: "bottom bar still shown while a field has focus" });
      await page.screenshot({ path: join(out, "zalo-360-sign-in-keyboard.png"), fullPage: false });
    } else await page.screenshot({ path: join(out, `zalo-360${path === "/" ? "-home" : path.replace("/", "-")}.png`), fullPage: true });
    await page.close();
  }
}

await browser.close();
await server.close();
if (problems.length > 0) {
  console.error(JSON.stringify(problems, null, 2));
  process.exit(1);
}
console.log("no sideways scroll, nothing past the viewport, no text under 12 px, every target at least 44 px, the bar hides with the keyboard");
