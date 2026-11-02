/**
 * The cutover's 72-hour no-payout window (Story 8.8): the owner's close on the internal listener,
 * and the staff read the Payouts banner shows.
 */
import { z } from "zod";

/** The owner's close of the 72-hour no-payout window after the cutover (Story 8.8), an admin command of the internal CLI. */
export const PAYOUT_WINDOW_PATH = "/internal/admin/payouts/window";
/** The staff read of the window, for the banner on Payouts. */
export const PAYOUT_WINDOW_STATE_PATH = "/api/admin/payouts/window";
export const payoutWindowCloseSchema = z.strictObject({ open: z.literal(false) });
export const payoutWindowStateSchema = z.object({ open: z.boolean(), endsAt: z.string().nullable() });
export type PayoutWindowState = z.infer<typeof payoutWindowStateSchema>;
