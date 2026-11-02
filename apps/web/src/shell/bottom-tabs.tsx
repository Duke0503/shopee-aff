/**
 * W0 phone bottom tabs (UX-DR4, EXPERIENCE.md bottom tab bar): Home, My money and Guide;
 * 56 px items above the 44 px target, fixed to the bottom with the safe-area inset,
 * hidden while the on-screen keyboard is open so it never covers a field. Tapping the tab of the
 * page already open scrolls it to the top.
 */
import { cn } from "@cashback/ui";
import { Link, useRouterState } from "@tanstack/react-router";

import { webText } from "../labels";
import { FOCUS_RING, NAV_ITEMS, type NavItem } from "./nav-items";
import { useKeyboardOpen } from "./use-keyboard-open";

const TAB = "flex h-14 min-h-11 flex-col items-center justify-center gap-1 px-1 text-caption font-medium text-muted-foreground data-[status=active]:text-primary";

const isCurrent = (item: NavItem, path: string): boolean => (item.exact ? path === item.to : path.startsWith(item.to));

export function BottomTabs() {
  const keyboard = useKeyboardOpen();
  const path = useRouterState({ select: (s) => s.location.pathname });
  if (keyboard) return null;
  return (
    <nav aria-label={webText("nav_label")} data-bottom-tabs className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card pb-[env(safe-area-inset-bottom)] md:hidden">
      <ul className="grid grid-cols-3">
        {NAV_ITEMS.map((item) => (
          <li key={item.to} className="min-w-0">
            <Link
              to={item.to}
              activeOptions={{ exact: item.exact }}
              onClick={() => {
                if (isCurrent(item, path)) window.scrollTo({ top: 0 });
              }}
              className={cn(TAB, FOCUS_RING)}
            >
              <item.icon aria-hidden className="size-5 shrink-0" />
              <span className="max-w-full truncate">{webText(item.labelKey)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
