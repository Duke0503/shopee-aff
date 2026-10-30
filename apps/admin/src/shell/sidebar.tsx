/**
 * The desktop sidebar (UX-DR4, wireframe "A Sidebar"): brand, the three groups daily,
 * customers and admin with the items this role may open, and the signed-in staff member with
 * sign-out at the foot. 240 px wide; long labels truncate.
 */
import type { StaffSessionResponse } from "@cashback/contracts";
import { Button, LogOutIcon } from "@cashback/ui";

import { adminText } from "../labels";
import { BrandMark } from "./brand-mark";
import { NAV_GROUPS, type NavItem } from "./nav-items";
import { NavLink } from "./nav-link";

export interface ShellNavProps {
  readonly items: readonly NavItem[];
  readonly staff: StaffSessionResponse;
  readonly onSignOut: () => void;
}

export const roleText = (staff: StaffSessionResponse): string => adminText(staff.role === "ADMIN" ? "role_admin" : "role_employee");

export function Sidebar({ items, staff, onSignOut }: ShellNavProps) {
  return (
    <aside className="sticky top-0 flex h-dvh w-[240px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
      <div className="flex items-center gap-2.5 px-4 pt-5 pb-4">
        <BrandMark className="size-[30px]" />
        <div className="min-w-0">
          <p className="truncate text-[15px] font-semibold">{adminText("brand_name")}</p>
          <p className="truncate text-caption text-muted-foreground">{adminText("brand_desk")}</p>
        </div>
      </div>
      <nav aria-label={adminText("nav_label")} className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-3 pb-4">
        {NAV_GROUPS.map((group) => {
          const groupItems = items.filter((item) => item.group === group.id);
          if (groupItems.length === 0) return null;
          return (
            <section key={group.id} aria-labelledby={`nav-group-${group.id}`}>
              <h2 id={`nav-group-${group.id}`} className="px-2 pb-1 text-caption font-semibold tracking-wide text-muted-foreground uppercase">
                {adminText(group.labelKey)}
              </h2>
              <ul className="flex flex-col gap-0.5">
                {groupItems.map((item) => (
                  <li key={item.id}>
                    <NavLink
                      item={item}
                      className="flex h-9 items-center gap-2.5 rounded-md px-2 text-sm text-foreground hover:bg-muted data-[status=active]:bg-sidebar-accent data-[status=active]:font-semibold data-[status=active]:text-sidebar-accent-foreground coarse:h-11"
                    >
                      <item.icon aria-hidden className="size-[17px] shrink-0 text-muted-foreground in-data-[status=active]:text-sidebar-accent-foreground" />
                      <span className="truncate">{adminText(item.labelKey)}</span>
                    </NavLink>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </nav>
      <div className="flex items-center gap-2 border-t border-sidebar-border px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{staff.username}</p>
          <p className="truncate text-caption text-muted-foreground">{roleText(staff)}</p>
        </div>
        <Button type="button" variant="ghost" className="h-9 coarse:h-11" onClick={onSignOut}>
          <LogOutIcon aria-hidden />
          {adminText("sign_out")}
        </Button>
      </div>
    </aside>
  );
}
