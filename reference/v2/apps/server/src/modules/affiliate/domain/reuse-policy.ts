/**
 * When a link may be reused. Ports `ledger/repository.py::find_reusable_request`.
 *
 * The window is NOT an expiry: Shopee's seven days start when the customer
 * CLICKS, so a month-old link still earns. It only separates "I never got it"
 * from "I am shopping for this again": past it the quoted price is stale, so a
 * fresh request is made to get fresh numbers.
 *
 * A link is reused ONLY for the same customer (sub_id1 = customer id). The
 * guest account is the exception: one link per product, shared by all guests.
 */
export const DEFAULT_ATTRIBUTION_DAYS = 7;

/** Python compares ISO timestamps as strings; this keeps the same rule. */
export function isWithinResendWindow(createdAt: string, cutoffIso: string): boolean {
  return createdAt >= cutoffIso;
}

/** The cutoff in local ISO, matching the shape the Python writes. */
export function resendCutoffLocal(nowMs: number, resendWithinDays: number): string {
  const at = new Date(nowMs - resendWithinDays * 86_400_000);
  const pad = (value: number): string => String(value).padStart(2, "0");
  const offset = -at.getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "-";
  return (
    `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}` +
    `T${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}` +
    `${sign}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`
  );
}
