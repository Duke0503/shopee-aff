/**
 * One navigation link, the same on the sidebar, the rail and the phone tabs: the router marks the
 * current page (`aria-current="page"`, `data-status="active"`); focus always shows the ring.
 * Extra props and the ref pass through, so a tooltip can wrap it.
 */
import { cn } from "@cashback/ui";
import { Link } from "@tanstack/react-router";
import type { ComponentProps, ReactNode } from "react";

import type { NavItem } from "./nav-items";

export const FOCUS_RING = "outline-none focus-visible:ring-3 focus-visible:ring-ring/60 focus-visible:ring-offset-1 focus-visible:ring-offset-background";

export interface NavLinkProps extends Omit<ComponentProps<"a">, "href" | "children"> {
  readonly item: NavItem;
  readonly label?: string;
  readonly onNavigate?: () => void;
  readonly children: ReactNode;
}

export function NavLink({ item, className, label, onNavigate, children, onClick, ...rest }: NavLinkProps) {
  return (
    <Link
      {...rest}
      to={item.to}
      activeOptions={{ exact: item.to === "/", includeSearch: false }}
      aria-label={label}
      onClick={(event) => {
        onClick?.(event);
        onNavigate?.();
      }}
      className={cn(FOCUS_RING, className)}
    >
      {children}
    </Link>
  );
}
