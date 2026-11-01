/**
 * The browser bridge port (AD-14, AD-25, D8, D47). The link job hands one LINK bridge job (one
 * request, so one customer) to the bridge and awaits its answer outside any transaction. Two
 * adapters sit behind it: the in-process fake bridge for dev and tests (Story 5.1), and the real
 * affiliate Chrome over the internal listener's long poll (Story 5.3), which answers the same
 * promise when its result arrives. The composition root picks one by `BRIDGE_MODE`; production
 * never runs the fake.
 */

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
 * sub_ids; `resolvedUrl` is a short link's redirect target, resolved outside any transaction
 * (Story 5.4).
 */
export type BridgeLinkResult = { readonly outcome: "link"; readonly url: string; readonly resolvedUrl?: string | null } | { readonly outcome: "failed"; readonly reason: string };

export interface BridgePort {
  readonly mode: BridgeMode;
  /** Never called inside a transaction; `signal` aborts at shutdown. */
  createLink(job: LinkBridgeJob, signal: AbortSignal): Promise<BridgeLinkResult>;
}
