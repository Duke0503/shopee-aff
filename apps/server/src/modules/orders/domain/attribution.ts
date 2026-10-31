/**
 * Attribution (AD-8, AD-23, AD-25, D5, D6, D7, D58, FR-12, INV-1): the one rule that finds the
 * customer of a report row. Only a known customer is ever credited, resolved through aliases to
 * the survivor; a raw id that resolves to nobody is never credited. An erased record keeps its old
 * links: it is credited like the guest, with cashback 0 and no message (FR-35, Story 4.16).
 *
 * - sub_id1 present and resolving: that customer, unless the sub_id2 request's owner resolves to
 *   someone else (review case "owner_disagreement").
 * - sub_id1 present but resolving to nobody: review case "unattributed_sub_id1", carrying the
 *   sub_id2 owner as the suggested candidate when there is one (D58). Never credited automatically.
 * - sub_id1 empty (legacy links): the sub_id2 request's owner, as the live system does.
 * - nothing resolves: review case "unattributed".
 *
 * Guests are decided by the directory (the customer's role HOUSE): their effect carries cashback
 * 0 (D5). In production a `DEV` sub_id1 or a `DEV` request owner is only a review case (AD-25).
 * Pure: the caller hands in a directory whose lookups are already loaded or synchronous.
 */

/** Dev customer ids start with this; production attribution never resolves one (AD-25). */
export const DEV_SUB_ID_PREFIX = "DEV";

export interface DirectoryCustomer {
  /** The surviving customer id. */
  readonly customerId: string;
  /** True for the guest account (role HOUSE) and an erased record: it earns nothing and is told nothing. */
  readonly guest: boolean;
}

export interface AttributionDirectory {
  /** The surviving customer (an erased record included) for a customer id or alias, or null when there is none. */
  resolveCustomer(key: string): DirectoryCustomer | null;
  /** The customer id stored on a link request, or null when the request is unknown. */
  requestOwner(requestId: string): string | null;
}

export interface AttributionInput {
  /** sub_id1 to sub_id5 as the link carried them. */
  readonly subIds: readonly string[];
}

export type AttributionSource = "sub_id1" | "sub_id2" | "both";

export type ReviewReason = "owner_disagreement" | "unattributed" | "unattributed_sub_id1" | "dev_link_in_production";

export type Attribution =
  | {
      readonly kind: "customer";
      readonly customerId: string;
      readonly source: AttributionSource;
      /** True for HOUSE: the effect carries cashback 0 (`splitCommission({ guest })`, D5). */
      readonly guest: boolean;
      /** The sub_id2 link request whose owner was credited; null when sub_id1 alone decided. */
      readonly requestId: string | null;
      /** A sub_id2 the row carried that was not credited (no such request, or its owner resolves to nobody). */
      readonly unmatchedRequest: string | null;
    }
  | {
      readonly kind: "review";
      readonly reason: ReviewReason;
      /** The customers the rules produced, for the review case; staff choose no other. */
      readonly candidates: readonly string[];
    };

const blankToNull = (value: string | undefined): string | null => {
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? null : trimmed;
};

function customer(found: DirectoryCustomer, source: AttributionSource, subId2: string | null): Attribution {
  const used = source === "sub_id1" ? null : subId2;
  return { kind: "customer", customerId: found.customerId, source, guest: found.guest, requestId: used, unmatchedRequest: used === null ? subId2 : null };
}

function review(reason: ReviewReason, candidates: readonly (DirectoryCustomer | null)[]): Attribution {
  const ids = candidates.filter((c): c is DirectoryCustomer => c !== null).map((c) => c.customerId);
  return { kind: "review", reason, candidates: [...new Set(ids)] };
}

const isDev = (id: string | null | undefined): boolean => id !== null && id !== undefined && id.startsWith(DEV_SUB_ID_PREFIX);

export function attribute(input: AttributionInput, directory: AttributionDirectory, production: boolean): Attribution {
  const subId1 = blankToNull(input.subIds[0]);
  const subId2 = blankToNull(input.subIds[1]);
  const owner = subId2 === null ? null : directory.requestOwner(subId2);
  const byRequest = owner === null ? null : directory.resolveCustomer(owner);
  if (production && (isDev(subId1) || isDev(owner) || isDev(byRequest?.customerId))) return review("dev_link_in_production", []);

  if (subId1 === null) return byRequest !== null ? customer(byRequest, "sub_id2", subId2) : review("unattributed", []);
  const byCustomer = directory.resolveCustomer(subId1);
  if (byCustomer === null) return review(byRequest !== null ? "unattributed_sub_id1" : "unattributed", [byRequest]);
  if (byRequest === null) return customer(byCustomer, "sub_id1", subId2);
  return byCustomer.customerId === byRequest.customerId ? customer(byCustomer, "both", subId2) : review("owner_disagreement", [byCustomer, byRequest]);
}
