/**
 * The distinct list states (LC-9, EXPERIENCE.md State Patterns). An error is its own state with
 * a retry; with rows from an earlier success it also says from when the shown data is (stale).
 * It never falls through to the empty or no-matches text. First load shows skeleton rows; a
 * reload keeps the rows and draws the 2 px progress line instead (LC-8).
 */
import { formatVnTimeOf } from "@cashback/core";

import { Button } from "../components/button";
import { Skeleton } from "../components/skeleton";
import { RefreshCwIcon } from "../icons";
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
  return (
    <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-attention-soft px-3 py-2.5 text-attention">
      <div className="min-w-0">
        <p className="font-semibold">{uiText("list_error_title")}</p>
        <p className="text-meta">{errorReason(error)}</p>
        {time !== null && <p className="text-meta">{uiText("list_stale", { time })}</p>}
      </div>
      <div className="flex flex-wrap gap-2">
        {onClear !== undefined && (
          <Button type="button" variant="ghost" className="h-9 coarse:h-11" onClick={onClear}>
            {uiText("list_clear_filters")}
          </Button>
        )}
        <Button type="button" variant="outline" className="h-9 coarse:h-11" onClick={onRetry}>
          <RefreshCwIcon aria-hidden />
          {uiText("list_retry")}
        </Button>
      </div>
    </div>
  );
}

export function ListNoMatches({ onClear }: { readonly onClear: () => void }) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-xl border border-border bg-card px-4 py-8">
      <p className="text-base font-semibold text-muted-foreground">{uiText("list_no_matches")}</p>
      <Button type="button" variant="outline" className="h-9 coarse:h-11" onClick={onClear}>
        {uiText("list_clear_filters")}
      </Button>
    </div>
  );
}

export function ListEmpty({ text }: { readonly text: string }) {
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-8">
      <p className="text-base font-semibold text-muted-foreground">{text}</p>
    </div>
  );
}

export function ListSkeleton() {
  return (
    <div aria-busy="true" aria-label={uiText("list_loading")} className="flex flex-col gap-2 rounded-xl border border-border bg-card p-3">
      {Array.from({ length: 6 }, (_, i) => (
        <Skeleton key={i} className="h-9 w-full" />
      ))}
    </div>
  );
}

export function ProgressLine({ active }: { readonly active: boolean }) {
  return <div aria-hidden data-progress={active ? "on" : "off"} className={active ? "h-0.5 w-full animate-pulse bg-primary" : "h-0.5 w-full bg-transparent"} />;
}
