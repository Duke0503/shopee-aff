/**
 * The cutover's smoke checks (Stories 8.7 AC3 and 8.8): once the new server runs on the imported
 * ledger, its health route, the website, a sample of the old share links `/s/<code>` and of the
 * old receipt links `/b/<token>` must answer 200, on this machine and, at go-live, through the
 * tunnel's public host too, and by `localhost` and [::1] (the tunnel's route names `localhost`,
 * which Windows may resolve to ::1 first). Share links are opened with HEAD, so no click is recorded. The sample
 * is spread evenly over the ledger in key order (the same every run) and only over share codes
 * whose request has a link. The answer counts checks and names paths by kind; a code or token is
 * never printed (they open a customer's link and receipt).
 */
import type BetterSqlite3 from "better-sqlite3";

export type HttpProbe = (url: string, options: { readonly method: "GET" | "HEAD"; readonly host?: string }) => Promise<number>;

export interface SmokeTarget {
  /**
   * `local`: the listener by 127.0.0.1; `localhost`: by the name the tunnel's route uses, which
   * Windows may resolve to ::1 first; `ipv6`: by [::1]; `public`: through the tunnel.
   */
  readonly name: "local" | "localhost" | "ipv6" | "public";
  readonly base: string;
  /** The Host header to send, when the base URL is not the host the server serves. */
  readonly host?: string;
}

export interface SmokeResult {
  readonly ok: boolean;
  readonly checks: number;
  readonly failed: readonly { readonly target: string; readonly kind: string; readonly index: number; readonly status: number }[];
  readonly sampled: { readonly shareCodes: number; readonly receipts: number };
}

/** `n` items spread evenly over `all`, first and last included. */
export function spread<T>(all: readonly T[], n: number): T[] {
  if (all.length <= n) return [...all];
  if (n <= 1) return all.slice(0, n);
  return Array.from({ length: n }, (_, i) => all[Math.floor((2 * i * (all.length - 1) + (n - 1)) / (2 * (n - 1)))] as T);
}

export interface SmokeSample {
  readonly codes: string[];
  readonly tokens: string[];
  /** How many the ledger holds, so a short sample is seen. */
  readonly available: { readonly shareCodes: number; readonly receipts: number };
}

export function smokeSample(ledger: BetterSqlite3.Database, n: number): SmokeSample {
  const codes = (ledger.prepare("SELECT s.code FROM share_codes s JOIN link_requests r ON r.request_id = s.request_id WHERE r.affiliate_url IS NOT NULL ORDER BY s.request_id").all() as { code: string }[]).map((r) => r.code);
  const tokens = (ledger.prepare("SELECT receipt_token AS token FROM payouts WHERE receipt_token IS NOT NULL ORDER BY payout_id").all() as { token: string }[]).map((r) => r.token);
  return { codes: spread(codes, n), tokens: spread(tokens, n), available: { shareCodes: codes.length, receipts: tokens.length } };
}

interface Check {
  readonly kind: string;
  readonly index: number;
  readonly path: string;
  readonly method: "GET" | "HEAD";
}

function checksFor(target: SmokeTarget, sample: { codes: readonly string[]; tokens: readonly string[] }): Check[] {
  const checks: Check[] = [
    { kind: "health", index: 0, path: "/api/health", method: "GET" },
    { kind: "website", index: 0, path: "/", method: "GET" },
  ];
  // The full sample runs on 127.0.0.1; on every other route one share link and one receipt prove it.
  const codes = target.name === "local" ? sample.codes : sample.codes.slice(0, 1);
  const tokens = target.name === "local" ? sample.tokens : sample.tokens.slice(0, 1);
  codes.forEach((code, index) => checks.push({ kind: "share", index, path: `/s/${encodeURIComponent(code)}`, method: "HEAD" }));
  tokens.forEach((token, index) => checks.push({ kind: "receipt", index, path: `/b/${encodeURIComponent(token)}`, method: "GET" }));
  return checks;
}

export async function runSmoke(targets: readonly SmokeTarget[], sample: { codes: readonly string[]; tokens: readonly string[] }, probe: HttpProbe): Promise<SmokeResult> {
  const failed: SmokeResult["failed"][number][] = [];
  let checks = 0;
  for (const target of targets) {
    for (const check of checksFor(target, sample)) {
      checks += 1;
      const status = await probe(`${target.base.replace(/\/+$/, "")}${check.path}`, { method: check.method, ...(target.host ? { host: target.host } : {}) }).catch(() => 0);
      if (status !== 200) failed.push({ target: target.name, kind: check.kind, index: check.index, status });
    }
  }
  return { ok: failed.length === 0, checks, failed, sampled: { shareCodes: sample.codes.length, receipts: sample.tokens.length } };
}
