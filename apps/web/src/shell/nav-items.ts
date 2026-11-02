/** The website's three main pages (EXPERIENCE.md navigation): the phone tabs and the wider top bar links. */
import { CUSTOMER_PATHS } from "@cashback/contracts";
import { BookOpenIcon, HouseIcon, WalletIcon, type LucideIcon } from "@cashback/ui";

import type { WebKey } from "../labels";

export interface NavItem {
  readonly to: string;
  readonly labelKey: WebKey;
  readonly icon: LucideIcon;
  /** Home is active only on its own path, not under every page. */
  readonly exact: boolean;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { to: CUSTOMER_PATHS.home, labelKey: "nav_home", icon: HouseIcon, exact: true },
  { to: CUSTOMER_PATHS.myMoney, labelKey: "nav_my_money", icon: WalletIcon, exact: false },
  { to: CUSTOMER_PATHS.guide, labelKey: "nav_guide", icon: BookOpenIcon, exact: false },
];

export const FOCUS_RING = "outline-none focus-visible:ring-3 focus-visible:ring-ring/50";
