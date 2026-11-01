/**
 * The bridge's only network calls: the long poll and the answer post to the server's internal
 * listener on 127.0.0.1 (bridge-settings.ts refuses any other address), each with `X-Bridge-Token`
 * and this extension's `X-Bridge-Instance`.
 * The extension calls nothing else: no Shopee API, no third party (D8, INV-10). A job that does not
 * match the contract is answered `bad_job` when its ticket can be read, and never worked.
 */
import { BRIDGE_INSTANCE_HEADER, BRIDGE_NEXT_PATH, BRIDGE_RESULTS_PATH, BRIDGE_TOKEN_HEADER, bridgeJobSchema, bridgeResultAcceptedSchema, type BridgeJob, type BridgeResult } from "@cashback/contracts";

import type { ConnectedSettings } from "./bridge-settings";

export interface HttpAnswer {
  readonly status: number;
  json(): Promise<unknown>;
}

/** `fetch` as the service worker has it, narrowed to what is used. */
export type Fetch = (url: string, init: { method: "GET" | "POST"; headers: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<HttpAnswer>;

export type Poll = { kind: "job"; job: BridgeJob } | { kind: "idle" } | { kind: "unauthorized" };

export class ServerTrouble extends Error {
  constructor(readonly status: number) {
    super(`server answered ${status}`);
    this.name = "ServerTrouble";
  }
}

export interface ServerClient {
  next(signal?: AbortSignal): Promise<Poll>;
  /** True when the server was still waiting on this answer. */
  post(result: BridgeResult): Promise<boolean>;
}

const ticketOf = (body: unknown): string | null => {
  const ticket = typeof body === "object" && body !== null ? (body as { ticket?: unknown }).ticket : undefined;
  return typeof ticket === "string" && /^[a-f0-9]{32}$/.test(ticket) ? ticket : null;
};

export function serverClient(settings: ConnectedSettings, fetchFn: Fetch): ServerClient {
  const headers = { [BRIDGE_TOKEN_HEADER]: settings.token, [BRIDGE_INSTANCE_HEADER]: settings.instance };
  const post = async (result: BridgeResult): Promise<boolean> => {
    const res = await fetchFn(`${settings.serverOrigin}${BRIDGE_RESULTS_PATH}`, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(result) });
    if (res.status === 401) return false;
    if (res.status !== 200) throw new ServerTrouble(res.status);
    const body = bridgeResultAcceptedSchema.safeParse(await res.json());
    return body.success && body.data.accepted;
  };
  return {
    post,
    async next(signal) {
      const res = await fetchFn(`${settings.serverOrigin}${BRIDGE_NEXT_PATH}`, { method: "GET", headers, ...(signal ? { signal } : {}) });
      if (res.status === 204) return { kind: "idle" };
      if (res.status === 401) return { kind: "unauthorized" };
      if (res.status !== 200) throw new ServerTrouble(res.status);
      const body = await res.json();
      const job = bridgeJobSchema.safeParse(body);
      if (job.success) return { kind: "job", job: job.data };
      const ticket = ticketOf(body);
      if (ticket !== null) await post({ ticket, outcome: "failed", reason: "bad_job" });
      return { kind: "idle" };
    },
  };
}
