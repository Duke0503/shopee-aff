/**
 * The website's pages (TanStack Router, AD-21) at the root of hoantiendp.com, the paths of
 * CUSTOMER_PATHS (the server answers 404 for any other). Every page sits in the shell; any other
 * path shows the not-found page. Sign-in goes on to the page asked for (only a path on this
 * site) or to My money.
 */
import { CUSTOMER_PATHS } from "@cashback/contracts";
import { createRootRoute, createRoute, createRouter, type RouterHistory } from "@tanstack/react-router";
import { lazy } from "react";

import { HomePage } from "./pages/home.page";
import { NotFoundPage } from "./pages/not-found.page";
import { safeRedirect } from "./pages/safe-redirect";
import { SiteShell } from "./shell/site-shell";

// Home comes in the first script; every other page loads when it is opened (Story 7.1 AC3).
const SignInRoute = lazy(() => import("./pages/sign-in-route").then((m) => ({ default: m.SignInRoute })));
const MyMoneyPage = lazy(() => import("./pages/my-money.page").then((m) => ({ default: m.MyMoneyPage })));
const GuidePage = lazy(() => import("./pages/guide.page").then((m) => ({ default: m.GuidePage })));

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
const myMoneyRoute = createRoute({ getParentRoute: () => rootRoute, path: CUSTOMER_PATHS.myMoney, component: MyMoneyPage });
const guideRoute = createRoute({ getParentRoute: () => rootRoute, path: CUSTOMER_PATHS.guide, component: GuidePage });

const routeTree = rootRoute.addChildren([homeRoute, signInRoute, myMoneyRoute, guideRoute]);

export function createAppRouter(history?: RouterHistory) {
  return createRouter({ routeTree, defaultPreload: false, scrollRestoration: true, ...(history === undefined ? {} : { history }) });
}

export type AppRouter = ReturnType<typeof createAppRouter>;

declare module "@tanstack/react-router" {
  interface Register {
    router: AppRouter;
  }
}
