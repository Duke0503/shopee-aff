/**
 * The one page script that reads the network: the conversion report's own list, asked for by the
 * report page itself, in the operator's real tab, exactly as the live extension did it for months
 * (`report_reader.py` `_FETCH_JS` on main, run by CDP `Runtime.evaluate` in the page's main world).
 * The page is the affiliate dashboard the operator is signed in to; the request is a plain
 * same-origin GET with the page's own cookies (`credentials: "include"`), no header added and no
 * signature built, so it is the page's call through the real browser session (D8, INV-10), not a
 * call from the server or the worker. Only this path is ever asked for, one page per job, page 1
 * up to the server's cap (20 pages of 50, as live).
 *
 * Unlike the scripts of page-scripts.ts it awaits one answer (the request), but it sets no timer
 * and never waits on the page: the worker bounds how long it may take. It answers the list and the
 * total as the report sent them, never converted; on anything else it answers only a reason code,
 * never the body.
 */
import type { BridgeFailure } from "@cashback/contracts";

export interface ReportApiInput {
  /** The report list's path on the dashboard's own origin. */
  readonly path: string;
  readonly page: number;
  readonly pageSize: number;
  readonly purchaseTimeStart: number;
  readonly purchaseTimeEnd: number;
}

/** Why a report list could not be read; each is a code the server logs, never a body. */
export type ReportApiFailure = Extract<BridgeFailure, `report_${string}`>;

export type ReportApiAnswer = { readonly ok: true; readonly list: unknown[]; readonly total: number | null } | { readonly ok: false; readonly why: ReportApiFailure };

/** One page of the report list, asked for by the page (main world) with its own session. */
export async function fetchReportList(input: ReportApiInput): Promise<ReportApiAnswer> {
  const query = `page_size=${input.pageSize}&page_num=${input.page}&purchase_time_s=${input.purchaseTimeStart}&purchase_time_e=${input.purchaseTimeEnd}`;
  let response: Response;
  try {
    response = await fetch(`${input.path}?${query}`, { credentials: "include" });
  } catch {
    return { ok: false, why: "report_network_error" };
  }
  if (!response.ok) return { ok: false, why: "report_http_error" };
  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    return { ok: false, why: "report_not_json" };
  }
  if (parsed === null || typeof parsed !== "object") return { ok: false, why: "report_bad_answer" };
  const answer = parsed as { error?: unknown; data?: unknown };
  if (answer.error) return { ok: false, why: "report_api_error" };
  const data = answer.data === null || answer.data === undefined ? {} : answer.data;
  if (typeof data !== "object") return { ok: false, why: "report_bad_answer" };
  const list = (data as { list?: unknown }).list ?? [];
  const total = (data as { total?: unknown }).total;
  if (!Array.isArray(list)) return { ok: false, why: "report_bad_answer" };
  return { ok: true, list, total: typeof total === "number" && Number.isSafeInteger(total) && total >= 0 ? total : null };
}
