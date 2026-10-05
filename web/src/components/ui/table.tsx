import * as React from "react"
import { cn } from "@/lib/utils"

function Table({ className, ...props }: React.ComponentProps<"table">) {
  return (
    <div className="w-full overflow-x-auto rounded-lg border border-border/80 shadow-2xs">
      <table
        className={cn("w-full caption-bottom text-[11px] border-collapse", className)}
        {...props}
      />
    </div>
  )
}

const TableHeader = ({ className, ...p }: React.ComponentProps<"thead">) => (
  <thead
    className={cn(
      "border-b border-border bg-muted/80 dark:bg-muted/50 text-[10.5px] font-bold text-muted-foreground uppercase tracking-wider",
      className
    )}
    {...p}
  />
)

const TableBody = ({ className, ...p }: React.ComponentProps<"tbody">) => (
  <tbody
    className={cn(
      "[&_tr:last-child]:border-0",
      // Sọc ngang xen kẽ (Zebra striping) rõ ràng cho tất cả các bảng
      "[&_tr:nth-child(even)]:bg-muted/60 dark:[&_tr:nth-child(even)]:bg-muted/30",
      "[&_tr:nth-child(odd)]:bg-background",
      className
    )}
    {...p}
  />
)

const TableRow = ({ className, ...p }: React.ComponentProps<"tr">) => (
  <tr
    className={cn(
      "border-b border-border/70 transition-colors hover:!bg-primary/10 dark:hover:!bg-primary/20",
      className
    )}
    {...p}
  />
)

const TableHead = ({ className, ...p }: React.ComponentProps<"th">) => (
  <th
    className={cn(
      "text-muted-foreground h-8 px-2.5 py-1 text-left align-middle text-[11px] font-semibold whitespace-nowrap border-r border-border/80 last:border-r-0",
      className,
    )}
    {...p}
  />
)

const TableCell = ({ className, ...p }: React.ComponentProps<"td">) => (
  <td
    className={cn(
      "px-2.5 py-1.5 align-middle border-r border-border/70 last:border-r-0 text-[11px]",
      className
    )}
    {...p}
  />
)

export { Table, TableHeader, TableBody, TableRow, TableHead, TableCell }
