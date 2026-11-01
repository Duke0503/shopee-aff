/**
 * The browser bridge port (AD-14, AD-25, D8, D47). The link job hands one LINK bridge job (one
 * request, so one customer) to the bridge and awaits its answer outside any transaction. Two
 * adapters sit behind it: the in-process fake bridge for dev and tests (Story 5.1), and the real
 * affiliate Chrome over the internal listener's long poll (Story 5.3), which answers the same
 * promise when its result arrives. The composition root picks one by `BRIDGE_MODE`; production
 * never runs the fake.
 *
 * `unavailable` means nobody answered: no bridge took the job in time, or the one that took it
 * went silent (a browser or extension restart). It is not the request's failure, so the link job
 * leaves the submission open and uncounted and hands it out again on a later run.
 */
import type { BridgeJob, BridgeResult } from "@cashback/contracts";

export const BRIDGE_MODES = ["fake", "browser"] as const;
export type BridgeMode = (typeof BRIDGE_MODES)[number];

/** One Shopee custom-link submission: one source URL with this request's two sub_ids. */
export interface LinkBridgeJob {
  readonly jobId: number;
  readonly requestId: string;
  readonly sourceUrl: string;
  /** The requesting customer's id, with the `DEV` prefix in dev (AD-25). */
  readonly subId1: string;
  /** The request id (D47). */
  readonly subId2: string;
}

/**
 * The bridge's answer. A link is attached only after the server checks it carries this job's
 * sub_ids; `resolvedUrl` is a short link's target as the bridge resolved it in the real browser
 * (Story 5.4), answered on the same job's ticket.
 */
export type BridgeLinkResult =
  | { readonly outcome: "link"; readonly url: string; readonly resolvedUrl?: string | null }
  | { readonly outcome: "failed"; readonly reason: string }
  | { readonly outcome: "unavailable"; readonly reason: BridgeUnavailable };

export type BridgeUnavailable = "no_bridge" | "no_answer";

/** One product lookup (Story 5.6): the product link of one request, read on page 1 only; no customer and no sub_ids. */
export interface LookupBridgeJob {
  readonly jobId: number;
  readonly requestId: string;
  readonly url: string;
}

/** A lookup's answer: the page texts as `value` (checked by the server), a failure, or nobody answered. */
export type BridgeLookupResult =
  | { readonly outcome: "value"; readonly value: unknown }
  | { readonly outcome: "failed"; readonly reason: string }
  | { readonly outcome: "unavailable"; readonly reason: BridgeUnavailable };

export interface BridgePort {
  readonly mode: BridgeMode;
  /** Never called inside a transaction; `signal` aborts at shutdown. */
  createLink(job: LinkBridgeJob, signal: AbortSignal): Promise<BridgeLinkResult>;
  /** A product lookup (Story 5.6), never inside a transaction; a bridge without it makes no lookups. */
  lookupProduct?(job: LookupBridgeJob, signal: AbortSignal): Promise<BridgeLookupResult>;
}

/**
 * The real bridge's side of the internal listener (Story 5.3): the long poll of one extension
 * instance takes the next job (or null when the server-side wait ends), and an answer is delivered
 * by its ticket from the instance that holds the job. `deliver` is false for an answer nobody is
 * waiting on any more, or from another instance.
 */
export interface BridgeWorkQueue {
  next(instance: string, signal: AbortSignal): Promise<BridgeJob | null>;
  deliver(result: BridgeResult, instance: string): boolean;
}
