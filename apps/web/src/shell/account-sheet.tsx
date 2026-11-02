/**
 * The signed-in customer's menu in the top bar (EXPERIENCE.md navigation: the customer code on
 * the right opens the account menu). For now it holds the code as a copyable chip and sign-out;
 * the Account page (Story 7.5) adds its link here. A bottom sheet on phone, a right sheet wider.
 */
import { Button, CircleUserIcon, CodeChip, LogOutIcon, Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger, useLayout } from "@cashback/ui";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { webText } from "../labels";
import { useSignOut } from "../session/session.queries";
import { FOCUS_RING } from "./nav-items";

export function AccountSheet({ customerCode }: { readonly customerCode: string }) {
  const [open, setOpen] = useState(false);
  const signOut = useSignOut();
  const navigate = useNavigate();
  const phone = useLayout() === "phone";
  const leave = (): void =>
    signOut.mutate(undefined, {
      onSuccess: () => {
        setOpen(false);
        void navigate({ to: "/" });
      },
    });
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button type="button" aria-label={webText("account_menu", { code: customerCode })} className={`flex h-11 min-w-11 items-center gap-1.5 rounded-lg px-2 font-mono text-sm font-medium hover:bg-muted ${FOCUS_RING}`}>
          <CircleUserIcon aria-hidden className="size-5 text-primary" />
          <span>{customerCode}</span>
        </button>
      </SheetTrigger>
      <SheetContent side={phone ? "bottom" : "right"} className={phone ? "rounded-t-xl pb-[env(safe-area-inset-bottom)]" : "w-[360px]"}>
        <SheetHeader>
          <SheetTitle className="text-lg font-semibold">{webText("account_title")}</SheetTitle>
          <SheetDescription className="sr-only">{webText("account_code")}</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-4 px-4 pb-4">
          <div className="flex items-center justify-between gap-3 rounded-lg bg-muted px-3 py-2.5">
            <span className="text-meta text-muted-foreground">{webText("account_code")}</span>
            <CodeChip code={customerCode} className="bg-card" />
          </div>
          {signOut.isError && (
            <p role="alert" className="text-sm font-medium text-destructive">
              {webText("sign_out_failed")}
            </p>
          )}
          <Button type="button" variant="outline" className="h-11 w-full text-[15px]" disabled={signOut.isPending} onClick={leave}>
            <LogOutIcon aria-hidden />
            {webText("sign_out")}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
