/**
 * The website's pages (TanStack Router, AD-21) at the root of hoantiendp.com, the paths of
 * CUSTOMER_PATHS (the server answers 404 for any other). Every page sits in the shell; any other
 * path shows the not-found page. Sign-in goes on to the page asked for (only a path on this
 * site) or to My money.
 */
import { CUSTOMER_PATHS } from "@cashback/contracts";
import { createRootRoute, createRoute, createRouter, useNavigate, type RouterHistory } from "@tanstack/react-router";
import { lazy } from "react";


import { HomePage } from "./pages/home.page";
import { NotFoundPage } from "./pages/not-found.page";
import { safeRedirect } from "./pages/safe-redirect";
import { parseSearch, stringifySearch } from "./search-params";
import { SiteShell } from "./shell/site-shell";

// Home comes in the first script; every other page loads when it is opened (Story 7.1 AC3).
const SignInRoute = lazy(() => import("./pages/sign-in-route").then((m) => ({ default: m.SignInRoute })));
const MyMoneyPage = lazy(() => import("./pages/my-money.page").then((m) => ({ default: m.MyMoneyPage })));
const AccountPage = lazy(() => import("./pages/account.page").then((m) => ({ default: m.AccountPage })));
const GuidePage = lazy(() => import("./pages/guide.page").then((m) => ({ default: m.GuidePage })));
const OrderDetailPage = lazy(() => import("./pages/order-detail.page").then((m) => ({ default: m.OrderDetailPage })));
const MissingOrderPage = lazy(() => import("./pages/missing-order.page").then((m) => ({ default: m.MissingOrderPage })));

const rootRoute = createRootRoute({ component: SiteShell, notFoundComponent: NotFoundPage });

export const signInRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: CUSTOMER_PATHS.signIn,
  validateSearch: (raw: Record<string, unknown>): { redirect?: string | undefined } => ({ redirect: safeRedirect(raw["redirect"]) }),
  component: function SignInScreen() {
    return <SignInRoute redirect={signInRoute.useSearch().redirect} />;
  },
});

const homeRoute = createRoute({ getParentRoute: () => rootRoute, path: CUSTOMER_PATHS.home, component: HomePage });
/** Flat text parameters only; a page that keeps list state checks them itself, in its own chunk. */
const textParams = (raw: Record<string, unknown>): Record<string, string> => Object.fromEntries(Object.entries(raw).filter((entry): entry is [string, string] => typeof entry[1] === "string"));

/** My money: the view and that view's list state in the URL (LC-4), readable as the API query; the page normalises it. */
const myMoneyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: CUSTOMER_PATHS.myMoney,
  validateSearch: textParams,
  component: function MyMoneyScreen() {
    const search = myMoneyRoute.useSearch();
    const navigate = useNavigate({ from: myMoneyRoute.fullPath });
    return <MyMoneyPage search={search} onSearch={(next, options) => void navigate({ search: next, replace: options?.replace === true })} />;
  },
});
const accountRoute = createRoute({ getParentRoute: () => rootRoute, path: CUSTOMER_PATHS.account, component: AccountPage });
const guideRoute = createRoute({ getParentRoute: () => rootRoute, path: CUSTOMER_PATHS.guide, component: GuidePage });
/** One order in full: the order id as `?ma=` (the page asks the server; an unknown id reads as no such order). */
const orderDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: CUSTOMER_PATHS.orderDetail,
  validateSearch: (raw: Record<string, unknown>): { ma: string } => ({ ma: typeof raw["ma"] === "string" ? raw["ma"].trim().slice(0, 40) : "" }),
  component: function OrderDetailScreen() {
    return <OrderDetailPage orderId={orderDetailRoute.useSearch().ma} />;
  },
});
const missingOrderRoute = createRoute({ getParentRoute: () => rootRoute, path: CUSTOMER_PATHS.missingOrder, component: MissingOrderPage });

const routeTree = rootRoute.addChildren([homeRoute, signInRoute, myMoneyRoute, accountRoute, guideRoute, orderDetailRoute, missingOrderRoute]);

export function createAppRouter(history?: RouterHistory) {
  return createRouter({ routeTree, parseSearch, stringifySearch, defaultPreload: false, scrollRestoration: true, ...(history === undefined ? {} : { history }) });
}

export type AppRouter = ReturnType<typeof createAppRouter>;

declare module "@tanstack/react-router" {
  interface Register {
    router: AppRouter;
  }
}
