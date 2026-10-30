import { z } from "zod";

/** What a customer is owed, broken into the three numbers shown on the site. */
export const Balance = z.object({
  customerId: z.string().min(1),
  approvedWaitingVnd: z.number().int().nonnegative(),
  stillWithShopVnd: z.number().int().nonnegative(),
  alreadyPaidVnd: z.number().int().nonnegative(),
});
export type Balance = z.infer<typeof Balance>;

const Dong = z.number().int().nonnegative();

/** One bank transfer from us to one customer. */
export const Payout = z.object({
  transferId: z.string().min(1),
  customerId: z.string().min(1),
  amountVnd: Dong,
  orderIds: z.array(z.string().min(1)),
  note: z.string(),
});
export type Payout = z.infer<typeof Payout>;
