/**
 * The distinct list states (LC-9, EXPERIENCE.md State Patterns). An error is its own state with
 * a retry; with rows from an earlier success it also says from when the shown data is (stale).
 * It never falls through to the empty or no-matches text. First load shows skeleton rows; a
 * reload keeps the rows and draws the 2 px progress line instead (LC-8).
 */
import { formatVnTimeOf } from "@cashback/core";
import type { ReactNode } from "react";

import { Button } from "../components/button";
import { Skeleton } from "../components/skeleton";
import { CloudOffIcon, SearchXIcon } from "../icons";
import { uiText } from "../labels";
import { ListFetchError } from "./data-list.types";

export function errorReason(error: unknown): string {
  if (error instanceof ListFetchError && error.status !== null) return uiText("list_error_status", { status: error.status });
  return uiText("list_error_network");
}

export interface ListErrorProps {
  readonly error: unknown;
  readonly staleAsOf: string | null;
  readonly onRetry: () => void;
  /** Set while filters or a search are on: a refused filter must not leave the list stuck. */
  readonly onClear?: (() => void) | undefined;
}

export function ListError({ error, staleAsOf, onRetry, onClear }: ListErrorProps) {
  const time = formatVnTimeOf(staleAsOf);
  const actions = (
    <div className="flex flex-wrap justify-center gap-2">
      {onClear !== undefined && (
        <Button type="button" variant="ghost" className="h-9 coarse:h-11" onClick={onClear}>
          {uiText("list_clear_filters")}
        </Button>
      )}
      <Button type="button" variant="outline" className="h-9 border-border bg-card coarse:h-11" onClick={onRetry}>
        {uiText("list_retry")}
      </Button>
    </div>
  );
  // With earlier rows still on screen the error is a line above them; with none it takes their place (wireframe list error state).
  if (time !== null) {
    return (
      <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-status-rejected-soft px-4 py-3 text-destructive">
        <div className="flex min-w-0 items-start gap-2.5">
          <CloudOffIcon aria-hidden className="mt-0.5 size-5 shrink-0" />
          <div className="min-w-0">
            <p className="font-semibold">{uiText("list_error_title")}</p>
            <p className="text-meta">{errorReason(error)}</p>
            <p className="text-meta">{uiText("list_stale", { time })}</p>
          </div>
        </div>
        {actions}
      </div>
    );
  }
  return (
    <div role="alert" className="flex flex-col items-center gap-2 rounded-xl bg-status-rejected-soft px-6 py-10 text-center text-destructive">
      <CloudOffIcon aria-hidden className="size-7" />
      <p className="text-base font-semibold">{uiText("list_error_title")}</p>
      <p className="text-meta">{errorReason(error)}</p>
      <div className="mt-1">{actions}</div>
    </div>
  );
}

export function ListNoMatches({ onClear }: { readonly onClear: () => void }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-border bg-card px-6 py-10 text-center">
      <SearchXIcon aria-hidden className="size-7 text-foreground" />
      <p className="text-base font-semibold">{uiText("list_no_matches")}</p>
      <Button type="button" variant="outline" className="mt-1 h-9 border-border bg-card coarse:h-11" onClick={onClear}>
        {uiText("list_clear_filters")}
      </Button>
    </div>
  );
}

export function ListEmpty({ text, action }: { readonly text: string; readonly action?: ReactNode }) {
  return (
    <div data-list-empty className="flex flex-col items-center gap-3 rounded-xl border border-border bg-card px-6 py-10 text-center">
      <p className="text-base font-semibold text-muted-foreground">{text}</p>
      {action}
    </div>
  );
}

const SKELETON_BARS = ["w-[100px]", "w-[180px]", "w-[260px]", "w-[100px]", "w-[90px]"];

/** First load only (LC-8): the table's card with grey bars where the rows will be. */
export function ListSkeleton() {
  return (
    <div aria-busy="true" aria-label={uiText("list_loading")} className="flex flex-col divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="flex h-[52px] min-w-0 items-center gap-6 overflow-hidden px-4">
          {SKELETON_BARS.map((width, j) => (
            <Skeleton key={j} className={`h-2.5 shrink rounded-full ${width}`} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function ProgressLine({ active }: { readonly active: boolean }) {
  return <div aria-hidden data-progress={active ? "on" : "off"} className={active ? "h-0.5 w-full animate-pulse bg-primary" : "h-0.5 w-full bg-transparent"} />;
}
