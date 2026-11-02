/**
 * The phone filter sheet (LC-12, wireframe phone filter sheet): the same filters with the same
 * counts as the desktop toolbar, drawn as full-width rows, in a bottom sheet whose button names the
 * filtered count, opened from the filters button that names how many are on. Closing returns focus to the trigger.
 */
import { useState, type ReactNode } from "react";

import { FilterLayoutContext } from "../brand/filter-layout";
import { Button } from "../components/button";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from "../components/sheet";
import { SlidersHorizontalIcon } from "../icons";
import { uiText } from "../labels";

export interface FilterSheetProps {
  readonly activeCount: number;
  readonly summary: string;
  readonly children: ReactNode;
}

export function FilterSheet({ activeCount, summary, children }: FilterSheetProps) {
  const [open, setOpen] = useState(false);
  const label = activeCount > 0 ? uiText("list_filters_button_active", { count: activeCount }) : uiText("list_filters_button");
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button type="button" variant="outline" className="h-11 shrink-0 rounded-lg border-border bg-card px-3.5 text-[15px]">
          <SlidersHorizontalIcon aria-hidden />
          {label}
        </Button>
      </SheetTrigger>
      <SheetContent side="bottom" className="max-h-[85dvh] overflow-y-auto rounded-t-xl pb-[env(safe-area-inset-bottom)]">
        <SheetHeader>
          <SheetTitle className="text-xl font-bold">{uiText("list_filters_title")}</SheetTitle>
          <SheetDescription>{summary}</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-5 px-4">
          <FilterLayoutContext.Provider value="sheet">{children}</FilterLayoutContext.Provider>
        </div>
        <SheetFooter>
          <Button type="button" className="h-12 w-full rounded-xl text-base font-semibold" onClick={() => setOpen(false)}>
            {summary === "" ? uiText("list_filters_done") : uiText("list_filters_show", { summary })}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
