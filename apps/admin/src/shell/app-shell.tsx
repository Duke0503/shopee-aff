/**
 * The admin desk shell (Story 4.4, UX-DR4): sidebar from 1280 px, icon rail from 768 px, top bar
 * and bottom tabs below. The same pages at every width; only the navigation is re-composed.
 * A skip link jumps past the navigation to the page.
 */
import type { StaffSessionResponse } from "@cashback/contracts";
import { useLayout } from "@cashback/ui";
import type { ReactNode } from "react";

import { adminText } from "../labels";
import { BottomTabs } from "./bottom-tabs";
import { BrandMark } from "./brand-mark";
import { IconRail } from "./icon-rail";
import { visibleItems } from "./nav-items";
import { Sidebar } from "./sidebar";

export interface AppShellProps {
  readonly staff: StaffSessionResponse;
  readonly onSignOut: () => void;
  /** A line above the page, e.g. a sign-out the server did not confirm. */
  readonly notice?: string | null;
  readonly children: ReactNode;
}

function SkipLink() {
  return (
    <a href="#main" className="sr-only z-50 rounded-md bg-card px-3 py-2 text-sm font-medium focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:ring-3 focus:ring-ring/60">
      {adminText("skip_to_content")}
    </a>
  );
}

function PhoneTopBar() {
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-card pt-[env(safe-area-inset-top)]">
      <div className="flex h-14 items-center gap-2.5 px-4">
        <BrandMark className="size-[30px]" />
        <div className="min-w-0">
          <p className="truncate text-[15px] font-semibold">{adminText("brand_name")}</p>
          <p className="truncate text-caption text-muted-foreground">{adminText("brand_desk")}</p>
        </div>
      </div>
    </header>
  );
}

export function AppShell({ staff, onSignOut, notice = null, children }: AppShellProps) {
  const layout = useLayout();
  const nav = { items: visibleItems(staff.role), staff, onSignOut };
  const main = (padding: string) => (
    <main id="main" tabIndex={-1} className={`min-w-0 flex-1 outline-none ${padding}`}>
      <div className="mx-auto w-full max-w-[1440px] min-w-0">
        {notice !== null && (
          <p role="alert" className="mb-4 rounded-md bg-attention-soft px-3 py-2.5 text-sm font-medium text-attention">
            {notice}
          </p>
        )}
        {children}
      </div>
    </main>
  );
  if (layout === "phone") {
    return (
      <div data-layout="phone" className="min-h-dvh bg-background">
        <SkipLink />
        <PhoneTopBar />
        {main("px-4 pt-4 pb-[calc(56px+env(safe-area-inset-bottom)+24px)]")}
        <BottomTabs {...nav} />
      </div>
    );
  }
  return (
    <div data-layout={layout} className="flex min-h-dvh bg-background">
      <SkipLink />
      {layout === "desktop" ? <Sidebar {...nav} /> : <IconRail {...nav} />}
      {main(layout === "desktop" ? "px-8 py-6" : "px-6 py-5")}
    </div>
  );
}
