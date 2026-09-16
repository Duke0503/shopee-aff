import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
} from "@tanstack/react-table"
import { ExternalLink } from "lucide-react"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useT } from "@/lib/labels"
import { shortDate, vnd } from "@/lib/format"
import type { OrderRow } from "@/lib/api"

/**
 * The orders behind one balance.
 *
 * The affiliate link is the point of this table: it lets the operator
 * open the order on Shopee and check the figure before any money moves.
 */
export function OrdersTable({ orders }: { orders: OrderRow[] }) {
  const t = useT()

  const columns: ColumnDef<OrderRow>[] = [
    {
      accessorKey: "product",
      header: () => t("col_product"),
      cell: ({ row }) => (
        <span className="block max-w-[22ch] truncate sm:max-w-[34ch]">
          {row.original.product || row.original.order_id}
        </span>
      ),
    },
    {
      accessorKey: "approved_commission",
      header: () => t("col_commission"),
      cell: ({ getValue }) => (
        <span className="tnum text-muted-foreground">
          {vnd(getValue<number | null>())}
        </span>
      ),
    },
    {
      accessorKey: "cashback_amount",
      header: () => t("col_cashback"),
      cell: ({ getValue }) => (
        <span className="tnum font-medium">{vnd(getValue<number | null>())}</span>
      ),
    },
    {
      accessorKey: "approved_at",
      header: () => t("col_date"),
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
    data: orders,
    columns,
    getCoreRowModel: getCoreRowModel(),
  })

  return (
    <div className="mt-3 rounded-md border">
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
