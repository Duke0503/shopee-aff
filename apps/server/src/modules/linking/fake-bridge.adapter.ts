/**
 * The fake browser bridge (AD-25, Story 5.1): an in-process adapter behind the bridge port that
 * answers every LINK job at once with a link that carries the job's own sub_ids. It talks to no
 * browser and no network, so dev and tests never touch the affiliate session (D8). Its links are
 * on the reserved `.invalid` domain (RFC 2606), so a fake link can never open a real shop page or
 * credit anyone; the composition root refuses it in production, and only a fake-bridge run
 * accepts that host when the link is checked. A product lookup (Story 5.6) answers "not found"
 * unless the caller hands in the page texts to answer, so dev never shows a made-up estimate.
 */
import type { BridgeLookupValue } from "@cashback/contracts";

import type { BridgeLinkResult, BridgeLookupResult, BridgePort, LinkBridgeJob, LookupBridgeJob } from "../../platform/ports/bridge.port";
import { FAKE_BRIDGE_HOST } from "./domain/link-check";

export { FAKE_BRIDGE_HOST };

export function fakeLinkUrl(job: Pick<LinkBridgeJob, "subId1" | "subId2">): string {
  return `https://${FAKE_BRIDGE_HOST}/l/${job.subId2}?sub_id1=${job.subId1}&sub_id2=${job.subId2}`;
}

export function fakeBridge(products: (url: string) => BridgeLookupValue = () => ({ found: false })): BridgePort {
  return {
    mode: "fake",
    createLink: async (job: LinkBridgeJob): Promise<BridgeLinkResult> => ({ outcome: "link", url: fakeLinkUrl(job) }),
    lookupProduct: async (job: LookupBridgeJob): Promise<BridgeLookupResult> => ({ outcome: "value", value: products(job.url) }),
  };
}
