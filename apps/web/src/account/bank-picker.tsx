/**
 * The bank picker of the bank form (UX-DR9, EXPERIENCE.md bank account form, FR-10): a field-like
 * button that opens the VietQR bank list, searched as the customer types (short name or full
 * name, accents ignored). Several matches stay listed to pick from; nothing is ever guessed, since
 * the same number at another bank pays a stranger. A drawer from the bottom on phone, a side sheet
 * wider (Story 7.5 AC5).
 */
import type { BankChoice } from "@cashback/contracts";
import { Button, cn, Input, LandmarkIcon, RefreshCwIcon, SearchIcon, Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, Skeleton, useLayout } from "@cashback/ui";
import { useMemo, useState } from "react";

import { foldText } from "../api/field-errors";
import { webText } from "../labels";
import { ChevronsUpDownIcon } from "../shell/page-icons";
import { useBankList } from "./account.queries";

interface BankPickerProps {
  readonly value: BankChoice | null;
  readonly onChange: (bank: BankChoice) => void;
  readonly error: string | undefined;
}

function BankList({ query, onPick }: { readonly query: string; readonly onPick: (bank: BankChoice) => void }) {
  const list = useBankList(true);
  const banks = useMemo(() => {
    const needle = foldText(query).replace(/\s+/g, "");
    const all = list.data?.banks ?? [];
    return needle === "" ? all : all.filter((b) => foldText(`${b.shortName} ${b.name}`).replace(/\s+/g, "").includes(needle));
  }, [list.data, query]);
  if (list.isPending) return <Skeleton className="mx-4 h-40 rounded-lg" aria-label={webText("loading")} />;
  if (list.isError) {
    return (
      <div role="alert" className="flex flex-col items-start gap-3 px-4">
        <p className="text-[15px]">{webText("bank_list_error")}</p>
        <Button type="button" variant="outline" className="h-11 px-4 text-[15px]" onClick={() => void list.refetch()}>
          <RefreshCwIcon aria-hidden />
          {webText("retry")}
        </Button>
      </div>
    );
  }
  if (banks.length === 0) return <p className="px-4 text-[15px] text-muted-foreground">{webText("bank_search_empty")}</p>;
  return (
    <ul className="flex flex-col overflow-y-auto px-2 pb-4" data-bank-list>
      {banks.map((bank) => (
        <li key={bank.bin}>
          <button type="button" onClick={() => onPick(bank)} className="flex min-h-12 w-full flex-col items-start rounded-lg px-2 py-2 text-left hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
            <span className="text-[15px] font-semibold">{bank.shortName}</span>
            <span className="text-meta text-muted-foreground">{bank.name}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export function BankPicker({ value, onChange, error }: BankPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const phone = useLayout() === "phone";
  const pick = (bank: BankChoice): void => {
    onChange(bank);
    setOpen(false);
    setQuery("");
  };
  return (
    <div className="flex flex-col gap-1.5">
      <span id="bank-field-label" className="text-[15px] font-semibold">
        {webText("bank_field_bank")}
      </span>
      <button
        type="button"
        aria-labelledby="bank-field-label bank-field-value"
        aria-invalid={error !== undefined}
        aria-describedby={error === undefined ? undefined : "bank-field-error"}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        className={cn(
          "flex h-12 w-full items-center gap-3 rounded-xl border border-input bg-card px-4 text-left text-base focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none md:text-[17px]",
          error !== undefined && "border-destructive",
        )}
      >
        <LandmarkIcon aria-hidden className="size-5 shrink-0 text-muted-foreground" />
        <span id="bank-field-value" className={cn("min-w-0 flex-1 truncate", value === null && "text-muted-foreground")}>
          {value === null ? webText("bank_pick") : value.shortName}
        </span>
        <ChevronsUpDownIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      </button>
      {error !== undefined ? (
        <p id="bank-field-error" className="text-meta font-medium text-destructive">
          {error}
        </p>
      ) : (
        <p className="text-meta text-muted-foreground">{webText("bank_pick_hint")}</p>
      )}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side={phone ? "bottom" : "right"} data-bank-picker={phone ? "drawer" : "sheet"} className={cn("flex flex-col gap-3", phone ? "h-[85dvh] rounded-t-xl pb-[env(safe-area-inset-bottom)]" : "w-[400px]")}>
          <SheetHeader className="pb-0">
            <SheetTitle className="text-lg font-semibold">{webText("bank_pick")}</SheetTitle>
            <SheetDescription>{webText("bank_pick_lead")}</SheetDescription>
          </SheetHeader>
          <div className="relative px-4">
            <SearchIcon aria-hidden className="pointer-events-none absolute top-3 left-7 size-5 text-muted-foreground" />
            <Input type="search" aria-label={webText("bank_search")} placeholder={webText("bank_search")} value={query} onChange={(e) => setQuery(e.target.value)} className="h-11 pl-10 text-base md:text-base" />
          </div>
          <BankList query={query} onPick={pick} />
        </SheetContent>
      </Sheet>
    </div>
  );
}
