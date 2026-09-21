import * as React from "react"
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react"
import { cn } from "@/lib/utils"

export interface SortableHeaderProps {
  title: React.ReactNode
  column: string
  currentSortBy?: string
  currentSortOrder?: "asc" | "desc"
  onSort: (column: string, order: "asc" | "desc") => void
  align?: "left" | "center" | "right"
  className?: string
  defaultOrder?: "asc" | "desc"
}

export function SortableHeader({
  title,
  column,
  currentSortBy,
  currentSortOrder = "desc",
  onSort,
  align = "left",
  className,
  defaultOrder = "desc",
}: SortableHeaderProps) {
  const isActive = currentSortBy === column

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault()
    if (isActive) {
      // Toggle order
      onSort(column, currentSortOrder === "asc" ? "desc" : "asc")
    } else {
      // Default initial order when switching to this column
      onSort(column, defaultOrder)
    }
  }

  const justifyClass =
    align === "right"
      ? "justify-end text-right"
      : align === "center"
      ? "justify-center text-center"
      : "justify-start text-left"

  return (
    <button
      type="button"
      onClick={handleClick}
      className={cn(
        "group inline-flex items-center gap-1.5 py-1 text-xs font-semibold select-none cursor-pointer transition-all duration-150 rounded px-1 -mx-1 hover:bg-secondary/70 focus:outline-none focus-visible:ring-1 focus-visible:ring-primary",
        justifyClass,
        isActive
          ? "text-primary dark:text-primary font-bold bg-primary/5"
          : "text-muted-foreground hover:text-foreground",
        className
      )}
      title={`Nhấp để sắp xếp theo ${typeof title === "string" ? title : column} (${
        isActive ? (currentSortOrder === "asc" ? "tăng dần" : "giảm dần") : "chưa chọn"
      })`}
    >
      <span className="truncate">{title}</span>
      <span className="shrink-0 inline-flex items-center">
        {isActive ? (
          currentSortOrder === "asc" ? (
            <ArrowUp className="h-3.5 w-3.5 text-primary stroke-[2.5] animate-in fade-in zoom-in-75 duration-150" />
          ) : (
            <ArrowDown className="h-3.5 w-3.5 text-primary stroke-[2.5] animate-in fade-in zoom-in-75 duration-150" />
          )
        ) : (
          <ChevronsUpDown className="h-3.5 w-3.5 text-muted-foreground/35 group-hover:text-muted-foreground/80 transition-opacity" />
        )}
      </span>
    </button>
  )
}
