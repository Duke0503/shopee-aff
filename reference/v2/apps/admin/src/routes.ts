import { useEffect, useState } from "react";

/** A tiny hand-rolled router: one route per console screen, in the URL path. */
export const ADMIN_ROUTES = ["payouts", "orders", "customers", "campaigns", "transfers"] as const;

export type AdminRoute = (typeof ADMIN_ROUTES)[number];

export function routeFromPath(pathname: string): AdminRoute {
  const segment = pathname.replace(/^\//, "").split("/")[0] ?? "";
  return (ADMIN_ROUTES as readonly string[]).includes(segment)
    ? (segment as AdminRoute)
    : "payouts";
}

export function useAdminRoute(): [AdminRoute, (route: AdminRoute) => void] {
  const [route, setRoute] = useState<AdminRoute>(() => routeFromPath(window.location.pathname));

  useEffect(() => {
    const onPop = (): void => setRoute(routeFromPath(window.location.pathname));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const navigate = (next: AdminRoute): void => {
    window.history.pushState({}, "", `/${next}`);
    setRoute(next);
  };
  return [route, navigate];
}
