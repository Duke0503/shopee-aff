/**
 * The share page `/s/<code>` (FR-6, FR-3, AD-14, AD-21, UX-DR12, D5; Story 5.8), rendered by the
 * server as one small HTML document with no client framework, on the DESIGN.md tokens of
 * packages/ui. A purchase started inside an app's own browser (Zalo's) is not credited, so where
 * the page is opened decides what it does:
 *
 *   - Android in an app: the page sends the browser to Chrome at once by an intent to this same
 *     share URL, with the same intent on its button; if Chrome is missing, Android opens the stored
 *     link in place (the live fallback). The intent's address carries `?via=app`, so the Chrome
 *     visit that follows is not counted as a second click.
 *   - iOS in an app: no page can leave an app's browser on iOS, so it shows the "open in Safari"
 *     step and a copy-link button, and does not redirect.
 *   - A real browser: product, price and the estimated cashback with its example amounts for about
 *     one second, then the stored link, by a meta refresh: no script is needed for the redirect.
 *   - A guest link (HOUSE, D5): the guest warning replaces the cashback line, the Zalo button is
 *     the main action and the page does not move on by itself, so the warning is read.
 *
 * The target is only ever the request's stored, checked link (`sharePageLink`): no query parameter
 * is read, so the page is never an open redirect. Every GET by a person records one click; a HEAD
 * request and a preview bot do not. The user agent decides the variant and is then dropped. An
 * unknown code, or one whose request has no usable link, gets the "link no longer works" page with
 * the Zalo button and 404. The page's own address is built on PUBLIC_BASE_URL, which production
 * requires; without it (dev) only a request to this machine's own host is served, never one built
 * on another Host header. Every value is HTML-escaped; the CSP allows this page's own inline
 * style and copy script by hash, the inlined logo, and product images from exactly the hosts the
 * page accepts pictures from (`IMAGE_HOSTS`).
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { formatAmountDigits, type Clock } from "@cashback/core";
import pages from "@cashback/labels/vi/pages.json" with { type: "json" };
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import { chromeIntentUrl, linkReplyData, recordLinkClick, shareAgentOf, shareDeviceOf, sharePageLink, type LinkEstimate, type LinkReplyData, type SharePageLink } from "../modules/linking/index";
import { periodWithheld, settlementPeriodOf } from "../modules/orders/index";
import { REPOSITORY_ROOT } from "../platform/config/env.config";
import type { Ledger, LedgerDb } from "../platform/db/ledger";
import { escapeHtml } from "./receipt.page";
import { SHARE_CSS } from "./share-style";

type PageKey = keyof typeof pages;
const text = (key: PageKey, params: Readonly<Record<string, string>> = {}): string => pages[key].replace(/\{(\w+)\}/g, (whole, name: string) => params[name] ?? whole);
const t = (key: PageKey, params: Readonly<Record<string, string>> = {}): string => escapeHtml(text(key, params));

const STYLE = `${readFileSync(join(REPOSITORY_ROOT, "packages/ui/src/styles/tokens.css"), "utf8")}\n${SHARE_CSS}`;
/** Copies the share link; the page works without it (the link is shown as text). */
const SCRIPT = `document.querySelectorAll("[data-copy]").forEach(function(b){b.addEventListener("click",function(){if(!navigator.clipboard)return;navigator.clipboard.writeText(b.getAttribute("data-copy")).then(function(){b.textContent=b.getAttribute("data-done")})})});`;
const LOGO = `data:image/webp;base64,${readFileSync(join(dirname(fileURLToPath(import.meta.url)), "logo-mark-64.webp")).toString("base64")}`;
const hashOf = (source: string): string => `'sha256-${createHash("sha256").update(source, "utf8").digest("base64")}'`;

