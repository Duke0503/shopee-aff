import { useEffect, useState } from "react";

/** A tiny hand-rolled router: one route per customer screen, in the URL path. */
export const WEB_ROUTES = ["home", "deals", "orders", "balance", "login"] as const;

export type WebRoute = (typeof WEB_ROUTES)[number];

export function routeFromPath(pathname: string): WebRoute {
  const segment = pathname.replace(/^\//, "").split("/")[0] ?? "";
  return (WEB_ROUTES as readonly string[]).includes(segment) ? (segment as WebRoute) : "home";
}

export function useWebRoute(): [WebRoute, (route: WebRoute) => void] {
  const [route, setRoute] = useState<WebRoute>(() => routeFromPath(window.location.pathname));

  useEffect(() => {
    const onPop = (): void => setRoute(routeFromPath(window.location.pathname));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const navigate = (next: WebRoute): void => {
    window.history.pushState({}, "", `/${next}`);
    setRoute(next);
  };
  return [route, navigate];
}
