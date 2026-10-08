import type { ReactElement } from "react";

import { colors, spacing } from "@mmo/ui";

import { CampaignsPage } from "./campaigns.page";
import { CustomersPage } from "./customers.page";
import { OrdersPage } from "./orders.page";
import { PayoutsPage } from "./payouts.page";
import { ADMIN_ROUTES, useAdminRoute, type AdminRoute } from "./routes";
import { TransfersPage } from "./transfers.page";

function screen(route: AdminRoute): ReactElement {
  switch (route) {
    case "orders":
      return <OrdersPage />;
    case "customers":
      return <CustomersPage />;
    case "campaigns":
      return <CampaignsPage />;
    case "transfers":
      return <TransfersPage />;
    default:
      return <PayoutsPage />;
  }
}

/** The console shell: a sidebar of screens and the chosen one beside it. */
export function ConsolePage(): ReactElement {
  const [route, navigate] = useAdminRoute();

  return (
    <div style={{ display: "flex", color: colors.text, minHeight: "100vh" }}>
      <nav style={{ padding: spacing.lg, borderRight: `1px solid ${colors.border}`, width: 160 }}>
        <ul style={{ listStyle: "none", padding: 0 }}>
          {ADMIN_ROUTES.map((name) => (
            <li key={name}>
              <button type="button" onClick={() => navigate(name)} disabled={name === route}>
                {name}
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <section style={{ flex: 1 }}>{screen(route)}</section>
    </div>
  );
}