/** Where Shopee serves product pictures, as CSP host sources; the page shows a picture only from these, and the CSP allows exactly these. */
export const IMAGE_HOSTS = ["*.susercontent.com", "shopee.vn", "*.shopee.vn"] as const;
export const SHARE_CSP = `default-src 'none'; style-src ${hashOf(STYLE)}; script-src ${hashOf(SCRIPT)}; img-src data: ${IMAGE_HOSTS.map((h) => `https://${h}`).join(" ")}; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`;
/** Marks the address Android opens in Chrome after the hand-off, so that visit is not counted again. */
export const HANDOFF_PARAM = "via";
const HANDOFF_VALUE = "app";
/** The hosts a start without PUBLIC_BASE_URL (dev only: production requires it) may build share addresses on. */
const LOCAL_HOSTS = ["127.0.0.1", "localhost"] as const;
/** How long a real browser shows the page before it moves on to the shop. */
export const SHARE_REDIRECT_SECONDS = 1;

export type ShareVariant = "browser" | "android_in_app" | "ios_in_app";

export interface ShareView {
  readonly link: SharePageLink;
  readonly reply: LinkReplyData;
  readonly variant: ShareVariant;
  /** This page's own address, `<base>/s/<code>`. */
  readonly shareUrl: string;
}

const networkName = (link: SharePageLink): string => text(link.network === "shopee" ? "share_network_shopee" : "share_network_accesstrade");

function money(amount: number): string {
  const digits = formatAmountDigits(amount);
  return digits === null ? t("value_missing") : `${digits}${t("money_sign")}`;
}

/** Basis points as a person writes a percentage: 260 as "2,6%", 8000 as "80%". */
export function percentOf(bps: number): string {
  const whole = Math.trunc(bps / 100);
  const decimals = String(bps % 100).padStart(2, "0").replace(/0+$/, "");
  return decimals === "" ? `${whole}%` : `${whole},${decimals}%`;
}

function imageOf(url: string | null): string | null {
  if (url === null || !URL.canParse(url)) return null;
  const parsed = new URL(url);
  const host = parsed.hostname.toLowerCase();
  const allowed = IMAGE_HOSTS.some((h) => (h.startsWith("*.") ? host.endsWith(h.slice(1)) && host.length > h.length - 1 : host === h));
  return parsed.protocol === "https:" && allowed ? url : null;
}

function rateLines(estimate: LinkEstimate): string {
  const label = (part: LinkEstimate["rates"][number]["part"], rate: string): string => {
    if (part === "shopee") return t("share_rate_shopee", { rate });
    if (part === "seller") return t("share_rate_seller", { rate });
    return t(estimate.withheld ? "share_rate_customer_share_withheld" : "share_rate_customer_share", { rate });
  };
  const lines = estimate.rates.map((r) => `<li data-rate="${r.part}"><span>${label(r.part, percentOf(r.rateBps))}</span><span>${money(r.amount)}</span></li>`).join("");
  const capped = estimate.capped ? `<p class="small">${t("share_capped")}</p>` : "";
  return `<ul class="rates">${lines}</ul>${capped}`;
}

/** The cashback line: the estimate with its example amounts, or a dash; for a guest link the guest warning instead. */
function cashbackBlock(reply: LinkReplyData): string {
  if (reply.guest) return `<div class="panel guest" role="note" data-guest><strong>${t("share_guest_title")}</strong><p>${t("share_guest_body")}</p></div>`;
  const label = `<p class="cash-label">${t("share_cashback_label")}</p>`;
  if (reply.estimate === null) return `<div class="cash" data-estimate="none">${label}<p class="cash-line"><span class="missing">${t("value_missing")}</span></p><p class="small">${t("share_no_estimate")}</p></div>`;
  const e = reply.estimate;
  const line = `<p class="cash-line"><span class="estimate">${t("share_about")} <b>${money(e.cashback)}</b></span><span class="estimate-tag">${t("share_estimate_tag")}</span></p>`;
  return `<div class="cash" data-estimate="${e.cashback}">${label}${line}${rateLines(e)}<p class="small">${t("share_estimate_note")}</p></div>`;
}

function productBlock(view: ShareView): string {
  const { product } = view.reply;
  const image = imageOf(product.imageUrl);
  const name = product.name ?? text("share_title_fallback", { network: networkName(view.link) });
  const thumb = image === null ? "" : `<img class="thumb" src="${escapeHtml(image)}" alt="" referrerpolicy="no-referrer">`;
  const price = product.price === null ? "" : `<p class="price">${money(product.price)}</p>`;
  return `<div class="product">${thumb}<div class="product-text"><h1>${escapeHtml(name)}</h1>${price}</div></div>`;
}

