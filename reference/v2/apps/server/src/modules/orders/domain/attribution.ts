/**
 * Deciding whose order it is. Ports the attribution rule in
 * `shopee/reconciliation.py`: WE NEVER GUESS.
 *
 *   1. sub_id1  -> Identity's find-customer (this follows aliases, so orders
 *                  on links made before the Zalo account change still land on
 *                  the right person)
 *   2. sub_id2  -> whoever the link request was made for (evidence, not a guess)
 *   3. neither  -> manual review, with the reason
 *
 * The lookups are injected so this rule stays pure and testable.
 */
export type AttributionVia = "sub_id1" | "sub_id2";

export interface Attribution {
  customerId: string | null;
  via: AttributionVia | null;
  reason: string | null;
}

export interface AttributionLookups {
  findCustomer: (anyId: string) => string | null;
  requestOwner: (requestId: string) => string | null;
}

export interface AttributionInput {
  subId1: string | null;
  subId2: string | null;
}

export function attributeOrder(
  input: AttributionInput,
  lookups: AttributionLookups,
): Attribution {
  const subId1 = (input.subId1 ?? "").trim();
  const subId2 = (input.subId2 ?? "").trim();

  if (subId1) {
    const owner = lookups.findCustomer(subId1);
    if (owner) return { customerId: owner, via: "sub_id1", reason: null };
  }
  if (subId2) {
    const owner = lookups.requestOwner(subId2);
    if (owner) return { customerId: owner, via: "sub_id2", reason: null };
  }

  if (!subId1 && !subId2) {
    return { customerId: null, via: null, reason: "no sub_id labels on the order" };
  }
  return { customerId: null, via: null, reason: "neither sub_id1 nor sub_id2 matched" };
}
