/**
 * The phone filter sheet (LC-12): the same chips with the same counts as the desktop toolbar,
 * in a bottom sheet opened from the filters button that names how many are on. Closing returns focus to the trigger.
 */
import { useState, type ReactNode } from "react";

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
        <Button type="button" variant="outline" className="h-11 shrink-0 bg-card">
          <SlidersHorizontalIcon aria-hidden />
          {label}
        </Button>
      </SheetTrigger>
      <SheetContent side="bottom" className="max-h-[85dvh] overflow-y-auto rounded-t-xl pb-[env(safe-area-inset-bottom)]">
        <SheetHeader>
          <SheetTitle className="text-lg font-semibold">{uiText("list_filters_title")}</SheetTitle>
          <SheetDescription>{summary}</SheetDescription>
        </SheetHeader>
        <div className="px-4">{children}</div>
        <SheetFooter>
          <Button type="button" className="h-11 w-full" onClick={() => setOpen(false)}>
            {uiText("list_filters_done")}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
