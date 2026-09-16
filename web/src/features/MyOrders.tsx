import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table"
import { useState } from "react"
import { Icon } from "@/lib/icons"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { MyOrder } from "@/lib/api"
import { shortDate, vnd } from "@/lib/format"
import { useT } from "@/lib/labels"

// The same four colours the rest of the site uses for these states.
const TONE = {
  awaiting_approval: "warning",
  approved: "info",
  paid: "success",
  rejected: "danger",
} as const

export function MyOrdersTable({ orders }: { orders: MyOrder[] }) {
  const t = useT()
  const [sorting, setSorting] = useState<SortingState>([])

  const columns: ColumnDef<MyOrder>[] = [
    {
      accessorKey: "product",
      header: () => t("col_product"),
      cell: ({ row }) => (
        <div className="min-w-0">
          <div className="max-w-[24ch] truncate font-medium sm:max-w-[40ch]">
            {row.original.product || row.original.order_id}
          </div>
          <div className="text-muted-foreground font-mono text-[11px]">
            {row.original.order_id}
          </div>
        </div>
      ),
    },
    {
      accessorKey: "status",
      header: () => t("col_status"),
      cell: ({ row }) => (
        <div className="space-y-1">
          <Badge variant={TONE[row.original.status]}>
            {t(`status_${row.original.status}`)}
          </Badge>
          {/* A rejection without a reason reads as arbitrary. */}
          {row.original.rejection_reason && (
            <div className="text-muted-foreground text-[11px]">
              {row.original.rejection_reason}
            </div>
          )}
        </div>
      ),
    },
    {
      accessorKey: "order_value",
      header: () => t("col_value"),
      cell: ({ getValue }) => (
        <span className="tnum text-muted-foreground">
          {vnd(getValue<number | null>())}
        </span>
      ),
    },
    {
      accessorKey: "cashback",
      header: () => t("col_cashback"),
      cell: ({ row }) => (
        <span className="tnum font-semibold">
          {vnd(row.original.cashback)}
          {row.original.is_estimate && (
            <span className="text-muted-foreground ml-1 text-[11px] font-normal">
              {t("estimate_note")}
            </span>
          )}
        </span>
      ),
    },
    {
      id: "when",
      header: () => t("col_date"),
      cell: ({ row }) => (
        <span className="tnum text-muted-foreground">
          {shortDate(
            row.original.paid_at ??
              row.original.approved_at ??
              row.original.recorded_at,
          )}
        </span>
      ),
    },
    {
      id: "link",
      header: () => t("col_link"),
      cell: ({ row }) => {
        const url = row.original.affiliate_url ?? row.original.source_url
        if (!url) return <span className="text-muted-foreground">—</span>
        return (
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="text-primary inline-flex items-center gap-1 hover:underline"
          >
            {t("btn_open_link")}
            <Icon.open className="size-3" />
          </a>
        )
      },
    },
  ]

  const table = useReactTable({
    data: orders,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  })

  return (
    <div className="bg-card rounded-lg border">
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((group) => (
            <TableRow key={group.id}>
              {group.headers.map((header) => (
                <TableHead key={header.id}>
                  {flexRender(
                    header.column.columnDef.header,
                    header.getContext(),
                  )}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.map((row) => (
            <TableRow key={row.id}>
              {row.getVisibleCells().map((cell) => (
                <TableCell key={cell.id} className="text-xs">
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
