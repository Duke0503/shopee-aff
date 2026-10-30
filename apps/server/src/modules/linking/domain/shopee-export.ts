/**
 * Shopee's downloadable conversion report (decision H10), the CSV the live
 * `src/cashback/shopee/report_importer.py` reads, read as reference and unchanged. Header names
 * vary by locale, so the columns come from a mapping in the live `report_mapping.json` shape, or
 * are guessed from the headers the way `detect_mapping` guesses them (lower case, accents
 * removed, only a-z0-9 kept). Two optional columns are new: `item_id` and `order_status`. The
 * header tokens and the status words live in JSON beside this file, so no Vietnamese is in code.
 *
 * Where the live importer made one order per line and kept only one status, every line with
 * the same order id becomes an item of one row (R3). A status word is read as the live
 * `classify_status` reads it (normalised like a header) and means what Story 1.11 says: the
 * Shopee status map plus the export's own words (shopee-export-statuses.json); a word neither
 * lists is UNKNOWN and freezes, never guessed. A line without an order id is skipped and
 * counted, as the live importer skips it. Amounts are plain dong text only ("27.000",
 * "27,000", "27 000 d", "27000.50"): one thousands style and a fraction of one or two digits,
 * converted by `fromNetworkUnits`, so a fraction rounds half-up (D1) where the live code cut it
 * off. Anything else ("2.7E+04", "1e5", a minus sign, letters) freezes its own order.
 */
import type { Instant } from "@cashback/core";

import { mapStatus, type KnownNetworkStatus, type NetworkStatus, type StatusMap } from "./network-status";
import { readAmount, readPurchaseTime, uniqueProblems, type ReportItem, type ReportRow, type RowProblem } from "./report-row";
import HEADERS from "./shopee-export-headers.json" with { type: "json" };
import STATUS_WORDS from "./shopee-export-statuses.json" with { type: "json" };
import { SHOPEE_STATUS_MAP } from "./shopee-report";

export const SHOPEE_EXPORT_AMOUNT_SCALE = 1;

export const SHOPEE_EXPORT_FIELDS = [
  "order_id",
  "order_value",
  "commission",
  "status",
  "order_time",
  "sub_id1",
  "sub_id2",
  "sub_id3",
  "sub_id4",
  "sub_id5",
  "item_id",
  "order_status",
] as const;
export type ShopeeExportField = (typeof SHOPEE_EXPORT_FIELDS)[number];

/** Which header holds which field; an empty string means absent (report_mapping.json). */
export type ShopeeExportMapping = Readonly<Record<ShopeeExportField, string>>;

export const SHOPEE_EXPORT_REQUIRED: readonly ShopeeExportField[] = ["order_id", "commission", "status", "sub_id1"];

const AUTO_DETECT = HEADERS as unknown as Readonly<Record<ShopeeExportField, readonly string[]>>;

const SUB_ID_FIELDS = ["sub_id1", "sub_id2", "sub_id3", "sub_id4", "sub_id5"] as const;

/** report_importer.py `_normalise_header`: lower case, the stroked d mapped, accents dropped, only a-z0-9. */
export function normaliseHeader(header: string): string {
  const text = header.trim().toLowerCase().replace(/\u0111/g, "d");
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]/g, "");
}

/** A best-effort guess, as `detect_mapping`; `order_status` only when it is not the status column already. */
export function detectShopeeExportMapping(headers: readonly string[]): ShopeeExportMapping {
  const lookup = new Map<string, string>();
  for (const header of headers) if (!lookup.has(normaliseHeader(header))) lookup.set(normaliseHeader(header), header);
  const guess = Object.fromEntries(SHOPEE_EXPORT_FIELDS.map((field) => [field, AUTO_DETECT[field].map((c) => lookup.get(c)).find((h) => h !== undefined) ?? ""])) as Record<ShopeeExportField, string>;
  if (guess.order_status === guess.status) guess.order_status = "";
  return guess;
}

