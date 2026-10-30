/**
 * The admin desk's navigation (EXPERIENCE.md Information Architecture, Story 4.4): three groups
 * on the sidebar, the same items on the tablet rail, four of them as phone tabs plus More.
 * Admin-only items (FR-24: staff accounts and campaigns) are hidden from employees, not
 * disabled; the server refuses them anyway (403).
 */
import type { StaffRole } from "@cashback/core";
import { BanknoteIcon, ClipboardCheckIcon, GiftIcon, LayoutDashboardIcon, LinkIcon, ReceiptIcon, ScrollTextIcon, SettingsIcon, UserCogIcon, UsersIcon, type LucideIcon } from "@cashback/ui";

import type { AdminKey } from "../labels";

export type NavGroup = "daily" | "customers" | "admin";

export interface NavItem {
  readonly id: string;
  /** Path inside the desk (the router adds /admin). */
  readonly to: "/" | "/payouts" | "/review" | "/orders" | "/customers" | "/links" | "/campaigns" | "/staff" | "/audit" | "/settings";
  readonly labelKey: AdminKey;
  readonly icon: LucideIcon;
  readonly group: NavGroup;
  readonly adminOnly?: boolean;
  /** The phone tab label, for the four items that are tabs. */
  readonly tabKey?: AdminKey;
}

export const NAV_GROUPS: readonly { readonly id: NavGroup; readonly labelKey: AdminKey }[] = [
  { id: "daily", labelKey: "nav_group_daily" },
  { id: "customers", labelKey: "nav_group_customers" },
  { id: "admin", labelKey: "nav_group_admin" },
];

export const NAV_ITEMS: readonly NavItem[] = [
  { id: "overview", to: "/", labelKey: "nav_overview", icon: LayoutDashboardIcon, group: "daily", tabKey: "tab_overview" },
  { id: "payouts", to: "/payouts", labelKey: "nav_payouts", icon: BanknoteIcon, group: "daily", tabKey: "tab_payouts" },
  { id: "review", to: "/review", labelKey: "nav_review", icon: ClipboardCheckIcon, group: "daily" },
  { id: "orders", to: "/orders", labelKey: "nav_orders", icon: ReceiptIcon, group: "daily", tabKey: "tab_orders" },
  { id: "customers", to: "/customers", labelKey: "nav_customers", icon: UsersIcon, group: "customers", tabKey: "tab_customers" },
  { id: "links", to: "/links", labelKey: "nav_links", icon: LinkIcon, group: "customers" },
  { id: "campaigns", to: "/campaigns", labelKey: "nav_campaigns", icon: GiftIcon, group: "customers", adminOnly: true },
  { id: "staff", to: "/staff", labelKey: "nav_staff", icon: UserCogIcon, group: "admin", adminOnly: true },
  { id: "audit", to: "/audit", labelKey: "nav_audit", icon: ScrollTextIcon, group: "admin" },
  { id: "settings", to: "/settings", labelKey: "nav_settings", icon: SettingsIcon, group: "admin" },
];

export function visibleItems(role: StaffRole): readonly NavItem[] {
  return NAV_ITEMS.filter((item) => item.adminOnly !== true || role === "ADMIN");
}

export const isTab = (item: NavItem): boolean => item.tabKey !== undefined;
