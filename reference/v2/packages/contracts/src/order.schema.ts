import { z } from "zod";
import { Platform } from "./platform";

export const OrderStatus = z.enum(["awaiting_approval", "approved", "paid", "rejected"]);
export type OrderStatus = z.infer<typeof OrderStatus>;

/** Money is always a whole-dong integer; never a float. */
const Dong = z.number().int().nonnegative();

export const Order = z.object({
  orderId: z.string().min(1),
  customerId: z.string().nullable(),
  requestId: z.string().nullable().optional(),
  platform: Platform,
  valueVnd: Dong,
  estimatedCommission: Dong.nullable().optional(),
  approvedCommission: Dong.nullable().optional(),
  cashbackAmount: Dong.nullable().optional(),
  status: OrderStatus,
  recordedAt: z.string().nullable().optional(),
  paidAt: z.string().nullable().optional(),
});
export type Order = z.infer<typeof Order>;