/** A mapping read from report_mapping.json: unknown keys are ignored, missing ones are absent. */
export function shopeeExportMapping(raw: Readonly<Record<string, unknown>>): ShopeeExportMapping {
  return Object.fromEntries(SHOPEE_EXPORT_FIELDS.map((field) => [field, typeof raw[field] === "string" ? (raw[field] as string) : ""])) as Record<ShopeeExportField, string>;
}

/** RFC 4180 CSV: quoted fields with doubled quotes, CRLF or LF, a leading byte-order mark dropped. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const body = text.startsWith("\uFEFF") ? text.slice(1) : text;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i] as string;
    if (quoted) {
      if (ch === '"' && body[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && body[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length > 0) rows.push([...row, field]);
  return rows;
}

const isBlank = (row: readonly string[]): boolean => row.every((cell) => cell.trim() === "");

/** A currency mark the export may write after the amount: the dong sign, the stroked d, d or VND. */
const CURRENCY = /\s*(?:\u20AB|\u0111|d|vnd)$/i;

/** Plain amounts: digits, or 1-3 digits then groups of 3 in one style, then an optional fraction of 1-2 digits. */
const PLAIN_AMOUNTS: readonly { pattern: RegExp; group: string; fraction: RegExp }[] = [
  { pattern: /^\d+(?:[.,]\d{1,2})?$/, group: "", fraction: /[.,]/ },
  { pattern: /^\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?$/, group: ".", fraction: /,/ },
  { pattern: /^\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?$/, group: ",", fraction: /\./ },
  { pattern: /^\d{1,3}(?: \d{3})+(?:[.,]\d{1,2})?$/, group: " ", fraction: /[.,]/ },
];

/**
 * A dong amount as the export writes it, through `fromNetworkUnits`: absent when the cell holds
 * no figure; a plain amount otherwise, or the problem `invalid_amount`.
 */
export function readExportAmount(cell: string | undefined, problems: RowProblem[]): number | null {
  const text = (cell ?? "").trim().replace(CURRENCY, "");
  // An empty cell or a dash (Shopee's "no figure yet") is absent; any other text must be a plain amount.
  if (text === "" || /^-+$/.test(text)) return null;
  const style = PLAIN_AMOUNTS.find((s) => s.pattern.test(text));
  if (style === undefined) {
    problems.push("invalid_amount");
    return null;
  }
  const [whole = "", fraction] = text.split(style.fraction);
  const digits = style.group === "" ? whole : whole.split(style.group).join("");
  return readAmount(fraction === undefined ? digits : `${digits}.${fraction}`, SHOPEE_EXPORT_AMOUNT_SCALE, problems);
}

/** A status word normalised the way `classify_status` normalises it: `_normalise_header`. */
export const normaliseExportStatus = (raw: string): string => normaliseHeader(raw);

/** The Story 1.11 Shopee map and the export's words, all keyed by the normalised word; a word with two meanings is refused at load. */
function exportStatusMap(): StatusMap {
  const map: Record<string, KnownNetworkStatus> = Object.create(null) as Record<string, KnownNetworkStatus>;
  const put = (word: string, status: KnownNetworkStatus) => {
    const key = normaliseExportStatus(word);
    if (key === "" || (Object.hasOwn(map, key) && map[key] !== status)) throw new Error(`export status map: "${word}" is empty or has two meanings`);
    map[key] = status;
  };
  for (const [word, status] of Object.entries(SHOPEE_STATUS_MAP)) put(word, status);
  for (const status of ["AWAITING", "APPROVED", "CANCELLED"] as const) for (const word of STATUS_WORDS[status]) put(word, status);
  return Object.freeze(map);
}

export const SHOPEE_EXPORT_STATUS_MAP = exportStatusMap();

export function mapExportStatus(raw: string): NetworkStatus {
  return mapStatus(SHOPEE_EXPORT_STATUS_MAP, normaliseExportStatus(raw));
}

