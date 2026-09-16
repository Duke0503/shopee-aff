import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table"
import { useState } from "react"
import { ArrowUpDown, ExternalLink } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { PipelineRow } from "@/lib/api"
import { shortDate, vnd } from "@/lib/format"
import { useT } from "@/lib/labels"

/**
 * Orders Shopee has recorded but not settled.
 *
 * None of this is payable and none of it is counted as owed. It is here
 * because a console showing only what is payable is blank most days,
 * which reads as the bot having stopped working.
 */
export function PipelineTable({ rows }: { rows: PipelineRow[] }) {
  const t = useT()
  const [sorting, setSorting] = useState<SortingState>([
    { id: "recorded_at", desc: true },
  ])

  const sortable = (id: string, label: string) => ({
    header: ({ column }: { column: { toggleSorting: (d?: boolean) => void; getIsSorted: () => false | string } }) => (
      <Button
        variant="ghost"
        size="sm"
        className="-ml-3 h-7 px-2 text-xs"
        onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
      >
        {label}
        <ArrowUpDown className="size-3" />
      </Button>
    ),
    id,
  })

  const columns: ColumnDef<PipelineRow>[] = [
    {
      accessorKey: "display_name",
      ...sortable("display_name", t("col_customer")),
      cell: ({ row }) => (
        <div className="min-w-0">
          <div className="truncate font-medium">
            {row.original.display_name || row.original.customer_id}
          </div>
          <div className="text-muted-foreground font-mono text-[11px]">
            {row.original.customer_id}
          </div>
        </div>
      ),
    },
    {
      accessorKey: "product",
      header: () => t("col_product"),
      cell: ({ row }) => (
        <span className="block max-w-[20ch] truncate sm:max-w-[36ch]">
          {row.original.product || row.original.order_id}
        </span>
      ),
    },
    {
      accessorKey: "order_value",
      ...sortable("order_value", t("col_value")),
      cell: ({ getValue }) => (
        <span className="tnum text-muted-foreground">
          {vnd(getValue<number | null>())}
        </span>
      ),
    },
    {
      accessorKey: "cashback",
      ...sortable("cashback", t("col_cashback")),
      cell: ({ getValue }) => (
        <span className="tnum font-medium">
          {vnd(getValue<number>())}{" "}
          <span className="text-muted-foreground text-[11px] font-normal">
            {t("estimate_note")}
          </span>
        </span>
      ),
    },
    {
      accessorKey: "recorded_at",
      ...sortable("recorded_at", t("col_date")),
      cell: ({ getValue }) => (
        <span className="tnum text-muted-foreground">
          {shortDate(getValue<string | null>())}
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
            <ExternalLink className="size-3" />
          </a>
        )
      },
    },
  ]

  const table = useReactTable({
    data: rows,
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
