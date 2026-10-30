/**
 * The Cloudflare Access check (AD-18, D48, review H8): every staff route verifies the
 * `Cf-Access-Jwt-Assertion` header, so a request that did not come through Access on the admin
 * host is refused even when it carries a valid staff session. The token must be an RS256 JWT
 * signed by one of the team's published keys, issued by `https://<team domain>`, carry the
 * application's audience tag, and be inside its validity window by the server's clock. A valid
 * token yields the Access identity: its subject id (a service token's common name), never its email.
 *
 * The keys are fetched from `https://<team domain>/cdn-cgi/access/certs` outside any
 * transaction and kept for an hour; a token naming a key not seen yet fetches again, since
 * Cloudflare rotates them. Fetches, failed or not, happen at most once a minute. When a fetch
 * fails, the keys already held keep verifying (with a warning) for up to 24 hours after the last
 * good fetch; past that, or with no keys at all, the check throws and the route answers 401.
 * A published key that cannot be read is skipped; the others still count.
 */
import { createPublicKey, verify, type JsonWebKey, type KeyObject } from "node:crypto";
import { toMs, type Clock } from "@cashback/core";

export const ACCESS_JWT_HEADER = "cf-access-jwt-assertion";

/** A JWT larger than this is not one Access issued. */
const MAX_TOKEN_LENGTH = 8192;
/** Tolerated clock difference for `nbf` and `iat` only; an expired token is never accepted. */
const NOT_BEFORE_LEEWAY_MS = 30_000;
export const KEYS_FRESH_MS = 3_600_000;
export const REFETCH_AFTER_MS = 60_000;
export const KEYS_STALE_LIMIT_MS = 24 * 3_600_000;

export interface AccessKeySource {
  /** The public key with this id, or null when the team publishes none. */
  keyFor(kid: string): Promise<KeyObject | null>;
}

/** Who passed Cloudflare Access: the subject id Access gives the user or service token. */
export interface AccessIdentity {
  readonly subject: string;
}

export interface AccessCheck {
  readonly teamDomain: string;
  readonly audience: string;
  readonly keys: AccessKeySource;
  readonly clock: Clock;
}

export class AccessKeysUnavailableError extends Error {
  readonly code = "access_keys_unavailable";
  constructor() {
    super("access_keys_unavailable");
    this.name = "AccessKeysUnavailableError";
  }
}

export type FetchLike = (url: string, init: { signal: AbortSignal }) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

export interface AccessKeyOptions {
  readonly fetch?: FetchLike;
  /** Told when a fetch failed and the held keys are used past their hour; a log line in production. */
  readonly onStale?: (info: { readonly code: string; readonly keysAgeMs: number }) => void;
}

function keysOf(body: unknown): Map<string, KeyObject> {
  const list = (body as { keys?: unknown } | null)?.keys;
  const keys = new Map<string, KeyObject>();
  if (!Array.isArray(list)) return keys;
  for (const jwk of list as (JsonWebKey & { kid?: unknown })[]) {
    if (typeof jwk !== "object" || jwk === null || typeof jwk.kid !== "string" || jwk.kty !== "RSA") continue;
    try {
      keys.set(jwk.kid, createPublicKey({ key: jwk, format: "jwk" }));
    } catch {
      // One unreadable key never takes the others down with it.
    }
  }
  return keys;
}

/** The team's published keys, cached; production uses the global fetch. */
export function cloudflareAccessKeys(teamDomain: string, clock: Clock, options: AccessKeyOptions = {}): AccessKeySource {
  const fetchFn = options.fetch ?? fetch;
  let keys = new Map<string, KeyObject>();
  let fetchedAt = Number.NEGATIVE_INFINITY;
  let attemptedAt = Number.NEGATIVE_INFINITY;
  let pending: Promise<void> | null = null;
  const load = async (): Promise<void> => {
    attemptedAt = toMs(clock.now());
    const response = await fetchFn(`https://${teamDomain}/cdn-cgi/access/certs`, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new AccessKeysUnavailableError();
    const loaded = keysOf(await response.json());
    if (loaded.size === 0) throw new AccessKeysUnavailableError();
    keys = loaded;
    fetchedAt = toMs(clock.now());
  };
  // Requests that arrive while the keys are being fetched wait for the same fetch.
  const refresh = (): Promise<void> => (pending ??= load().finally(() => (pending = null)));
  return {
    async keyFor(kid) {
      const now = toMs(clock.now());
      const wanted = now - fetchedAt > KEYS_FRESH_MS || !keys.has(kid);
      if (wanted && now - attemptedAt > REFETCH_AFTER_MS) {
        try {
          await refresh();
        } catch (error) {
          if (now - fetchedAt > KEYS_STALE_LIMIT_MS) throw error instanceof AccessKeysUnavailableError ? error : new AccessKeysUnavailableError();
          options.onStale?.({ code: (error as { code?: unknown }).code === "access_keys_unavailable" ? "access_keys_unavailable" : "access_keys_fetch_failed", keysAgeMs: now - fetchedAt });
        }
      }
      if (now - fetchedAt > KEYS_STALE_LIMIT_MS) throw new AccessKeysUnavailableError();
      return keys.get(kid) ?? null;
    },
  };
}

function decodePart(part: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
    return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function claimsHold(claims: Record<string, unknown>, check: AccessCheck): boolean {
  const now = toMs(check.clock.now());
  const audiences = Array.isArray(claims["aud"]) ? claims["aud"] : [claims["aud"]];
  if (!audiences.includes(check.audience)) return false;
  if (claims["iss"] !== `https://${check.teamDomain}`) return false;
  const exp = claims["exp"];
  if (typeof exp !== "number" || exp * 1000 <= now) return false;
  for (const name of ["nbf", "iat"]) {
    const at = claims[name];
    if (at !== undefined && (typeof at !== "number" || at * 1000 > now + NOT_BEFORE_LEEWAY_MS)) return false;
  }
  return true;
}

const SUBJECT = /^[A-Za-z0-9._:@-]{1,128}$/;

/** The Access subject id; a service token has an empty `sub` and its id in `common_name`. */
function identityOf(claims: Record<string, unknown>): AccessIdentity | null {
  const subject = typeof claims["sub"] === "string" && claims["sub"] !== "" ? claims["sub"] : claims["common_name"];
  return typeof subject === "string" && SUBJECT.test(subject) ? { subject } : null;
}

/**
 * The Access identity of a token Access issued for this application that is valid now; null for
 * any other token. Throws only when no key can be had (`AccessKeysUnavailableError`).
 */
export async function verifyAccessJwt(token: string | string[] | undefined, check: AccessCheck): Promise<AccessIdentity | null> {
  if (typeof token !== "string" || token.length > MAX_TOKEN_LENGTH) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [head = "", body = "", signature = ""] = parts;
  const header = decodePart(head);
  const claims = decodePart(body);
  if (header === null || claims === null || header["alg"] !== "RS256" || typeof header["kid"] !== "string") return null;
  if (!claimsHold(claims, check)) return null;
  const identity = identityOf(claims);
  if (identity === null) return null;
  const key = await check.keys.keyFor(header["kid"]);
  if (key === null) return null;
  return verify("RSA-SHA256", Buffer.from(`${head}.${body}`), key, Buffer.from(signature, "base64url")) ? identity : null;
}
