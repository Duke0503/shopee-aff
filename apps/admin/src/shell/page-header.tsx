/**
 * A page's title and one-line purpose (wireframe page header). From the tablet up the title sits
 * at the top of the page with the purpose under it and the page's main action, if any, at the
 * right. On a phone the title is the sticky top bar instead, with a search button that focuses the
 * page's own search box, or opens Customers where a page has none; the purpose line is left out
 * there, as the wireframe's phone screens do. The title wraps, never overflows.
 */
import { SearchIcon, useLayout } from "@cashback/ui";
import { useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { adminText } from "../labels";
import { FOCUS_RING } from "./nav-link";

export interface PageHeaderProps {
  readonly title: string;
  readonly lead?: ReactNode;
  /** The page's main action (a button), at the right of the title. */
  readonly action?: ReactNode;
}

const SEARCH_BUTTON = `-mr-2 flex size-11 shrink-0 items-center justify-center rounded-lg text-foreground hover:bg-muted ${FOCUS_RING}`;

function TopBarSearch() {
  const navigate = useNavigate();
  const onClick = (): void => {
    const box = document.querySelector<HTMLInputElement>("main input[type=search]");
    if (box !== null) box.focus();
    else void navigate({ to: "/customers" });
  };
  return (
    <button type="button" aria-label={adminText("topbar_search")} className={SEARCH_BUTTON} onClick={onClick}>
      <SearchIcon aria-hidden className="size-5" />
    </button>
  );
}

export function PageHeader({ title, lead, action }: PageHeaderProps) {
  const phone = useLayout() === "phone";
  if (phone) {
    return (
      <>
        <header data-top-bar className="sticky top-0 z-30 -mx-4 -mt-4 mb-4 flex h-14 min-w-0 items-center gap-2 border-b border-border bg-card px-4 pt-[env(safe-area-inset-top)]">
          <h1 className="min-w-0 flex-1 truncate text-lg leading-tight font-bold">{title}</h1>
          <TopBarSearch />
        </header>
        {action !== undefined && <div className="mb-4 flex min-w-0 flex-wrap gap-2">{action}</div>}
      </>
    );
  }
  return (
    <header className="mb-5 flex min-w-0 flex-wrap items-start justify-between gap-x-4 gap-y-3">
      <div className="min-w-0">
        <h1 className="text-2xl leading-tight font-bold tracking-tight break-words md:text-[26px]">{title}</h1>
        {lead !== undefined && <p className="mt-1 text-[15px] text-muted-foreground">{lead}</p>}
      </div>
      {action !== undefined && <div className="flex shrink-0 flex-wrap gap-2">{action}</div>}
    </header>
  );
}
