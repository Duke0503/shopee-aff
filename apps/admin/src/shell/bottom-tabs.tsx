/**
 * The phone bottom tab bar (UX-DR4, EXPERIENCE.md bottom tab bar): Overview, Payouts,
 * Orders, Customers and More, 56 px items (above the 44 px target), fixed to the bottom with the
 * safe-area inset. More opens a bottom sheet with every other page this role may open and
 * sign-out.
 */
import { Button, EllipsisIcon, LogOutIcon, Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger, cn } from "@cashback/ui";
import { useState } from "react";

import { adminText } from "../labels";
import { isTab } from "./nav-items";
import { FOCUS_RING, NavLink } from "./nav-link";
import { roleText, type ShellNavProps } from "./sidebar";

const TAB = "flex h-14 min-h-11 min-w-11 flex-col items-center justify-center gap-0.5 px-0.5 text-caption leading-[1.15] font-medium text-muted-foreground";

export function BottomTabs({ items, staff, onSignOut }: ShellNavProps) {
  const [more, setMore] = useState(false);
  const tabs = items.filter(isTab);
  const rest = items.filter((item) => !isTab(item));
  return (
    <nav aria-label={adminText("nav_label")} className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card pb-[env(safe-area-inset-bottom)]">
      <ul className="grid grid-cols-5">
        {tabs.map((item) => (
          <li key={item.id} className="min-w-0">
            <NavLink item={item} className={cn(TAB, "data-[status=active]:text-primary")}>
              <item.icon aria-hidden className="size-5 shrink-0" />
              <span className="line-clamp-2 max-w-full text-center break-words">{adminText(item.tabKey ?? item.labelKey)}</span>
            </NavLink>
          </li>
        ))}
        <li className="min-w-0">
          <Sheet open={more} onOpenChange={setMore}>
            <SheetTrigger asChild>
              <button type="button" className={cn(TAB, FOCUS_RING, "w-full")}>
                <EllipsisIcon aria-hidden className="size-5 shrink-0" />
                <span className="line-clamp-2 max-w-full text-center break-words">{adminText("tab_more")}</span>
              </button>
            </SheetTrigger>
            <SheetContent side="bottom" className="max-h-[85dvh] overflow-y-auto rounded-t-xl pb-[env(safe-area-inset-bottom)]">
              <SheetHeader>
                <SheetTitle className="text-lg font-semibold">{adminText("more_title")}</SheetTitle>
                <SheetDescription>
                  {staff.username} · {roleText(staff)}
                </SheetDescription>
              </SheetHeader>
              <ul className="flex flex-col px-2">
                {rest.map((item) => (
                  <li key={item.id}>
                    <NavLink item={item} onNavigate={() => setMore(false)} className="flex h-12 items-center gap-3 rounded-md px-3 text-[15px] hover:bg-muted data-[status=active]:bg-sidebar-accent data-[status=active]:text-sidebar-accent-foreground">
                      <item.icon aria-hidden className="size-5 shrink-0 text-muted-foreground" />
                      <span className="truncate">{adminText(item.labelKey)}</span>
                    </NavLink>
                  </li>
                ))}
              </ul>
              <div className="border-t border-border px-4 py-3">
                <Button type="button" variant="outline" className="h-11 w-full" onClick={onSignOut}>
                  <LogOutIcon aria-hidden />
                  {adminText("sign_out")}
                </Button>
              </div>
            </SheetContent>
          </Sheet>
        </li>
      </ul>
    </nav>
  );
}
