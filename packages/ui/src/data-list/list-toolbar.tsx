/**
 * The list toolbar (EXPERIENCE.md List Contract anatomy): one search box naming the searched
 * fields (LC-3), the refresh button with the time of the shown data, and on phone the sort Select and
 * the filter sheet trigger with the active filter count (LC-12). `/` focuses the search on the admin desk.
 */
import type { ListSort } from "@cashback/contracts";
import { formatVnTimeOf } from "@cashback/core";
import { useEffect, useRef, type ReactNode } from "react";

import { Button } from "../components/button";
import { Input } from "../components/input";
import { ChevronDownIcon, RefreshCwIcon, SearchIcon } from "../icons";
import { uiText } from "../labels";
import type { ListColumn } from "./data-list.types";
import { useDebouncedSearch } from "./use-debounced-search";

export interface SearchBoxProps {
  readonly committed: string;
  readonly placeholder: string;
  readonly onCommit: (q: string) => void;
}

export function SearchBox({ committed, placeholder, onCommit }: SearchBoxProps) {
  const { value, setValue, flush } = useDebouncedSearch(committed, onCommit);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      const typing = target !== null && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if (event.key === "/" && !typing) {
        event.preventDefault();
        input.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  return (
    <div className="relative min-w-0 flex-1 md:max-w-[400px] md:min-w-[200px]">
      <SearchIcon aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        ref={input}
        type="search"
        aria-label={uiText("list_search_label")}
        placeholder={placeholder}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") flush();
        }}
        className="h-10 rounded-lg bg-card pl-9 text-base text-ellipsis md:text-sm coarse:h-11"
      />
    </div>
  );
}

export function RefreshButton({ asOf, onRefresh }: { readonly asOf: string | undefined; readonly onRefresh: () => void }) {
  const time = formatVnTimeOf(asOf);
  return (
    <Button type="button" variant="ghost" className="h-9 shrink-0 text-muted-foreground coarse:h-11 coarse:min-w-11" onClick={onRefresh} aria-label={time === null ? uiText("list_refresh") : undefined}>
      <RefreshCwIcon aria-hidden />
      {time !== null && <span className="text-meta">{uiText("list_updated_at", { time })}</span>}
    </Button>
  );
}

export interface SortSelectProps<R> {
  readonly columns: readonly ListColumn<R>[];
  readonly sort: ListSort;
  readonly onChange: (sort: ListSort) => void;
  readonly label?: ((column: string, direction: "asc" | "desc") => string) | undefined;
  readonly className?: string;
  /** The desk's phone toolbar: a quiet text select at the right of the count line, named but not labelled visibly. */
  readonly compact?: boolean;
}

/** A native select on phone: the platform picker is the easiest control on a touch screen. */
export function SortSelect<R>({ columns, sort, onChange, label, className, compact = false }: SortSelectProps<R>) {
  const words = label ?? ((column: string, direction: "asc" | "desc") => uiText(direction === "asc" ? "list_sort_asc" : "list_sort_desc", { column }));
  const options = columns.filter((c) => c.sortable === true).flatMap((c) => [
    { value: `${c.key}:asc`, label: words(c.header, "asc") },
    { value: `${c.key}:desc`, label: words(c.header, "desc") },
  ]);
  const choose = (value: string): void => {
    const [field = "", direction = "asc"] = value.split(":");
    onChange({ field, direction: direction === "desc" ? "desc" : "asc" });
  };
  if (compact) {
    return (
      <span className={className ?? "relative inline-flex min-w-0 shrink items-center"}>
        <select
          aria-label={uiText("list_sort_label")}
          value={`${sort.field}:${sort.direction}`}
          onChange={(event) => choose(event.target.value)}
          className="h-11 max-w-full min-w-0 cursor-pointer appearance-none truncate rounded-md bg-transparent pr-6 pl-1 text-right text-sm font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <ChevronDownIcon aria-hidden className="pointer-events-none absolute right-1 size-4 text-muted-foreground" />
      </span>
    );
  }
  return (
    <label className={className ?? "flex min-w-0 flex-1 flex-col gap-1"}>
      <span className="text-caption text-muted-foreground">{uiText("list_sort_label")}</span>
      <select
        value={`${sort.field}:${sort.direction}`}
        onChange={(event) => choose(event.target.value)}
        className="h-11 w-full min-w-0 truncate rounded-lg border border-input bg-card px-2.5 text-[15px] outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function ToolbarRow({ children }: { readonly children: ReactNode }) {
  return <div className="flex min-w-0 flex-wrap items-center gap-2">{children}</div>;
}
