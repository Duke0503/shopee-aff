/**
 * The browser bridge protocol (AD-14, AD-18, AD-20, D8, D47; Story 5.3). The bridge extension in
 * the affiliate Chrome long-polls `GET /internal/bridge/next` and posts each answer to
 * `POST /internal/bridge/results`, both on the internal listener (127.0.0.1) with `X-Bridge-Token`.
 * `next` answers 200 with one job or 204 when the server-side wait ended with no work. Every job
 * carries a ticket; an answer counts only for the ticket the server is waiting on, so an answer from
 * before a restart is dropped. Every call also carries `X-Bridge-Instance`, the extension's own id
 * kept in its profile: the job out belongs to that instance, so a second browser never gets it
 * (no duplicate submission) and the same instance polling again after a restart gets it back. Only link jobs are worked today; lookup (Story 5.6) and report page
 * (Story 5.9) jobs travel the same way and are answered `unsupported` until then.
 */
import { SHOPEE_SOURCE_MAX_LENGTH } from "@cashback/core";
import { z } from "zod";

export const BRIDGE_TOKEN_HEADER = "x-bridge-token";
export const BRIDGE_INSTANCE_HEADER = "x-bridge-instance";
/** An instance id: 32 lowercase hex characters, made once per extension install. */
export const BRIDGE_INSTANCE_PATTERN = /^[a-f0-9]{32}$/;
export const BRIDGE_NEXT_PATH = "/internal/bridge/next";
export const BRIDGE_RESULTS_PATH = "/internal/bridge/results";

const alnum = z.string().regex(/^[A-Za-z0-9]+$/).max(64);
const ticket = z.string().regex(/^[a-f0-9]{32}$/);
const httpsUrl = z.string().max(2048).regex(/^https:\/\//);

/** The kinds in their order of service: a link is never held up by more than one report page. */
export const BRIDGE_JOB_KINDS = ["link", "lookup", "report"] as const;
export type BridgeJobKind = (typeof BRIDGE_JOB_KINDS)[number];

export const bridgeLinkJobSchema = z.strictObject({
  ticket,
  kind: z.literal("link"),
  /** The customer's Shopee product link, as the request keeps it. */
  sourceUrl: z.string().min(1).max(SHOPEE_SOURCE_MAX_LENGTH).regex(/^https?:\/\//),
  /** The requesting customer's id (DEV prefix in dev); the only customer in this submission (D7). */
  subId1: alnum,
  /** The request id (D47). */
  subId2: alnum,
  /** How long the bridge may work on it; the server stops waiting a little after. */
  timeoutMs: z.number().int().min(1_000).max(300_000),
});

export const bridgeLookupJobSchema = z.strictObject({ ticket, kind: z.literal("lookup"), url: z.string().min(1).max(2048), timeoutMs: z.number().int().min(1_000).max(300_000) });
export const bridgeReportJobSchema = z.strictObject({ ticket, kind: z.literal("report"), page: z.number().int().min(1).max(1_000), timeoutMs: z.number().int().min(1_000).max(300_000) });

export const bridgeJobSchema = z.discriminatedUnion("kind", [bridgeLinkJobSchema, bridgeLookupJobSchema, bridgeReportJobSchema]);
export type BridgeJob = z.infer<typeof bridgeJobSchema>;
export type BridgeLinkJob = z.infer<typeof bridgeLinkJobSchema>;

/**
 * Why the bridge could not make a link. `captcha` and `login_redirect` are whole-session states
 * (Story 5.5 pauses or retries on them); the others are about this one submission or page.
 */
export const BRIDGE_FAILURES = ["captcha", "login_redirect", "page_not_ready", "form_missing", "submit_failed", "shopee_refused", "no_link", "script_error", "bad_job", "unsupported"] as const;
export type BridgeFailure = (typeof BRIDGE_FAILURES)[number];

export const bridgeResultSchema = z.discriminatedUnion("outcome", [
  z.strictObject({ ticket, outcome: z.literal("link"), url: httpsUrl }),
  z.strictObject({ ticket, outcome: z.literal("failed"), reason: z.enum(BRIDGE_FAILURES) }),
  z.strictObject({ ticket, outcome: z.literal("value"), value: z.json() }),
]);
export type BridgeResult = z.infer<typeof bridgeResultSchema>;

export const bridgeResultAcceptedSchema = z.object({ accepted: z.boolean() });
export type BridgeResultAccepted = z.infer<typeof bridgeResultAcceptedSchema>;
