import type { ReactElement } from "react";

import { colors, spacing } from "@mmo/ui";

import { App } from "./app.page";
import { BalancePage } from "./balance.page";
import { DealsPage } from "./deals.page";
import { LoginPage } from "./login.page";
import { MyOrdersPage } from "./my-orders.page";
import { WEB_ROUTES, useWebRoute, type WebRoute } from "./routes";

function screen(route: WebRoute): ReactElement {
  switch (route) {
    case "deals":
      return <DealsPage />;
    case "orders":
      return <MyOrdersPage />;
    case "balance":
      return <BalancePage />;
    case "login":
      return <LoginPage />;
    default:
      return <App />;
  }
}

/** The customer site: a nav strip and the chosen screen. */
export function ShellPage(): ReactElement {
  const [route, navigate] = useWebRoute();

  return (
    <div style={{ color: colors.text }}>
      <nav style={{ padding: spacing.md, borderBottom: `1px solid ${colors.border}` }}>
        <ul style={{ display: "flex", gap: spacing.md, listStyle: "none", padding: 0 }}>
          {WEB_ROUTES.map((name) => (
            <li key={name}>
              <button type="button" onClick={() => navigate(name)} disabled={name === route}>
                {name}
              </button>
            </li>
          ))}
        </ul>
      </nav>
      {screen(route)}
    </div>
  );
}
