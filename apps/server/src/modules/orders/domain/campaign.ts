/**
 * Campaign slots: "the first N orders get a bonus". A new event is a ROW of
 * data, not code. Ports the rules in `ledger/campaigns.py`.
 *
 *   - a slot belongs to an ORDER, not a person (unless `perCustomer` caps it)
 *   - orders rank by `recordedAt`, and only orders DURING the window count
 *   - an order cancelled DURING the event: its slot passes to the next order
 *   - an order cancelled AFTER the event: the slot is lost, nobody gets it
 *   - the bonus is paid only once the order is approved (held -> confirmed)
 *   - staff, HOUSE and excluded customers never win
 */
export const PER_CUSTOMER_UNLIMITED = 0;

export type AwardStatus = "held" | "confirmed" | "paid" | "void";

export interface Campaign {
  windowStart: string;
  windowEnd: string;
  slots: number;
  bonusVnd: number;
  perCustomer: number;
  minOrderValueVnd: number;
  platforms: string[];
  excludedCustomerIds: string[];
}

export interface CandidateOrder {
  orderId: string;
  customerId: string;
  recordedAt: string;
  orderValueVnd: number;
  platform: string;
  status: "awaiting_approval" | "approved" | "paid" | "rejected";
  cancelledAt: string | null;
  role: string | null;
}

export interface Award {
  orderId: string;
  customerId: string;
  slot: number;
  status: AwardStatus;
}

function isEligible(campaign: Campaign, order: CandidateOrder): boolean {
  if ((order.role ?? "user") !== "user") return false;
  if (campaign.excludedCustomerIds.includes(order.customerId)) return false;
  if (order.orderValueVnd < campaign.minOrderValueVnd) return false;
  if (campaign.platforms.length > 0 && !campaign.platforms.includes(order.platform)) return false;
  return order.recordedAt >= campaign.windowStart && order.recordedAt <= campaign.windowEnd;
}

function statusFor(order: CandidateOrder): AwardStatus {
  if (order.status === "paid") return "paid";
  if (order.status === "approved") return "confirmed";
  return "held";
}

export function evaluateCampaign(campaign: Campaign, orders: CandidateOrder[]): Award[] {
  const ranked = orders
    .filter((order) => isEligible(campaign, order))
    .sort((a, b) => a.recordedAt.localeCompare(b.recordedAt) || a.orderId.localeCompare(b.orderId));

  const awards: Award[] = [];
  const usedPerCustomer = new Map<string, number>();
  let slot = 0;

  for (const order of ranked) {
    if (slot >= campaign.slots) break;

    const cancelledDuring =
      order.status === "rejected" && order.cancelledAt !== null && order.cancelledAt <= campaign.windowEnd;
    if (cancelledDuring) continue; // the slot passes to the next order

    const used = usedPerCustomer.get(order.customerId) ?? 0;
    if (campaign.perCustomer !== PER_CUSTOMER_UNLIMITED && used >= campaign.perCustomer) continue;

    slot += 1;
    awards.push({
      orderId: order.orderId,
      customerId: order.customerId,
      slot,
      status: order.status === "rejected" ? "void" : statusFor(order),
    });
    usedPerCustomer.set(order.customerId, used + 1);
  }
  return awards;
}
