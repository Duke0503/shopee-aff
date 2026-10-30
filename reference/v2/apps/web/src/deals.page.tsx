import type { ReactElement } from "react";

import { colors, spacing } from "@mmo/ui";

import { useDeals } from "./entities/deals/deals.queries";

/** The deals the owner picked. Amounts are whatever the server sent. */
export function DealsPage(): ReactElement {
  const { deals, error } = useDeals();

  if (error !== "") return <p style={{ color: colors.brand }}>{error}</p>;
  if (deals.length === 0) return <p style={{ color: colors.muted }}>No deals right now.</p>;

  return (
    <main style={{ padding: spacing.lg, color: colors.text }}>
      <h1>Deals</h1>
      <ul style={{ listStyle: "none", padding: 0 }}>
        {deals.map((deal) => (
          <li key={deal.id} style={{ marginBottom: spacing.md }}>
            <img src={deal.imageUrl} alt={deal.name} width={96} />
            <div>{deal.name}</div>
            <div style={{ color: colors.muted }}>
              {deal.platform} — {deal.category}
            </div>
            <div>
              {deal.salePriceVnd} VND, was {deal.originalPriceVnd} VND
            </div>
            <div style={{ color: colors.brand }}>Cashback {deal.cashbackVnd} VND</div>
            <a href={deal.url}>Buy</a>
          </li>
        ))}
      </ul>
    </main>
  );
}
