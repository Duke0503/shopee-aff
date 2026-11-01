/**
 * The admin desk's routes (TanStack Router, AD-21) under /admin. A list route's search schema is
 * generated from its list spec (`ORDERS_SEARCH.validate`), and the URL is serialised as plain
 * `key=value` pairs in the list endpoint's own shape, so the address bar and the API query are
 * the same text (AD-12, LC-4). Every desk page sits inside the signed-in layout; admin-only pages
 * are wrapped so an employee who types their URL sees the permission line.
 */
import { createRootRoute, createRoute, createRouter, Outlet, useNavigate, type RouterHistory } from "@tanstack/react-router";
import { useMemo } from "react";

import { CustomerPage } from "./customers/customer.page";
import { CustomersPage } from "./customers/customers.page";
import { CUSTOMERS_SEARCH, TAB_SEARCH, tabOf } from "./customers/customers.queries";
import { adminText, type AdminKey } from "./labels";
import { LinkRequestsPage } from "./links/link-requests.page";
import { LINK_REQUESTS_SEARCH } from "./links/link-requests.queries";
import { OrdersPage } from "./orders/orders.page";
import { OverviewPage } from "./overview/overview.page";
import { overviewSearch } from "./overview/overview.queries";
import { ORDERS_SEARCH } from "./orders/orders.queries";
import { AdminOnly } from "./pages/admin-only";
import { DeskLayout } from "./pages/desk-layout";
import { NotFoundPage } from "./pages/not-found.page";
import { PendingPage } from "./pages/pending.page";
import { NetworkSettlementsPage } from "./payouts/network-settlements.page";
import { NETWORK_SETTLEMENTS_SEARCH } from "./payouts/network-settlements.queries";
import { PayoutHistoryPage } from "./payouts/payout-history.page";
import { PAYOUT_HISTORY_SEARCH } from "./payouts/payout-history.queries";
import { PayoutsPage } from "./payouts/payouts.page";
import { PAYOUTS_SEARCH } from "./payouts/payouts.queries";
import { ReviewPage } from "./review/review.page";
import { REVIEW_SEARCH } from "./review/review.queries";
import { SettingsPage } from "./settings/settings.page";
import { SignInRoute } from "./pages/sign-in-route";
import { parseSearch, stringifySearch } from "./search-params";

export const ADMIN_BASEPATH = "/admin";

const rootRoute = createRootRoute({ component: Outlet, notFoundComponent: NotFoundPage });

export const signInRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "sign-in",
  validateSearch: (raw: Record<string, unknown>): { redirect?: string | undefined } => {
    const redirect = raw["redirect"];
    // Only a path inside the desk, never another site; a refused value is overwritten, not kept.
    return { redirect: typeof redirect === "string" && redirect.startsWith("/") && !redirect.startsWith("//") && !redirect.includes("\\") ? redirect : undefined };
  },
  component: function SignInScreen() {
    return <SignInRoute redirect={signInRoute.useSearch().redirect} />;
  },
});

const deskRoute = createRoute({ getParentRoute: () => rootRoute, id: "desk", component: DeskLayout });

function pendingRoute<const P extends string>(path: P, titleKey: AdminKey, adminOnly = false) {
  return createRoute({
    getParentRoute: () => deskRoute,
    path,
    component: () => (adminOnly ? <AdminOnly>{<PendingPage titleKey={titleKey} />}</AdminOnly> : <PendingPage titleKey={titleKey} />),
  });
}

export const overviewRoute = createRoute({
  getParentRoute: () => deskRoute,
  path: "/",
  validateSearch: (raw: Record<string, unknown>) => overviewSearch(raw),
  component: function OverviewScreen() {
    const search = overviewRoute.useSearch();
    const navigate = useNavigate({ from: overviewRoute.fullPath });
    return <OverviewPage search={search} onChange={(next) => void navigate({ search: { ...next } })} />;
  },
});

export const ordersRoute = createRoute({
  getParentRoute: () => deskRoute,
  path: "orders",
  validateSearch: (raw: Record<string, unknown>) => ORDERS_SEARCH.validate(raw),
  component: function OrdersScreen() {
    const search = ordersRoute.useSearch();
    const navigate = useNavigate({ from: ordersRoute.fullPath });
    const state = useMemo(() => ORDERS_SEARCH.parse(search), [search]);
    return <OrdersPage state={state} onStateChange={(next, options) => void navigate({ search: ORDERS_SEARCH.toParams(next), replace: options?.replace === true })} />;
  },
});

export const linksRoute = createRoute({
  getParentRoute: () => deskRoute,
  path: "links",
  validateSearch: (raw: Record<string, unknown>) => LINK_REQUESTS_SEARCH.validate(raw),
  component: function LinksScreen() {
    const search = linksRoute.useSearch();
    const navigate = useNavigate({ from: linksRoute.fullPath });
    const state = useMemo(() => LINK_REQUESTS_SEARCH.parse(search), [search]);
    return <LinkRequestsPage state={state} onStateChange={(next, options) => void navigate({ search: LINK_REQUESTS_SEARCH.toParams(next), replace: options?.replace === true })} />;
  },
});

