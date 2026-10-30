/**
 * The admin desk's routes (TanStack Router, AD-21) under /admin. A list route's search schema is
 * generated from its list spec (`ORDERS_SEARCH.validate`), and the URL is serialised as plain
 * `key=value` pairs in the list endpoint's own shape, so the address bar and the API query are
 * the same text (AD-12, LC-4). Every desk page sits inside the signed-in layout; admin-only pages
 * are wrapped so an employee who types their URL sees the permission line.
 */
import { createRootRoute, createRoute, createRouter, Outlet, useNavigate, type RouterHistory } from "@tanstack/react-router";
import { useMemo } from "react";

import { adminText, type AdminKey } from "./labels";
import { OrdersPage } from "./orders/orders.page";
import { ORDERS_SEARCH } from "./orders/orders.queries";
import { AdminOnly } from "./pages/admin-only";
import { DeskLayout } from "./pages/desk-layout";
import { NotFoundPage } from "./pages/not-found.page";
import { PendingPage } from "./pages/pending.page";
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

const routeTree = rootRoute.addChildren([
  signInRoute,
  deskRoute.addChildren([
    pendingRoute("/", "nav_overview"),
    pendingRoute("payouts", "nav_payouts"),
    pendingRoute("review", "nav_review"),
    ordersRoute,
    pendingRoute("customers", "nav_customers"),
    pendingRoute("links", "nav_links"),
    pendingRoute("campaigns", "nav_campaigns", true),
    pendingRoute("staff", "nav_staff", true),
    pendingRoute("audit", "nav_audit"),
    pendingRoute("settings", "nav_settings"),
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