/** Chrome by intent to this same page, marked as the hand-off; the stored link in place when Chrome is missing. */
const handoffIntent = (view: ShareView): string => chromeIntentUrl(`${view.shareUrl}?${HANDOFF_PARAM}=${HANDOFF_VALUE}`, view.link.target);

function actionBlock(view: ShareView): string {
  const network = networkName(view.link);
  const target = escapeHtml(view.link.target);
  if (view.variant === "android_in_app") {
    const intent = escapeHtml(handoffIntent(view));
    return `<div class="panel handoff" data-variant="android_in_app"><strong>${t("share_android_title")}</strong><p>${t("share_android_body")}</p></div><div class="actions"><a class="btn" href="${intent}" rel="nofollow">${t("share_open_chrome")}</a></div>`;
  }
  if (view.variant === "ios_in_app") {
    const share = escapeHtml(view.shareUrl);
    const steps = `<ol class="steps"><li>${t("share_ios_step_1")}</li><li>${t("share_ios_step_2", { network })}</li></ol>`;
    const copy = `<p class="small">${t("share_ios_copy_hint")}</p><code class="share-url">${share}</code><div class="actions"><button type="button" class="btn btn-outline" data-copy="${share}" data-done="${t("share_copied")}">${t("share_copy_link")}</button></div>`;
    return `<div class="panel handoff" data-variant="ios_in_app"><strong>${t("share_ios_title")}</strong><p>${t("share_ios_body")}</p>${steps}</div>${copy}`;
  }
  if (view.reply.guest) {
    return `<div class="actions"><a class="btn" href="${t("share_zalo_url")}" rel="noopener">${t("share_guest_zalo")}</a><a class="btn btn-outline" href="${target}" rel="nofollow noreferrer">${t("share_guest_go", { network })}</a></div>`;
  }
  return `<div class="actions"><a class="btn" href="${target}" rel="nofollow noreferrer">${t("share_go", { network })}</a></div><p class="status" role="status">${t("share_opening", { network })}</p>`;
}

/** The meta refresh of the variant: Chrome at once on Android in an app, the shop after a second in a real browser, none otherwise. */
function refreshOf(view: ShareView): string | null {
  if (view.variant === "android_in_app") return `0;url=${handoffIntent(view)}`;
  if (view.variant === "browser" && !view.reply.guest) return `${SHARE_REDIRECT_SECONDS};url=${view.link.target}`;
  return null;
}

function documentOf(title: string, body: string, head: readonly string[] = []): string {
  return [
    "<!doctype html>",
    '<html lang="vi">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="robots" content="noindex, nofollow">',
    '<meta name="referrer" content="no-referrer">',
    `<title>${escapeHtml(title)}</title>`,
    ...head,
    `<style>${STYLE}</style>`,
    "</head>",
    `<body><main class="page">${body}</main><script>${SCRIPT}</script></body>`,
    "</html>",
  ].join("\n");
}

const topBar = (network: string | null): string => `<header class="top"><p class="brand"><img class="brand-mark" src="${LOGO}" alt="" width="28" height="28">${t("brand_name")}</p>${network === null ? "" : `<span class="network">${escapeHtml(network)}</span>`}</header>`;

export function shareHtml(view: ShareView): string {
  const network = networkName(view.link);
  const title = view.reply.product.name ?? text("share_title_fallback", { network });
  const image = imageOf(view.reply.product.imageUrl);
  const refresh = refreshOf(view);
  const head = [`<meta property="og:title" content="${escapeHtml(title)}">`, `<meta property="og:description" content="${t("share_preview", { network })}">`, ...(image === null ? [] : [`<meta property="og:image" content="${escapeHtml(image)}">`]), ...(refresh === null ? [] : [`<meta http-equiv="refresh" content="${escapeHtml(refresh)}">`])];
  const card = `<section class="card" data-share="${view.variant}">${productBlock(view)}${cashbackBlock(view.reply)}${actionBlock(view)}</section>`;
  return documentOf(title, `${topBar(network)}${card}`, head);
}

