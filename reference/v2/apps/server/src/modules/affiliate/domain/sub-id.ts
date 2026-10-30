/**
 * A Shopee `sub_id` label. Only letters and digits: a dash or underscore is
 * silently dropped or mangled by Shopee, and the damage only surfaces weeks
 * later when the order comes back matching nobody. Checked when the id is
 * MADE, never when it is used. One check, used by every provider.
 */
const SUB_ID_PATTERN = /^[A-Za-z0-9]+$/;

export function isValidSubId(value: string): boolean {
  return SUB_ID_PATTERN.test(value);
}

export function assertValidSubId(value: string, label = "sub_id"): void {
  if (!isValidSubId(value)) {
    throw new Error(
      `${label} ${JSON.stringify(value)} is not usable as a Shopee sub_id: ` +
        "only a-z, A-Z and 0-9 are accepted",
    );
  }
}

/** Validate and return, for use at the point an id is created. */
export function toSubId(value: string, label = "sub_id"): string {
  assertValidSubId(value, label);
  return value;
}
