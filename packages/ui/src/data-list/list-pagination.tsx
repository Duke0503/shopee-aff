/**
 * Pagination (EXPERIENCE.md anatomy, LC-7): "1–25 / 1.284" with previous and next and the page
 * size on tablet and desktop; "Trang 2 / 26" between previous and next on phone. The range is
 * computed from the page the server returned, so it never reads past the total
 * (list-defects "41 - 40 of 40").
 */
import { Button } from "../components/button";
import { formatCount } from "../format/format-money";
import { ChevronLeftIcon, ChevronRightIcon } from "../icons";
import { uiText } from "../labels";

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

export function ListPagination({ facts, compact, pageSizes, onPage, onPageSize }: ListPaginationProps) {
  const pages = pageCount(facts);
  const prev = (
    <Button type="button" variant="outline" className="h-9 bg-card coarse:h-11 coarse:min-w-11" disabled={facts.page <= 1} onClick={() => onPage(facts.page - 1)} aria-label={uiText("list_prev")}>
      <ChevronLeftIcon aria-hidden />
    </Button>
  );
  const next = (
    <Button type="button" variant="outline" className="h-9 bg-card coarse:h-11 coarse:min-w-11" disabled={facts.page >= pages} onClick={() => onPage(facts.page + 1)} aria-label={uiText("list_next")}>
      <ChevronRightIcon aria-hidden />
    </Button>
  );
  if (compact) {
    return (
      <nav aria-label={uiText("list_pagination")} className="flex items-center justify-between gap-2">
        {prev}
        <span className="text-meta tabular-nums">{uiText("list_page_of", { page: formatCount(facts.page), pages: formatCount(pages) })}</span>
        {next}
      </nav>
    );
  }
  return (
    <nav aria-label={uiText("list_pagination")} className="flex flex-wrap items-center justify-end gap-3">
      <label className="flex items-center gap-2 text-meta text-muted-foreground">
        {uiText("list_page_size")}
        <select value={facts.pageSize} onChange={(event) => onPageSize(Number(event.target.value))} className="h-9 rounded-lg border border-input bg-card px-2 text-sm text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
          {pageSizes.map((size) => (
            <option key={size} value={size}>
              {uiText("list_page_size_option", { count: size })}
            </option>
          ))}
        </select>
      </label>
      <span className="text-meta tabular-nums">{rangeText(facts)}</span>
      <div className="flex gap-1.5">
        {prev}
        {next}
      </div>
    </nav>
  );
}
