/**
 * The tablet table's columns menu (`list_columns`) (EXPERIENCE.md responsive rules, Story 4.14 AC6): on a tablet the
 * secondary columns (`desktopOnly`) start hidden so the table fits, and this menu lists them as
 * checkboxes to show any of them again. It changes only which columns are drawn: every value, sort
 * and figure stays the server's, the same as on desktop. The choice is a view preference of this
 * screen, not list state, so it is kept in memory and never written to the URL.
 */
import { useCallback, useEffect, useId, useRef, useState, type RefObject } from "react";

import { Button } from "../components/button";
import { Columns3Icon } from "../icons";
import { uiText } from "../labels";
import type { ListColumn } from "./data-list.types";

export interface ColumnsMenuProps<R> {
  /** The columns the tablet hides by default. */
  readonly columns: readonly ListColumn<R>[];
  readonly shown: readonly string[];
  readonly onChange: (shown: readonly string[]) => void;
}

/** Closes an open popover on a pointer press outside `root` or on Escape. */
function useDismiss(
  open: boolean,
  close: () => void,
  root: RefObject<HTMLDivElement | null>,
): void {
  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent): void => {
      if (root.current !== null && !root.current.contains(event.target as Node)) close();
    };
    const escape = (event: KeyboardEvent): void => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", escape);
    };
  }, [open, close, root]);
}

export function ColumnsMenu<R>({ columns, shown, onChange }: ColumnsMenuProps<R>) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const root = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, close, root);
  const toggle = (key: string): void =>
    onChange(shown.includes(key) ? shown.filter((k) => k !== key) : [...shown, key]);
  return (
    <div ref={root} className="relative shrink-0">
      <Button
        type="button"
        variant="outline"
        className="h-9 coarse:h-11"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
      >
        <Columns3Icon aria-hidden />
        <span>{uiText("list_columns")}</span>
      </Button>
      {open && (
        <div
          id={panelId}
          role="group"
          aria-label={uiText("list_columns_title")}
          className="absolute top-full right-0 z-20 mt-1 flex w-64 max-w-[calc(100vw-2rem)] flex-col gap-1 rounded-lg border border-border bg-card p-2 shadow-md"
        >
          <p className="px-1 pb-1 text-caption text-muted-foreground">
            {uiText("list_columns_title")}
          </p>
          {columns.map((c) => (
            <label
              key={c.key}
              className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-1 text-sm hover:bg-muted"
            >
              <input
                type="checkbox"
                className="size-4 accent-primary"
                checked={shown.includes(c.key)}
                onChange={() => toggle(c.key)}
              />
              <span className="min-w-0 break-words">{c.header}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
