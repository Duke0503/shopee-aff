/**
 * TikTok Shop links through AccessTrade (AD-22, D17, D47; Story 5.7). The link is made over
 * AccessTrade's Publisher API, as the live `tiktok_provider.py` makes it:
 * `POST /v2/tiktokshop_product_feeds/create_link` with the pasted product link, sub1 = the
 * customer id (the `DEV` prefix in dev) and sub2 = the request id; the answer's `aff_short_url`
 * (or `aff_url`, at the top or under `data`) is the link. No browser is involved.
 *
 * The HTTP call goes through the `HttpPost` port, so tests hand in a fake and never reach
 * AccessTrade. Every failure is an answer with a reason code, never a throw, so the link job
 * counts it like any other failed attempt: a network error or timeout (`accesstrade_unreachable`),
 * a status other than 200 (`accesstrade_http_<status>`), a body without a link
 * (`accesstrade_no_link`, or `accesstrade_not_in_affiliate` when AccessTrade says the product is
 * not in the programme, which fails the request at once). An unread body is dropped so its socket
 * is let go. The sub1 and sub2 an answer echoes are handed on and checked against the request's.
 * The API key travels only in the Authorization header and appears in no
 * reason, message or log line.
 *
 * `fakeAccessTradeLinks` is dev's and the tests' creator: links on the fake bridge host, never a
 * call to AccessTrade.
 */
import { FAKE_BRIDGE_HOST } from "./domain/link-check";
import type { ApiLinkRequest } from "./link-issue.command";
import type { ApiLinkAnswer } from "./link-result.command";

export interface PostAnswer {
  readonly status: number;
  json(): Promise<unknown>;
  /** Drops a body that is not read, so its socket is let go (review item 8). */
  discard(): Promise<void>;
}

/** One POST of a JSON body; `signal` aborts it. */
export type HttpPost = (url: string, headers: Readonly<Record<string, string>>, body: string, signal: AbortSignal) => Promise<PostAnswer>;

export const fetchPost: HttpPost = async (url, headers, body, signal) => {
  const answer = await fetch(url, { method: "POST", headers, body, signal });
  return { status: answer.status, json: () => answer.json(), discard: async () => void (await answer.body?.cancel().catch(() => undefined)) };
};

export interface LinkCreator {
  /** `fake` links are accepted only on the fake host (AD-25). */
  readonly mode: "api" | "fake";
  createLink(request: ApiLinkRequest, signal: AbortSignal): Promise<ApiLinkAnswer>;
}

export interface AccessTradeLinkOptions {
  readonly apiKey: string;
  readonly baseUrl?: string;
  readonly post?: HttpPost;
  readonly timeoutMs?: number;
}

export const ACCESSTRADE_LINK_PATH = "/v2/tiktokshop_product_feeds/create_link";
export const ACCESSTRADE_LINK_TIMEOUT_MS = 10_000;
/** AccessTrade's answers for a product outside the affiliate programme (the live provider's list). */
const NOT_IN_AFFILIATE = /16666100|DL005|Affiliate Center|Precondition Required|not part of the campaign/i;

const field = (value: unknown, key: string): unknown => (typeof value === "object" && value !== null ? (value as Record<string, unknown>)[key] : undefined);

function linkOf(body: unknown): string | null {
  for (const holder of [field(body, "data"), body]) {
    for (const key of ["aff_short_url", "aff_url"]) {
      const value = field(holder, key);
      if (typeof value === "string" && value !== "") return value;
    }
  }
  return null;
}

const text = (value: unknown): string | null => (typeof value === "string" || typeof value === "number" ? String(value) : null);

/** The sub1 and sub2 the answer carries back, at the top or under `data` (review item 4). */
function echoedOf(body: unknown): { sub1: string | null; sub2: string | null } {
  const pick = (keys: readonly string[]): string | null => {
    const found = [field(body, "data"), body].flatMap((holder) => keys.map((key) => text(field(holder, key))));
    return found.find((value): value is string => value !== null && value !== "") ?? null;
  };
  return { sub1: pick(["sub1", "sub_1"]), sub2: pick(["sub2", "sub_2"]) };
}

function refusalOf(body: unknown): string {
  const said = [field(body, "code"), field(body, "message"), field(body, "error")].map((v) => (typeof v === "string" || typeof v === "number" ? String(v) : "")).join(" ");
  return NOT_IN_AFFILIATE.test(said) ? "accesstrade_not_in_affiliate" : "accesstrade_no_link";
}

export function accessTradeLinkCreator(options: AccessTradeLinkOptions): LinkCreator {
  const base = (options.baseUrl ?? "https://api.accesstrade.vn").replace(/\/+$/, "");
  const auth = options.apiKey.startsWith("Token ") ? options.apiKey : `Token ${options.apiKey}`;
  const post = options.post ?? fetchPost;
  return {
    mode: "api",
    async createLink(request, outer) {
      const signal = AbortSignal.any([outer, AbortSignal.timeout(options.timeoutMs ?? ACCESSTRADE_LINK_TIMEOUT_MS)]);
      const body = JSON.stringify({ product_url: request.sourceUrl, sub1: request.subId1, sub2: request.subId2 });
      let answer: PostAnswer;
      let parsed: unknown;
      try {
        answer = await post(`${base}${ACCESSTRADE_LINK_PATH}`, { Authorization: auth, "Content-Type": "application/json" }, body, signal);
        if (answer.status !== 200) {
          await answer.discard().catch(() => undefined);
          return { outcome: "failed", reason: `accesstrade_http_${answer.status}` };
        }
        parsed = await answer.json();
      } catch {
        // A network error, a timeout or a body that is not JSON; the cause may carry the request, so it is dropped.
        if (outer.aborted) throw outer.reason;
        return { outcome: "failed", reason: "accesstrade_unreachable" };
      }
      const url = linkOf(parsed);
      return url === null ? { outcome: "failed", reason: refusalOf(parsed) } : { outcome: "link", url, echoedSubIds: echoedOf(parsed) };
    },
  };
}

export function fakeAccessTradeLinks(): LinkCreator {
  return {
    mode: "fake",
    createLink: async (request) => ({ outcome: "link", url: `https://${FAKE_BRIDGE_HOST}/at/${request.subId2}?sub1=${request.subId1}&sub2=${request.subId2}` }),
  };
}
