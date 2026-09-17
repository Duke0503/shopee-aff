import { useEffect, useState } from "react"

/**
 * Four screens, one bundle, English paths.
 *
 * "/"        the landing page -- public, and what a link from a Zalo
 *            group actually opens. Nine in ten people who tap that link
 *            want to see what this is, not to sign in.
 * "/login"   reached by pressing a button, never shown by default.
 * "/orders"  a customer's own orders; needs a session.
 * "/admin"   the payout console; the server refuses it off loopback.
 *
 * A router library would be more code than the thing it routes, but
 * links still have to feel like links -- so navigation goes through
 * history.pushState and a subscription, not a page reload.
 */
export type Route = "home" | "login" | "orders" | "admin" | "guide"

const PATHS: Record<string, Route> = {
  "/": "home",
  "/login": "login",
  "/orders": "orders",
  "/admin": "admin",
  "/guide": "guide",
}

export function routeFor(pathname: string): Route {
  return PATHS[pathname.replace(/\/+$/, "") || "/"] ?? "home"
}

export function pathFor(route: Route): string {
  return Object.keys(PATHS).find((path) => PATHS[path] === route) ?? "/"
}

const listeners = new Set<() => void>()

export function navigate(route: Route) {
  window.history.pushState({}, "", pathFor(route))
  listeners.forEach((notify) => notify())
  window.scrollTo(0, 0)
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => routeFor(window.location.pathname))
  useEffect(() => {
    const sync = () => setRoute(routeFor(window.location.pathname))
    listeners.add(sync)
    // The back button has to work, or the page feels broken in a way
    // people blame on the site rather than on the router.
    window.addEventListener("popstate", sync)
    return () => {
      listeners.delete(sync)
      window.removeEventListener("popstate", sync)
    }
  }, [])
  return route
}

export const TITLE_KEY: Record<Route, string> = {
  home: "brand",
  login: "login_title",
  orders: "me_title",
  admin: "title",
  guide: "nav_guide",
}
