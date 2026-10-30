/**
 * What applying a report row needs from the modules above orders (AD-1, AD-6, AD-9, D35, D39,
 * D55). The payouts module says whether an OPEN payout claim covers the order and how much was
 * already clawed back, and writes the clawback entries; the campaigns module says what bonus was
 * paid on the order and moves its awards; linking hears that an order was recorded. Orders imports
 * none of them: the composition root binds an implementation of each to the transaction's handle,
 * so every effect commits or rolls back with the order (AD-1).
 */
import type { AffiliateNetwork } from "@cashback/money";

import type { AwardMove } from "./domain/transition";

export interface ClawbackRequest {
  readonly orderId: string;
  readonly customerId: string;
  /** Positive whole dong; the entry is written negative. */
  readonly amount: number;
  /** A commission drop (D55) rather than a cancel (D30). */
  readonly partial: boolean;
}

export interface OrderPayoutsPort {
  /** The order is in the snapshot of an OPEN payout claim (D39). */
  coveredByOpenClaim(orderId: string): boolean;
  /** What clawback originals on the order already took, as a positive number. */
  clawedBack(orderId: string): number;
  /** Writes the negative original entry of a new clawback; returns its clawback id. */
  openClawback(request: ClawbackRequest): string;
}

export interface OrderAwardsPort {
  /** Campaign bonus already paid on the order (D35); 0 when none. */
  paidBonus(orderId: string): number;
  /** Moves the order's awards as `transition` said (status-flows.md section 5). */
  move(orderId: string, to: AwardMove): void;
}

/** Domain event `orders.order.recorded`: linking marks the link request CONVERTED (AD-1). */
export interface OrderRecorded {
  readonly orderId: string;
  readonly network: AffiliateNetwork;
  readonly customerId: string;
  readonly requestId: string | null;
}

export interface OrderEventsPort {
  recorded(event: OrderRecorded): void;
}
