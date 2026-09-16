/**
 * Two audiences, one bundle.
 *
 * The operator console lives at "/" and is served only to loopback; the
 * customer view lives at "/tra-cuu" (and "/orders", which is the path
 * people already know from similar tools). Routing is a path check
 * rather than a router: there are two screens, and a routing library
 * would be more code than the thing it routes.
 */
export const CUSTOMER_PATHS = ["/tra-cuu", "/orders", "/don-hang"]

export function isCustomerPath(pathname: string): boolean {
  const path = pathname.replace(/\/+$/, "") || "/"
  return CUSTOMER_PATHS.includes(path)
}
