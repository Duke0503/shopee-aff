/**
 * The tablet icon rail (UX-DR4): the same items as the sidebar as 44 px icon links, each with
 * its name as the accessible name and a tooltip that opens on hover and on keyboard focus, so a
 * keyboard user sees where focus is and what the icon means. Groups are split by a rule.
 */
import { Button, LogOutIcon, Tooltip, TooltipContent, TooltipTrigger } from "@cashback/ui";
import type { ReactElement } from "react";

import { adminText } from "../labels";
import { BrandMark } from "./brand-mark";
import { NAV_GROUPS } from "./nav-items";
import { NavLink } from "./nav-link";
import type { ShellNavProps } from "./sidebar";

function WithTooltip({ label, children }: { readonly label: string; readonly children: ReactElement }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="right" sideOffset={8}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

export function IconRail({ items, onSignOut }: ShellNavProps) {
  return (
    <aside className="sticky top-0 flex h-dvh w-16 shrink-0 flex-col items-center border-r border-sidebar-border bg-sidebar py-3">
      <BrandMark className="mb-3 size-[30px]" />
      <nav aria-label={adminText("nav_label")} className="flex min-h-0 flex-1 flex-col items-center gap-1 overflow-y-auto px-2">
        {NAV_GROUPS.map((group, index) => {
          const groupItems = items.filter((item) => item.group === group.id);
          if (groupItems.length === 0) return null;
          return (
            <ul key={group.id} aria-label={adminText(group.labelKey)} className={index === 0 ? "flex flex-col gap-1" : "flex flex-col gap-1 border-t border-sidebar-border pt-1"}>
              {groupItems.map((item) => (
                <li key={item.id}>
                  <WithTooltip label={adminText(item.labelKey)}>
                    <NavLink
                      item={item}
                      label={adminText(item.labelKey)}
                      className="flex size-11 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted data-[status=active]:bg-sidebar-accent data-[status=active]:text-sidebar-accent-foreground"
                    >
                      <item.icon aria-hidden className="size-5" />
                    </NavLink>
                  </WithTooltip>
                </li>
              ))}
            </ul>
          );
        })}
      </nav>
      <WithTooltip label={adminText("sign_out")}>
        <Button type="button" variant="ghost" className="size-11" aria-label={adminText("sign_out")} onClick={onSignOut}>
          <LogOutIcon aria-hidden className="size-5" />
        </Button>
      </WithTooltip>
    </aside>
  );
}
