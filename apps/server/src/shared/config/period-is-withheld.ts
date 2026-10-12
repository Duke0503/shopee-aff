/**
 * Is this payout period one Shopee withholds personal-income tax in? Ports
 * `Config.period_is_withheld` from `core/config.py`: the same environment
 * variable, the same default and the same truthy words, so both servers read a
 * period the same way.
 *
 * It is a SETTING, not something inferred from the data: the 10% is withheld on
 * a single payout of 2,000,000 đồng or more, and that threshold applies to what
 * Shopee actually pays US, which is only known once Shopee pays it.
 */
const TRUTHY = new Set(["1", "true", "yes"]);

export function periodIsWithheld(): boolean {
  return TRUTHY.has((process.env.PAYOUT_PERIOD_WITHHELD ?? "false").trim().toLowerCase());
}
