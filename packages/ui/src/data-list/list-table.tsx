/**
 * The tablet and desktop form of a list (DESIGN.md data table, LC-2, UX-DR13): TanStack Table
 * builds the rows, the server has already sorted and paged them. A sortable header is a button
 * inside a header cell that carries `aria-sort`; a column the list cannot sort by is plain text
 * with no sort affordance (list-defects "sortable headers that do nothing"). Fixed column
 * widths let long text truncate instead of widening the page.
 */
import type { ListSort } from "@cashback/contracts";
import { createColumnHelper, tableFeatures, useTable, type RowData } from "@tanstack/react-table";
import { useMemo } from "react";

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/table";
import { ArrowDownIcon, ArrowUpDownIcon, ArrowUpIcon } from "../icons";
import { cn } from "../lib/utils";
import type { ColumnKind, ListColumn } from "./data-list.types";
import { isNumeric, ListCell } from "./list-cell";

const features = tableFeatures({});

/**
 * Column widths in px by kind, wide enough for the header with its sort arrow and for the
 * widest usual value (a status badge, an amount, a date). Name and text columns share the rest
 * and keep at least FLEX_MIN_PX; below that the table scrolls inside its card, never the page.
 */
const WIDTH: Readonly<Record<ColumnKind, number | null>> = {
  code: 120,
  status: 156,
  money: 112,
  instant: 108,
  integer: 96,
  name: null,
  text: null,
  product: null,
};
export const FLEX_MIN_PX = 120;

export function columnWidth<R>(column: ListColumn<R>): number | null {
  return column.width ?? WIDTH[column.kind];
}

export interface ListTableProps<R> {
  readonly columns: readonly ListColumn<R>[];
  readonly rows: readonly R[];
  readonly rowKey: (row: R) => string;
  readonly sort: ListSort;
  readonly onSort: (column: ListColumn<R>) => void;
}

type AriaSort = "ascending" | "descending" | "none";

function ariaSortOf<R>(column: ListColumn<R>, sort: ListSort): AriaSort | undefined {
  if (column.sortable !== true) return undefined;
  if (sort.field !== column.key) return "none";
  return sort.direction === "asc" ? "ascending" : "descending";
}

function HeaderContent<R>({ column, sort, onSort }: { column: ListColumn<R>; sort: ListSort; onSort: (c: ListColumn<R>) => void }) {
  if (column.sortable !== true) return <span className="block leading-tight break-words">{column.header}</span>;
  const active = sort.field === column.key;
  const Icon = !active ? ArrowUpDownIcon : sort.direction === "asc" ? ArrowUpIcon : ArrowDownIcon;
  return (
    <button
      type="button"
      onClick={() => onSort(column)}
      className={cn(
        "-mx-1 inline-flex min-h-8 max-w-full items-center gap-1 rounded-md px-1 font-medium outline-none hover:bg-border/60 focus-visible:ring-3 focus-visible:ring-ring/50",
        isNumeric(column.kind) ? "text-right" : "text-left",
      )}
    >
      <span className="leading-tight break-words">{column.header}</span>
      <Icon aria-hidden className={cn("size-3.5 shrink-0", active ? "text-foreground" : "text-muted-foreground")} />
    </button>
  );
}

export function ListTable<R extends RowData>({ columns, rows, rowKey, sort, onSort }: ListTableProps<R>) {
  const defs = useMemo(() => {
    const helper = createColumnHelper<typeof features, R>();
    return columns.map((column) => helper.display({ id: column.key, cell: (ctx) => <ListCell column={column} row={ctx.row.original} /> }));
  }, [columns]);
  const data = useMemo(() => [...rows], [rows]);
  const table = useTable({ features, columns: defs, data, getRowId: (row) => rowKey(row) });
  const byId = new Map(columns.map((c) => [c.key as string, c]));

  return (
    <Table className="table-fixed" style={{ minWidth: columns.reduce((sum, c) => sum + (columnWidth(c) ?? FLEX_MIN_PX), 0) }}>
      <TableHeader className="bg-muted">
        <TableRow className="hover:bg-muted">
          {columns.map((column) => (
            <TableHead key={column.key} aria-sort={ariaSortOf(column, sort)} style={columnWidth(column) === null ? undefined : { width: columnWidth(column) ?? undefined }} className={cn("h-11 px-3 py-1 text-[13px] whitespace-normal", isNumeric(column.kind) && "text-right")}>
              <HeaderContent column={column} sort={sort} onSort={onSort} />
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {table.getRowModel().rows.map((row) => (
          <TableRow key={row.id} className="h-11">
            {row.getAllCells().map((cell) => {
              const column = byId.get(cell.column.id);
              return (
                <TableCell key={cell.id} className={cn("px-3 py-1.5 text-[13px]", column !== undefined && isNumeric(column.kind) && "text-right")}>
                  <table.FlexRender cell={cell} />
                </TableCell>
              );
            })}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
