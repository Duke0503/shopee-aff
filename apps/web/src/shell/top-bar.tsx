/**
 * W0 customer top bar: the brand on the left; from tablet up the three page links; on the right
 * the sign-in link or the signed-in customer's code, which opens the account menu. No floating Zalo
 * button anywhere: Zalo actions live in the content where they are needed.
 */
import { CUSTOMER_PATHS } from "@cashback/contracts";
import { cn } from "@cashback/ui";
import { Link, useRouterState } from "@tanstack/react-router";
import { lazy, Suspense } from "react";

import { isUnauthorized } from "../api/api.queries";
import { webText } from "../labels";
import { useCustomerSession } from "../session/session.queries";
import { BrandMark } from "./brand-mark";
import { FOCUS_RING, NAV_ITEMS } from "./nav-items";

// The account menu (Radix dialog) loads only for a signed-in customer (Story 7.1 AC3).
const AccountSheet = lazy(() => import("./account-sheet").then((m) => ({ default: m.AccountSheet })));

const TOP_LINK = "flex h-11 items-center rounded-lg px-3 text-[15px] font-medium text-muted-foreground hover:text-foreground data-[status=active]:text-primary";

function SessionCorner() {
  const session = useCustomerSession();
  const onSignIn = useRouterState({ select: (s) => s.location.pathname === CUSTOMER_PATHS.signIn });
  if (session.isPending) return <span className="h-11 w-24" aria-hidden />;
  if (session.data !== undefined) {
    return (
      <Suspense fallback={<span className="h-11 w-24" aria-hidden />}>
        <AccountSheet customerCode={session.data.customerCode} />
      </Suspense>
    );
  }
  // On the sign-in page itself the form is the action; while the server cannot be asked, nothing is claimed.
  if (onSignIn || !isUnauthorized(session.error)) return null;
  return (
    <Link to={CUSTOMER_PATHS.signIn} className={cn("flex h-11 items-center rounded-lg border border-border bg-card px-4 text-[15px] font-medium hover:bg-muted", FOCUS_RING)}>
      {webText("sign_in_link")}
    </Link>
  );
}

export function TopBar() {
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-card/95 pt-[env(safe-area-inset-top)] backdrop-blur-sm">
      <div className="mx-auto flex h-14 max-w-5xl items-center gap-2 px-4 md:h-16 md:px-6">
        <Link to={CUSTOMER_PATHS.home} className={cn("flex h-11 min-w-0 items-center gap-2.5 rounded-lg", FOCUS_RING)}>
          <BrandMark />
          <span className="truncate text-base font-bold tracking-tight">{webText("brand_name")}</span>
        </Link>
        <nav aria-label={webText("nav_label")} className="ml-auto hidden md:block" data-top-nav>
          <ul className="flex items-center gap-1">
            {NAV_ITEMS.map((item) => (
              <li key={item.to}>
                <Link to={item.to} activeOptions={{ exact: item.exact }} className={cn(TOP_LINK, FOCUS_RING)}>
                  {webText(item.labelKey)}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="ml-auto shrink-0 md:ml-4">
          <SessionCorner />
        </div>
      </div>
    </header>
  );
}
