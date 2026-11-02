/**
 * The desktop sidebar (UX-DR4, wireframe "A Sidebar"): brand, the three groups daily,
 * customers and admin with the items this role may open, and the signed-in staff member with
 * sign-out at the foot. 240 px wide; long labels truncate. Payouts and Review carry their counts
 * (desk-counts.queries.ts) as a small grey pill at the right.
 */
import type { StaffSessionResponse } from "@cashback/contracts";
import { Button, formatCount, LogOutIcon } from "@cashback/ui";

import { adminText } from "../labels";
import { BrandMark } from "./brand-mark";
import { countOf, useDeskCounts } from "./desk-counts.queries";
import { NAV_GROUPS, type NavItem } from "./nav-items";
import { NavLink } from "./nav-link";

export interface ShellNavProps {
  readonly items: readonly NavItem[];
  readonly staff: StaffSessionResponse;
  readonly onSignOut: () => void;
}

export const roleText = (staff: StaffSessionResponse): string => adminText(staff.role === "ADMIN" ? "role_admin" : "role_employee");

/** A navigation item's count: the number in a grey pill, read out with what it counts. */
export function NavCount({ count }: { readonly count: number | null }) {
  if (count === null) return null;
  return (
    <span data-nav-count={count} className="ml-auto inline-flex h-5 min-w-6 shrink-0 items-center justify-center rounded-full bg-muted px-2 text-caption font-medium text-muted-foreground tabular-nums">
      <span aria-hidden>{formatCount(count)}</span>
      <span className="sr-only">{adminText("nav_count", { count: formatCount(count) })}</span>
    </span>
  );
}

export function Sidebar({ items, staff, onSignOut }: ShellNavProps) {
  const counts = useDeskCounts().data;
  return (
    <aside className="sticky top-0 flex h-dvh w-[240px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
      <div className="flex items-center gap-3 px-5 pt-6 pb-5">
        <BrandMark className="size-8" />
        <div className="min-w-0">
          <p className="truncate text-base leading-tight font-bold">{adminText("brand_name")}</p>
          <p className="truncate text-meta text-muted-foreground">{adminText("brand_desk")}</p>
        </div>
      </div>
      <nav aria-label={adminText("nav_label")} className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-3 pb-4">
        {NAV_GROUPS.map((group) => {
          const groupItems = items.filter((item) => item.group === group.id);
          if (groupItems.length === 0) return null;
          return (
            <section key={group.id} aria-labelledby={`nav-group-${group.id}`}>
              <h2 id={`nav-group-${group.id}`} className="px-0.5 pb-1.5 text-caption font-medium tracking-wider text-muted-foreground uppercase">
                {adminText(group.labelKey)}
              </h2>
              <ul className="flex flex-col gap-0.5">
                {groupItems.map((item) => (
                  <li key={item.id}>
                    <NavLink
                      item={item}
                      className="flex h-9 items-center gap-3 rounded-lg px-2.5 text-[15px] font-medium text-foreground hover:bg-muted data-[status=active]:bg-sidebar-accent data-[status=active]:font-semibold data-[status=active]:text-sidebar-accent-foreground coarse:h-11"
                    >
                      <item.icon aria-hidden className="size-[18px] shrink-0 text-muted-foreground in-data-[status=active]:text-primary" />
                      <span className="truncate">{adminText(item.labelKey)}</span>
                      <NavCount count={countOf(counts, item.id)} />
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