export function missingShareHtml(): string {
  const body = `${topBar(null)}<section class="card" data-share="missing"><h1>${t("share_not_found_title")}</h1><p class="body">${t("share_not_found_body")}</p><div class="actions"><a class="btn" href="${t("share_zalo_url")}" rel="noopener">${t("share_open_zalo")}</a></div></section>`;
  return documentOf(text("share_not_found_title"), body);
}

function variantOf(userAgent: string | undefined): ShareVariant {
  if (shareAgentOf(userAgent) !== "in_app") return "browser";
  const device = shareDeviceOf(userAgent);
  return device === "android" ? "android_in_app" : device === "ios" ? "ios_in_app" : "browser";
}

function sendPage(reply: FastifyReply, status: number, html: string): string {
  void reply
    .status(status)
    .header("content-type", "text/html; charset=utf-8")
    .header("content-security-policy", SHARE_CSP)
    .header("x-content-type-options", "nosniff")
    .header("x-robots-tag", "noindex, nofollow")
    .header("referrer-policy", "no-referrer")
    .header("cache-control", "no-store");
  return html;
}

export interface SharePageDeps {
  readonly ledger: Ledger;
  readonly clock: Clock;
  /**
   * The public origin share links are built on (`https://hoantiendp.com`); production always has
   * it. Without it (dev, no tunnel) only a request to this machine's own host is served.
   */
  readonly baseUrl: string | null;
  /** True only for a fake-bridge start: its links are on the reserved fake host (AD-25). */
  readonly acceptFakeHost?: boolean;
}

/** Reads the link and, for a person's GET, records the visit, in one transaction. */
/** The origin to build this page's address on: the configured one, else a local host only; null refuses the page. */
function originOf(deps: SharePageDeps, request: FastifyRequest): string | null {
  if (deps.baseUrl !== null) return deps.baseUrl.replace(/\/+$/, "");
  const host = request.headers.host ?? "";
  const name = /^([^:]+)(?::\d{1,5})?$/.exec(host)?.[1]?.toLowerCase() ?? "";
  return (LOCAL_HOSTS as readonly string[]).includes(name) ? `http://${host}` : null;
}

/**
 * Reads the link and, for a person's GET, records the visit, in one transaction. The Chrome visit
 * that follows an Android hand-off (marked by the query flag) is the same visit and is not counted
 * again; the flag never changes the target.
 */
function openShare(db: LedgerDb, deps: SharePageDeps, code: string, origin: string, request: FastifyRequest): ShareView | null {
  const link = sharePageLink(db, code, deps.acceptFakeHost ?? false);
  if (link === null) return null;
  const userAgent = request.headers["user-agent"];
  const agent = shareAgentOf(userAgent);
  const handoff = (request.query as Record<string, unknown> | undefined)?.[HANDOFF_PARAM] === HANDOFF_VALUE;
  if (request.method === "GET" && agent !== "bot" && !handoff) recordLinkClick(db, { code: link.code, requestId: link.requestId, agent }, deps.clock);
  const withheld = periodWithheld(db, "shopee", settlementPeriodOf(deps.clock.now()));
  return { link, reply: linkReplyData(link, { guest: link.guest, withheld }), variant: variantOf(userAgent), shareUrl: `${origin}/s/${link.code}` };
}

export function sharePageRoutes(deps: SharePageDeps): (app: FastifyInstance) => void {
  return (app) => {
    app.get("/s/:code", async (request, reply) => {
      const { code } = request.params as { code?: unknown };
      const origin = originOf(deps, request);
      if (origin === null) return sendPage(reply, 503, missingShareHtml());
      const view = typeof code === "string" ? deps.ledger.tx((db) => openShare(db, deps, code, origin, request)) : null;
      return view === null ? sendPage(reply, 404, missingShareHtml()) : sendPage(reply, 200, shareHtml(view));
    });
  };
}
