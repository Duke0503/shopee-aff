// Screenshots of the customer website for the design review (Stories 7.1 and 7.2): the shell
// (Home, Guide, My money) with and without the Zalo-down banner, the not-found page, sign-in
// empty, refused and waiting, the session-ended notice and the session check error, at phone 390, tablet 768 and desktop 1440. Starts the Vite dev
// server and answers /api from fixtures in the browser. Every page is also opened at 360 px with
// the Zalo in-app browser's user agent and checked (Story 7.1 AC4): nothing scrolls sideways or
// pokes past the viewport, no text is under 12 px, on touch screens every link, button and field
// is at least 44 px tall and wide (a code chip counts its invisible 44 px tap area), and the bottom bar hides while
// a field has focus.
// Usage: node scripts/take-screenshots.mjs <output folder> [name prefix, to shoot only those]
import { mkdirSync } from "node:fs";
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

const server = await createServer({ root, configFile: join(root, "vite.config.ts"), server: { port: 5175, strictPort: true }, logLevel: "error" });
await server.listen();
const browser = await chromium.launch();
const problems = [];

async function open(width, height, path, { status = UP, session = SIGNED_OUT, signIn = REFUSED, zalo = false } = {}) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: width < 768 ? 2 : 1, hasTouch: width < 1280, isMobile: width < 768, ...(zalo ? { userAgent: ZALO_UA } : {}) });
  await page.route("**/api/site-status", (route) => route.fulfill({ json: status }));
  await page.route("**/api/session", (route) => route.fulfill(route.request().method() === "POST" ? signIn : session));
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

// Story 7.1 AC4: 360 px in the Zalo in-app browser, each tab and the sign-in form.
if (only === undefined || "zalo-360".startsWith(only) || only.startsWith("zalo-360")) {
  for (const [path, status, session] of [["/", DOWN, SIGNED_OUT], ["/tien-cua-toi", UP, LAN], ["/huong-dan", UP, SIGNED_OUT], ["/dang-nhap", DOWN, SIGNED_OUT]]) {
    const page = await open(360, 740, path, { status, session, zalo: true });
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
