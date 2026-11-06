/**
 * The text of the daily link report to the DP Business group (D66), with the words from
 * packages/labels/vi/link-report.json: the totals, then one line per customer by most requests, each
 * followed by its failed products. A merged record counts under its survivor; the guest account is
 * a guest line; an erased, unknown or nameless customer is the id alone, and the products of an
 * erased or unknown customer are left out, as in D65. Every value from outside is put on one line,
 * cut and escaped for Telegram's HTML mode, in that order, so a name cannot add lines and no line can
 * outgrow a message. The report is split only at a line break, so no tag or entity is ever cut in
 * two, and a customer stays with its failed products unless that block alone outgrows a message.
 */
import { vnDateRange, type VnDate } from "@cashback/core";
import LABELS from "@cashback/labels/vi/link-report.json" with { type: "json" };

import type { LedgerDb } from "../../platform/db/ledger";
import { customerCardsOf, ledgerOwnerOf } from "../identity/index";
import { linkCountsOfDay, type CustomerLinkCounts } from "../linking/index";

/** Telegram's limit on one message. It counts the text after its entities are read, so counting the raw HTML is on the safe side. */
export const TELEGRAM_TEXT_MAX = 4096;

/** The most code points of one name or product shown; even all escaped, a line stays far below one message. */
const VALUE_MAX = 200;

const fill = (text: string, values: Record<string, string>): string => text.replace(/\{(\w+)\}/g, (all, key: string) => values[key] ?? all);

const escapeHtml = (text: string): string => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const oneLine = (text: string): string => text.replace(/[\p{Cc}\p{Zl}\p{Zp}]+/gu, " ").trim();

const shown = (text: string): string => escapeHtml(Array.from(oneLine(text)).slice(0, VALUE_MAX).join(""));

interface ReportLine extends CustomerLinkCounts {
  readonly guest: boolean;
  readonly erased: boolean;
}

/** The counts per person, merged records under their survivor, by most requests. */
function reportLines(db: LedgerDb, counts: readonly CustomerLinkCounts[]): ReportLine[] {
  const lines = new Map<string, ReportLine>();
  for (const count of counts) {
    const owner = ledgerOwnerOf(db, count.customerId);
    const customerId = owner?.customerId ?? count.customerId;
    const before = lines.get(customerId);
    lines.set(customerId, {
      customerId,
      guest: owner?.role === "HOUSE",
      erased: owner === null || owner.erasedAt !== null,
      requests: (before?.requests ?? 0) + count.requests,
      succeeded: (before?.succeeded ?? 0) + count.succeeded,
      failed: (before?.failed ?? 0) + count.failed,
      waiting: (before?.waiting ?? 0) + count.waiting,
      failedProducts: [...(before?.failedProducts ?? []), ...count.failedProducts],
    });
  }
  return [...lines.values()].sort((a, b) => b.requests - a.requests || (a.customerId < b.customerId ? -1 : 1));
}

function customerText(line: ReportLine, displayName: string | null | undefined): string {
  if (line.guest) return LABELS.customer_guest;
  const name = line.erased ? "" : shown(displayName ?? "");
  return name === "" ? fill(LABELS.customer_id, { id: shown(line.customerId) }) : fill(LABELS.customer_named, { name, id: shown(line.customerId) });
}

const sum = (lines: readonly ReportLine[], key: "requests" | "succeeded" | "failed" | "waiting"): number => lines.reduce((total, line) => total + line[key], 0);

function customerLine(line: ReportLine, displayName: string | null | undefined): string {
  return fill(LABELS.line_customer, {
    customer: customerText(line, displayName),
    products: String(line.requests),
    succeeded: String(line.succeeded),
    failed: String(line.failed),
    waiting: line.waiting === 0 ? "" : fill(LABELS.customer_waiting, { count: String(line.waiting) }),
  });
}

/** The report as blocks of lines: the totals, then each customer with its failed products. */
function reportBlocks(db: LedgerDb, date: VnDate, lines: readonly ReportLine[]): string[][] {
  const [year, month, day] = date.split("-");
  const header = fill(LABELS.header, { date: `${day}/${month}/${year}` });
  if (lines.length === 0) return [[header, LABELS.quiet]];
  const cards = customerCardsOf(db, lines.map((line) => line.customerId));
  return [
    [
      header,
      fill(LABELS.line_products, { products: String(sum(lines, "requests")), customers: String(lines.length) }),
      fill(LABELS.line_succeeded, { count: String(sum(lines, "succeeded")) }),
      fill(LABELS.line_failed, { count: String(sum(lines, "failed")) }),
      fill(LABELS.line_waiting, { count: String(sum(lines, "waiting")) }),
      "",
    ],
    ...lines.map((line) => [customerLine(line, cards.get(line.customerId)?.displayName), ...(line.erased ? [] : line.failedProducts.map((product) => fill(LABELS.line_failed_product, { product: shown(product) })))]),
  ];
}

/** Blocks into messages of at most `max` characters, in order; only a block that alone outgrows a message splits, line by line. */
export function splitReportBlocks(blocks: readonly (readonly string[])[], max = TELEGRAM_TEXT_MAX): string[] {
  const parts: string[] = [];
  let current = "";
  const add = (text: string): void => {
    if (current === "") {
      current = text;
    } else if (current.length + 1 + text.length <= max) {
      current = `${current}\n${text}`;
    } else {
      parts.push(current.trimEnd());
      current = text;
    }
  };
  for (const block of blocks) {
    const whole = block.join("\n");
    if (whole.length <= max) add(whole);
    else block.forEach(add);
  }
  return current === "" ? parts : [...parts, current.trimEnd()];
}

export interface DailyLinkReport {
  readonly parts: readonly string[];
  readonly customers: number;
  readonly requests: number;
}

/** The report of one Vietnam day, by the status each request has now; call inside `tx`, so it reads one state. */
export function dailyLinkReportOf(db: LedgerDb, date: VnDate): DailyLinkReport {
  const lines = reportLines(db, linkCountsOfDay(db, vnDateRange(date, date)));
  return { parts: splitReportBlocks(reportBlocks(db, date, lines)), customers: lines.length, requests: sum(lines, "requests") };
}
