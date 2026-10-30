import type { ReactElement } from "react";

import type { ApiOrderBreakdown } from "@mmo/contracts";
import { colors, spacing } from "@mmo/ui";

import { label, useLabels, type LabelKey } from "../lib/labels";
import { vnd } from "../lib/money";

/** The wording that explains what the figures rest on. */
const BASIS = {
  approved: "admin_money_approved",
  estimate: "admin_money_estimate",
  none: "nothing_known",
} as const satisfies Record<ApiOrderBreakdown["basis"], LabelKey>;

function Line({
  name,
  value,
  strong = false,
}: {
  name: string;
  value: string;
  strong?: boolean;
}): ReactElement {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: spacing.sm }}>
      <span>{name}</span>
      <span style={{ fontWeight: strong ? 600 : 400 }}>{value}</span>
    </div>
  );
}

/**
 * The money behind one order, exactly as the server split it: the commission,
 * the platform fee, the tax when the period withheld it, what is left, and what
 * we keep. Nothing here is worked out in the browser.
 *
 * `basis` says what the figures are: the commission the platform approved, or
 * the estimate the customer is being shown while waiting, or nothing at all
 * (a rejected order, or one with no commission yet).
 */
export function OrderMoney({ breakdown }: { breakdown: ApiOrderBreakdown }): ReactElement {
  const labels = useLabels();

  if (breakdown.basis === "none") {
    return <span style={{ color: colors.muted }}>{label(labels, "nothing_known")}</span>;
  }

  return (
    <div style={{ minWidth: 200, fontSize: 12 }}>
      <Line
        name={label(labels, "admin_money_commission")}
        value={vnd(breakdown.commissionVnd, labels)}
      />
      <Line name={label(labels, "admin_money_fee")} value={vnd(breakdown.serviceFeeVnd, labels)} />
      {breakdown.withheldTaxVnd > 0 ? (
        <Line name={label(labels, "admin_money_tax")} value={vnd(breakdown.withheldTaxVnd, labels)} />
      ) : null}
      <Line name={label(labels, "admin_money_net")} value={vnd(breakdown.netVnd, labels)} />
      <Line
        name={label(labels, "admin_money_keep")}
        value={vnd(breakdown.operatorKeepsVnd, labels)}
        strong
      />
      <p style={{ color: colors.muted, margin: `${spacing.xs}px 0 0` }}>
        {label(labels, BASIS[breakdown.basis])}
      </p>
    </div>
  );
}