export interface ShopeeExportRow {
  readonly row: ReportRow;
  readonly purchasedAt: Instant | null;
}

export interface ShopeeExport {
  readonly headers: readonly string[];
  readonly rows: readonly ShopeeExportRow[];
  /** Lines without an order id, skipped as the live importer skips them. */
  readonly skippedLines: number;
}

type Line = Readonly<Record<ShopeeExportField, string>>;

/** The order's status as written; lines of one order that disagree on it cannot be read (UNKNOWN). */
function orderStatusOf(lines: readonly Line[]): { raw: string; status: NetworkStatus } | null {
  const written = [...new Set(lines.map((l) => l.order_status.trim()).filter((s) => s !== ""))];
  if (written.length === 0) return null;
  const meanings = new Set(written.map(mapExportStatus));
  return { raw: written.join("|"), status: meanings.size === 1 ? [...meanings][0] as NetworkStatus : "UNKNOWN" };
}

function readExportOrder(orderId: string, lines: readonly Line[]): ShopeeExportRow {
  const problems: RowProblem[] = [];
  const orderStatus = orderStatusOf(lines);
  const items: ReportItem[] = lines.map((line, i) => {
    const written = line.status.trim();
    const rawStatus = written === "" ? (orderStatus?.raw ?? "") : written;
    const commission = readExportAmount(line.commission, problems);
    return {
      itemId: line.item_id.trim() || String(i + 1),
      rawStatus,
      status: written === "" ? (orderStatus?.status ?? "UNKNOWN") : mapExportStatus(written),
      commissionParts: commission === null ? [] : [commission],
      value: readExportAmount(line.order_value, problems),
    };
  });
  const first = lines[0] as Line;
  if (new Set(lines.map((l) => l.sub_id1.trim())).size > 1) problems.push("conflicting_sub_ids");
  const row: ReportRow = {
    network: "shopee",
    orderId,
    rawOrderStatus: orderStatus?.raw ?? null,
    orderStatus: orderStatus?.status ?? null,
    items,
    subIds: SUB_ID_FIELDS.map((field) => first[field].trim()),
    problems: uniqueProblems(problems),
  };
  return { row, purchasedAt: readPurchaseTime(first.order_time.trim()) };
}

/** Reads the export with the given mapping, or the guessed one; throws when a required column is missing. */
export function readShopeeExport(text: string, mapping?: ShopeeExportMapping): ShopeeExport {
  const table = parseCsv(text);
  const headerAt = table.findIndex((row) => !isBlank(row));
  const headers = headerAt < 0 ? [] : (table[headerAt] as string[]).map((h) => h.trim());
  const used = mapping ?? detectShopeeExportMapping(headers);
  const column = new Map(SHOPEE_EXPORT_FIELDS.map((field) => [field, used[field] === "" ? -1 : headers.indexOf(used[field])]));
  const missing = SHOPEE_EXPORT_REQUIRED.filter((field) => column.get(field) === -1);
  if (missing.length > 0) throw new ShopeeExportMappingError(missing);
  const groups = new Map<string, Line[]>();
  let skippedLines = 0;
  for (const cells of table.slice(headerAt + 1)) {
    if (isBlank(cells)) continue;
    const line = Object.fromEntries(SHOPEE_EXPORT_FIELDS.map((field) => [field, cells[column.get(field) ?? -1] ?? ""])) as Line;
    const orderId = line.order_id.trim();
    if (orderId === "") {
      skippedLines++;
      continue;
    }
    groups.set(orderId, [...(groups.get(orderId) ?? []), line]);
  }
  return { headers, rows: [...groups].map(([orderId, lines]) => readExportOrder(orderId, lines)), skippedLines };
}

export class ShopeeExportMappingError extends Error {
  readonly code = "report_mapping_incomplete";
  constructor(readonly missing: readonly ShopeeExportField[]) {
    super(`the Shopee export mapping misses required columns: ${missing.join(", ")}`);
    this.name = "ShopeeExportMappingError";
  }
}
