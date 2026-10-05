import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react"

interface PaginationBarProps {
  page: number
  totalPages: number
  totalItems: number
  limit: number
  onPageChange: (newPage: number) => void
  onLimitChange?: (newLimit: number) => void
  pageSizeOptions?: number[]
}

export function PaginationBar({
  page,
  totalPages,
  totalItems,
  limit,
  onPageChange,
  onLimitChange,
  pageSizeOptions = [10, 20, 50, 100],
}: PaginationBarProps) {
  if (totalItems <= 0) return null

  const start = (page - 1) * limit + 1
  const end = Math.min(page * limit, totalItems)

  // Smart page numbers calculation
  const getPageNumbers = () => {
    const pages: (number | string)[] = []
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i)
    } else {
      pages.push(1)
      if (page > 3) pages.push("...")
      const startRange = Math.max(2, page - 1)
      const endRange = Math.min(totalPages - 1, page + 1)
      for (let i = startRange; i <= endRange; i++) pages.push(i)
      if (page < totalPages - 2) pages.push("...")
      pages.push(totalPages)
    }
    return pages
  }

  return (
    <div className="flex flex-col items-center justify-between gap-2 border-t border-border/70 px-3 py-1.5 sm:flex-row text-[11px]">
      {/* Left: Info & Limit Selector */}
      <div className="flex flex-wrap items-center gap-2.5 text-[11px] text-muted-foreground">
        <span>
          Hiển thị <strong className="text-foreground">{start}</strong> -{" "}
          <strong className="text-foreground">{end}</strong> trên{" "}
          <strong className="text-foreground">{totalItems}</strong> kết quả
        </span>

        {onLimitChange && (
          <div className="flex items-center gap-1 border-l border-border/70 pl-2.5">
            <span>Dòng/trang:</span>
            <select
              value={limit}
              onChange={(e) => onLimitChange(Number(e.target.value))}
              className="rounded-md border border-border/80 bg-background px-1.5 py-0.5 h-6 text-[11px] font-semibold text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            >
              {pageSizeOptions.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Right: Page Navigation Buttons */}
      <div className="flex items-center gap-1">
        {/* First */}
        <button
          onClick={() => onPageChange(1)}
          disabled={page <= 1}
          title="Trang đầu"
          className="flex h-6.5 w-6.5 items-center justify-center rounded-md border border-border/80 bg-background text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-40 disabled:pointer-events-none"
        >
          <ChevronsLeft className="h-3 w-3" />
        </button>

        {/* Previous */}
        <button
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          title="Trang trước"
          className="flex h-6.5 w-6.5 items-center justify-center rounded-md border border-border/80 bg-background text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-40 disabled:pointer-events-none"
        >
          <ChevronLeft className="h-3 w-3" />
        </button>

        {/* Page numbers */}
        <div className="flex items-center gap-0.5">
          {getPageNumbers().map((p, idx) => {
            if (p === "...") {
              return (
                <span
                  key={`ellipsis-${idx}`}
                  className="flex h-6.5 w-5 items-center justify-center text-[11px] text-muted-foreground"
                >
                  ...
                </span>
              )
            }
            const isCurrent = p === page
            return (
              <button
                key={p}
                onClick={() => onPageChange(Number(p))}
                className={`flex h-6.5 min-w-[26px] items-center justify-center rounded-md px-1.5 text-[11px] font-semibold transition-all ${
                  isCurrent
                    ? "bg-primary text-primary-foreground shadow-2xs"
                    : "border border-border/80 bg-background text-muted-foreground hover:bg-secondary hover:text-foreground"
                }`}
              >
                {p}
              </button>
            )
          })}
        </div>

        {/* Next */}
        <button
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
          title="Trang sau"
          className="flex h-6.5 w-6.5 items-center justify-center rounded-md border border-border/80 bg-background text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-40 disabled:pointer-events-none"
        >
          <ChevronRight className="h-3 w-3" />
        </button>

        {/* Last */}
        <button
          onClick={() => onPageChange(totalPages)}
          disabled={page >= totalPages}
          title="Trang cuối"
          className="flex h-6.5 w-6.5 items-center justify-center rounded-md border border-border/80 bg-background text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-40 disabled:pointer-events-none"
        >
          <ChevronsRight className="h-3 w-3" />
        </button>
      </div>
    </div>
  )
}
