/**
 * Pagination (EXPERIENCE.md anatomy, LC-7, wireframe pager): "1–25 / 1.284" and the page size on
 * the left, previous, the page numbers and next on the right on tablet and desktop; on phone the
 * range, then "Trang 2 / 26" between previous and next. The range is
 * computed from the page the server returned, so it never reads past the total
 * (list-defects "41 - 40 of 40").
 */
import { Button } from "../components/button";
import { formatCount } from "../format/format-money";
import { ChevronLeftIcon, ChevronRightIcon } from "../icons";
import { uiText } from "../labels";
import { cn } from "../lib/utils";

export interface PageFacts {
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
}

export function pageCount({ pageSize, total }: PageFacts): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

export function rangeText(facts: PageFacts): string {
  const { page, pageSize, total } = facts;
  if (total === 0) return uiText("list_range", { from: 0, to: 0, total: 0 });
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return uiText("list_range", { from: formatCount(from), to: formatCount(to), total: formatCount(total) });
}

export interface ListPaginationProps {
  readonly facts: PageFacts;
  readonly compact: boolean;
  readonly pageSizes: readonly number[];
  readonly onPage: (page: number) => void;
  readonly onPageSize: (size: number) => void;
}

/** The page numbers to show: all of them up to seven, else the first, the last and the current one with its neighbours; null is a gap. */
export function pageNumbers(page: number, pages: number): readonly (number | null)[] {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  const around = [page - 1, page, page + 1].filter((p) => p > 1 && p < pages);
  const shown = [1, ...around, pages];
  return shown.flatMap((p, i) => (i > 0 && p - (shown[i - 1] ?? p) > 1 ? [null, p] : [p]));
}

const PAGE_BUTTON = "h-8 min-w-8 bg-card px-2 tabular-nums coarse:h-11 coarse:min-w-11";

function PageButtons({ page, pages, onPage }: { readonly page: number; readonly pages: number; readonly onPage: (page: number) => void }) {
  return (
    <>
      {pageNumbers(page, pages).map((p, i) =>
        p === null ? (
          <span key={`gap-${i}`} aria-hidden className="inline-flex h-8 min-w-8 items-center justify-center rounded-lg border border-border bg-card text-sm text-muted-foreground">
            …
          </span>
        ) : (
          <Button
            key={p}
            type="button"
            variant="outline"
            aria-current={p === page ? "page" : undefined}
            aria-label={uiText("list_page_of", { page: formatCount(p), pages: formatCount(pages) })}
            onClick={() => onPage(p)}
            className={cn(PAGE_BUTTON, p === page && "border-primary/25 bg-secondary text-secondary-foreground hover:bg-secondary")}
          >
            {formatCount(p)}
          </Button>
        ),
      )}
    </>
  );
}

export function ListPagination({ facts, compact, pageSizes, onPage, onPageSize }: ListPaginationProps) {
  const pages = pageCount(facts);
  const prev = (
    <Button type="button" variant="outline" className={PAGE_BUTTON} disabled={facts.page <= 1} onClick={() => onPage(facts.page - 1)} aria-label={uiText("list_prev")}>
      <ChevronLeftIcon aria-hidden />
    </Button>
  );
  const next = (
    <Button type="button" variant="outline" className={PAGE_BUTTON} disabled={facts.page >= pages} onClick={() => onPage(facts.page + 1)} aria-label={uiText("list_next")}>
      <ChevronRightIcon aria-hidden />
    </Button>
  );
  const range = <span className="text-meta text-muted-foreground tabular-nums">{rangeText(facts)}</span>;
  if (compact) {
    return (
      <nav aria-label={uiText("list_pagination")} className="flex min-w-0 items-center justify-between gap-2">
        {range}
        <div className="flex items-center gap-1.5">
          {prev}
          <span className="inline-flex h-8 items-center rounded-lg border border-primary/25 bg-secondary px-3 text-sm font-medium text-secondary-foreground tabular-nums coarse:h-11">
            {uiText("list_page_of", { page: formatCount(facts.page), pages: formatCount(pages) })}
          </span>
          {next}
        </div>
      </nav>
    );
  }
  return (
    <nav aria-label={uiText("list_pagination")} className="flex min-w-0 flex-wrap items-center justify-between gap-3">
      <div className="flex min-w-0 flex-wrap items-center gap-3">
        {range}
        <label className="flex items-center gap-2 text-meta text-muted-foreground">
          <span className="sr-only">{uiText("list_page_size")}</span>
          <select aria-label={uiText("list_page_size")} value={facts.pageSize} onChange={(event) => onPageSize(Number(event.target.value))} className="h-8 rounded-lg border border-border bg-card px-2 text-meta text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50 coarse:h-11">
            {pageSizes.map((size) => (
              <option key={size} value={size}>
                {uiText("list_page_size_option", { count: size })}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {prev}
        <PageButtons page={facts.page} pages={pages} onPage={onPage} />
        {next}
      </div>
    </nav>
  );
}
