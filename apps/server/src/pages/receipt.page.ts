/**
 * The public receipt page `/b/<token>` (FR-18, AD-21, D49, INV-13, UX-DR12; Story 4.9), rendered
 * by the server as one small HTML document with no client framework, on the DESIGN.md tokens of
 * packages/ui (the same tokens.css the website uses, read once at start).
 *
 * It shows facts only: the customer code, the last four digits of the account paid into, the
 * amount, the time and, for a voided payout, "voided" with the void time. Never the proof image
 * or any URL of it, never a name or a full account number. It is `noindex`, never cached, never
 * framed and never sends its URL (which holds the token) as a referrer. An unknown token, an old
 * row-number link and a netting-only payout (which has no token) all get the same plain "receipt
 * not found" page with 404, the status of any missing page. Every value is HTML-escaped; the CSP
 * allows only this page's own inline style and the one copy script, by hash, and the brand's logo
 * mark, inlined as a small data URI (pages/logo-mark-64.webp, from the live brand assets). A
 * voided payout whose void time is missing still says it was voided, without a time.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { formatAmountDigits, formatVnDateTime, parseInstant, type Clock } from "@cashback/core";
import pages from "@cashback/labels/vi/pages.json" with { type: "json" };
import type { FastifyInstance, FastifyReply } from "fastify";

import { findReceipt, type Receipt } from "../modules/payouts/index";
import { REPOSITORY_ROOT } from "../platform/config/env.config";
import type { Ledger } from "../platform/db/ledger";
import { RECEIPT_CSS } from "./receipt-style";

type PageKey = keyof typeof pages;

const text = (key: PageKey, params: Readonly<Record<string, string>> = {}): string => pages[key].replace(/\{(\w+)\}/g, (whole, name: string) => params[name] ?? whole);

const ESCAPES: Readonly<Record<string, string>> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c);

const TOKENS = readFileSync(join(REPOSITORY_ROOT, "packages/ui/src/styles/tokens.css"), "utf8");
const STYLE = `${TOKENS}\n${RECEIPT_CSS}`;
/** Copies the code of the chip pressed; the page works without it (the code is plain text). */
const SCRIPT = `document.querySelectorAll("[data-copy]").forEach(function(b){b.addEventListener("click",function(){var c=b.getAttribute("data-copy");if(!navigator.clipboard)return;navigator.clipboard.writeText(c).then(function(){var l=b.querySelector("[data-label]");if(l){l.textContent=b.getAttribute("data-done");setTimeout(function(){l.textContent=c},1500)}})})});`;
const LOGO = `data:image/webp;base64,${readFileSync(join(dirname(fileURLToPath(import.meta.url)), "logo-mark-64.webp")).toString("base64")}`;
const hashOf = (source: string): string => `'sha256-${createHash("sha256").update(source, "utf8").digest("base64")}'`;

export const RECEIPT_CSP = `default-src 'none'; style-src ${hashOf(STYLE)}; script-src ${hashOf(SCRIPT)}; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`;

function documentOf(title: string, body: string): string {
  return [
    "<!doctype html>",
    '<html lang="vi">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="robots" content="noindex, nofollow">',
    '<meta name="referrer" content="no-referrer">',
    `<title>${escapeHtml(title)}</title>`,
    `<style>${STYLE}</style>`,
    "</head>",
    `<body><main class="page">${body}</main><script>${SCRIPT}</script></body>`,
    "</html>",
  ].join("\n");
}

const brand = (): string => `<p class="brand"><img class="brand-mark" src="${LOGO}" alt="" width="28" height="28">${escapeHtml(text("brand_name"))}</p>`;

function money(amount: number): string {
  const digits = formatAmountDigits(amount);
  return digits === null ? escapeHtml(text("value_missing")) : `${digits}${escapeHtml(text("money_sign"))}`;
}

function codeChip(code: string): string {
  const c = escapeHtml(code);
  return `<button type="button" class="code-chip" data-copy="${c}" data-done="${escapeHtml(text("receipt_copied"))}" aria-label="${escapeHtml(text("receipt_copy", { code }))}"><span data-label>${c}</span><svg aria-hidden="true" viewBox="0 0 24 24" width="14" height="14"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg></button>`;
}

const fact = (label: string, value: string): string => `<div class="fact"><dt>${escapeHtml(label)}</dt><dd>${value}</dd></div>`;

const when = (instant: string | null, clock: Clock): string => (instant === null ? escapeHtml(text("value_missing")) : escapeHtml(formatVnDateTime(parseInstant(instant), clock)));

export function receiptHtml(receipt: Receipt, clock: Clock): string {
  const missing = escapeHtml(text("value_missing"));
  const status = receipt.voided ? `<span class="badge badge-rejected">${escapeHtml(text("receipt_voided"))}</span>` : `<span class="badge badge-done">${escapeHtml(text("receipt_paid"))}</span>`;
  const voidLine = receipt.voidedAt === null ? text("receipt_voided_no_time") : text("receipt_voided_at", { time: formatVnDateTime(parseInstant(receipt.voidedAt), clock) });
  const voided = receipt.voided ? `<p class="voided" role="status">${escapeHtml(voidLine)}</p>` : "";
  const facts = [
    fact(text("receipt_customer"), receipt.customerCode === null ? missing : codeChip(receipt.customerCode)),
    fact(text("receipt_account"), receipt.bankLastFour === null ? missing : `<span class="masked">${escapeHtml(text("receipt_account_masked", { lastFour: receipt.bankLastFour }))}</span>`),
    fact(text("receipt_date"), `<span class="figure">${when(receipt.recordedAt, clock)}</span>`),
  ].join("");
  const card = [
    `<section class="card${receipt.voided ? " card-voided" : ""}" aria-labelledby="receipt-title" data-receipt="${receipt.voided ? "voided" : "paid"}">`,
    `<header class="card-head"><h1 id="receipt-title">${escapeHtml(text("receipt_title"))}</h1>${status}</header>`,
    voided,
    `<p class="amount-label">${escapeHtml(text("receipt_amount"))}</p>`,
    `<p class="amount">${money(receipt.amount)}</p>`,
    `<dl class="facts">${facts}</dl>`,
    "</section>",
    `<p class="note">${escapeHtml(text("receipt_help"))}</p>`,
  ].join("");
  return documentOf(text("receipt_title"), `${brand()}${card}`);
}

export function missingReceiptHtml(): string {
  const body = `${brand()}<section class="card card-missing" data-receipt="missing"><h1>${escapeHtml(text("receipt_not_found"))}</h1><p class="body">${escapeHtml(text("receipt_not_found_body"))}</p></section>`;
  return documentOf(text("receipt_not_found"), body);
}

function sendPage(reply: FastifyReply, status: number, html: string): string {
  void reply
    .status(status)
    .header("content-type", "text/html; charset=utf-8")
    .header("content-security-policy", RECEIPT_CSP)
    .header("x-content-type-options", "nosniff")
    .header("x-robots-tag", "noindex, nofollow")
    .header("referrer-policy", "no-referrer")
    .header("cache-control", "no-store");
  return html;
}

export function receiptPageRoutes(deps: { readonly ledger: Ledger; readonly clock: Clock }): (app: FastifyInstance) => void {
  return (app) => {
    app.get("/b/:token", async (request, reply) => {
      const { token } = request.params as { token?: unknown };
      const receipt = typeof token === "string" ? findReceipt(deps.ledger.db, token) : null;
      return receipt === null ? sendPage(reply, 404, missingReceiptHtml()) : sendPage(reply, 200, receiptHtml(receipt, deps.clock));
    });
  };
}
