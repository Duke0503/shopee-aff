/**
 * The attribution directory over the ledger (AD-8, AD-23): identity resolves a customer through
 * aliases to the survivor, linking knows each link request's owner. An erased record is still
 * found, as one that earns nothing and is told nothing, like the guest (FR-35, Story 4.16). Each request is read once per
 * apply; the platform of the request attribution credited comes from that same read.
 */
import type { LedgerDb } from "../../platform/db/ledger";
import { earnsNothing, ledgerOwnerOf } from "../identity/index";
import { findLinkRequestOwner, type LinkRequestOwner } from "../linking/index";
import type { AttributionDirectory } from "./domain/attribution";

export interface LedgerDirectory extends AttributionDirectory {
  /** The shop platform of a request the directory has read; null for none. */
  requestPlatform(requestId: string): string | null;
}

export function ledgerDirectory(db: LedgerDb): LedgerDirectory {
  const read = new Map<string, LinkRequestOwner | null>();
  const request = (requestId: string): LinkRequestOwner | null => {
    if (!read.has(requestId)) read.set(requestId, findLinkRequestOwner(db, requestId));
    return read.get(requestId) ?? null;
  };
  return {
    resolveCustomer: (key) => {
      const found = ledgerOwnerOf(db, key);
      // Attribution records a new order now, so an erased owner earns nothing on it (FR-35).
      return found === null ? null : { customerId: found.customerId, guest: earnsNothing(found, null) };
    },
    requestOwner: (requestId) => request(requestId)?.customerId ?? null,
    requestPlatform: (requestId) => request(requestId)?.platform ?? null,
  };
}