export const payoutsRoute = createRoute({
  getParentRoute: () => deskRoute,
  path: "payouts",
  validateSearch: (raw: Record<string, unknown>) => PAYOUTS_SEARCH.validate(raw),
  component: function PayoutsScreen() {
    const search = payoutsRoute.useSearch();
    const navigate = useNavigate({ from: payoutsRoute.fullPath });
    const state = useMemo(() => PAYOUTS_SEARCH.parse(search), [search]);
    return <PayoutsPage state={state} onStateChange={(next, options) => void navigate({ search: PAYOUTS_SEARCH.toParams(next), replace: options?.replace === true })} />;
  },
});

export const payoutHistoryRoute = createRoute({
  getParentRoute: () => deskRoute,
  path: "payouts/history",
  validateSearch: (raw: Record<string, unknown>) => PAYOUT_HISTORY_SEARCH.validate(raw),
  component: function PayoutHistoryScreen() {
    const search = payoutHistoryRoute.useSearch();
    const navigate = useNavigate({ from: payoutHistoryRoute.fullPath });
    const state = useMemo(() => PAYOUT_HISTORY_SEARCH.parse(search), [search]);
    return <PayoutHistoryPage state={state} onStateChange={(next, options) => void navigate({ search: PAYOUT_HISTORY_SEARCH.toParams(next), replace: options?.replace === true })} />;
  },
});

export const networkSettlementsRoute = createRoute({
  getParentRoute: () => deskRoute,
  path: "payouts/network",
  validateSearch: (raw: Record<string, unknown>) => NETWORK_SETTLEMENTS_SEARCH.validate(raw),
  component: function NetworkSettlementsScreen() {
    const search = networkSettlementsRoute.useSearch();
    const navigate = useNavigate({ from: networkSettlementsRoute.fullPath });
    const state = useMemo(() => NETWORK_SETTLEMENTS_SEARCH.parse(search), [search]);
    return <NetworkSettlementsPage state={state} onStateChange={(next, options) => void navigate({ search: NETWORK_SETTLEMENTS_SEARCH.toParams(next), replace: options?.replace === true })} />;
  },
});

export const customersRoute = createRoute({
  getParentRoute: () => deskRoute,
  path: "customers",
  validateSearch: (raw: Record<string, unknown>) => CUSTOMERS_SEARCH.validate(raw),
  component: function CustomersScreen() {
    const search = customersRoute.useSearch();
    const navigate = useNavigate({ from: customersRoute.fullPath });
    const state = useMemo(() => CUSTOMERS_SEARCH.parse(search), [search]);
    return <CustomersPage state={state} onStateChange={(next, options) => void navigate({ search: CUSTOMERS_SEARCH.toParams(next), replace: options?.replace === true })} />;
  },
});

/** One customer's page: the tab (absent for the first) and that tab's own list state, in the URL. */
export const customerRoute = createRoute({
  getParentRoute: () => deskRoute,
  path: "customers/$customerKey",
  validateSearch: (raw: Record<string, unknown>): Record<string, string> => {
    const tab = tabOf(raw["tab"]);
    return { ...(tab === "orders" ? {} : { tab }), ...TAB_SEARCH[tab].validate(raw) };
  },
  component: function CustomerScreen() {
    const { customerKey } = customerRoute.useParams();
    const search = customerRoute.useSearch();
    const navigate = useNavigate({ from: customerRoute.fullPath });
    const tab = tabOf(search["tab"]);
    const state = useMemo(() => TAB_SEARCH[tab].parse(search), [search, tab]);
    return (
      <CustomerPage
        key={customerKey}
        customerKey={customerKey}
        tab={tab}
        state={state}
        onChange={(nextTab, next, options) => void navigate({ search: { ...(nextTab === "orders" ? {} : { tab: nextTab }), ...TAB_SEARCH[nextTab].toParams(next) }, replace: options?.replace === true })}
      />
    );
  },
});

export const reviewRoute = createRoute({
  getParentRoute: () => deskRoute,
  path: "review",
  validateSearch: (raw: Record<string, unknown>) => REVIEW_SEARCH.validate(raw),
  component: function ReviewScreen() {
    const search = reviewRoute.useSearch();
    const navigate = useNavigate({ from: reviewRoute.fullPath });
    const state = useMemo(() => REVIEW_SEARCH.parse(search), [search]);
    return <ReviewPage state={state} onStateChange={(next, options) => void navigate({ search: REVIEW_SEARCH.toParams(next), replace: options?.replace === true })} />;
  },
});

const settingsRoute = createRoute({ getParentRoute: () => deskRoute, path: "settings", component: SettingsPage });

const routeTree = rootRoute.addChildren([
  signInRoute,
  deskRoute.addChildren([
    overviewRoute,
    payoutsRoute,
    payoutHistoryRoute,
    networkSettlementsRoute,
    reviewRoute,
    ordersRoute,
    customersRoute,
    customerRoute,
    linksRoute,
    pendingRoute("campaigns", "nav_campaigns", true),
    pendingRoute("staff", "nav_staff", true),
    pendingRoute("audit", "nav_audit"),
    settingsRoute,
  ]),
]);

export function createAppRouter(history?: RouterHistory) {
  return createRouter({
    routeTree,
    basepath: ADMIN_BASEPATH,
    parseSearch,
    stringifySearch,
    defaultPreload: false,
    scrollRestoration: true,
    ...(history === undefined ? {} : { history }),
  });
}

export type AppRouter = ReturnType<typeof createAppRouter>;

declare module "@tanstack/react-router" {
  interface Register {
    router: AppRouter;
  }
}

export const DOCUMENT_TITLE = `${adminText("brand_desk")} · ${adminText("brand_name")}`;
