import type { ReactElement } from "react";

import type { ApiCustomer } from "@mmo/contracts";
import { colors, spacing } from "@mmo/ui";

import { CampaignsPage } from "./campaigns.page";
import { CustomersPage } from "./customers.page";
import { signOut } from "./features/auth/sign-out";
import { OrdersPage } from "./orders.page";
import { PayoutsPage } from "./payouts.page";
import { ADMIN_ROUTES, useAdminRoute, type AdminRoute } from "./routes";
import { label, useLabels, type LabelKey } from "./shared/lib/labels";
import { TransfersPage } from "./transfers.page";

/** What each screen is called in the sidebar. */
const NAV: Record<AdminRoute, LabelKey> = {
  payouts: "admin_nav_payouts",
  orders: "admin_nav_orders",
  customers: "admin_nav_customers",
  campaigns: "admin_nav_campaigns",
  transfers: "admin_nav_transfers",
};

function screen(route: AdminRoute, canRecordTransfer: boolean): ReactElement {
  switch (route) {
    case "orders":
      return <OrdersPage />;
    case "customers":
      return <CustomersPage canRecordTransfer={canRecordTransfer} />;
    case "campaigns":
      return <CampaignsPage />;
    case "transfers":
      return <TransfersPage />;
    default:
      return <PayoutsPage />;
  }
}

export interface ConsolePageProps {
  /** Who signed in, so the sidebar can name them and the owner-only box knows. */
  me: ApiCustomer;
  onSignedOut: () => void;
}

/** The console shell: a sidebar of screens and the chosen one beside it. */
export function ConsolePage({ me, onSignedOut }: ConsolePageProps): ReactElement {
  const labels = useLabels();
  const [route, navigate] = useAdminRoute();

  const leave = (): void => {
    void signOut().then(onSignedOut);
  };

  return (
    <div style={{ color: colors.text, display: "flex", minHeight: "100vh" }}>
      <nav style={{ borderRight: `1px solid ${colors.border}`, padding: spacing.lg, width: 180 }}>
        <ul style={{ listStyle: "none", padding: 0 }}>
          {ADMIN_ROUTES.map((name) => (
            <li key={name}>
              <button type="button" onClick={() => navigate(name)} disabled={name === route}>
                {label(labels, NAV[name])}
              </button>
            </li>
          ))}
        </ul>
        <p style={{ color: colors.muted, fontSize: 12 }}>
          {label(labels, "admin_signed_in_as", {
            name: me.displayName ?? me.customerCode ?? me.customerId,
          })}
        </p>
        <button type="button" onClick={leave}>
          {label(labels, "logout")}
        </button>
      </nav>
      <section style={{ flex: 1 }}>{screen(route, me.role === "admin")}</section>
    </div>
  );
}
