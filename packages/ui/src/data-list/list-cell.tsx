/**
 * One cell, by the column's kind: codes as code chips, amounts through the money figure, dates
 * through the shared Vietnam date formatter, statuses through the registry badge. A null or
 * empty value is the grey dash (LC-15); text truncates with an ellipsis instead of overflowing.
 */
import { formatVnDateOf, systemClock, type Clock } from "@cashback/core";

import { CodeChip } from "../brand/code-chip";
import { MissingValue, MoneyFigure } from "../brand/money-figure";
import { ProductThumb } from "../brand/product-thumb";
import { StatusBadge } from "../brand/status-badge";
import { formatCount } from "../format/format-money";
import type { ListColumn } from "./data-list.types";

export interface ListCellProps<R> {
  readonly column: ListColumn<R>;
  readonly row: R;
  readonly clock?: Clock;
}

/** A product: the thumbnail and the name, at most two lines, then an ellipsis (LC-17, memlog 2026-10-30). */
function ProductCell<R>({ column, row }: { column: ListColumn<R>; row: R }) {
  const name: unknown = row[column.key];
  const image: unknown = column.imageKey === undefined ? null : row[column.imageKey];
  return (
    <span className="flex min-w-0 items-center gap-2">
      <ProductThumb src={typeof image === "string" ? image : null} />
      {typeof name === "string" && name !== "" ? (
        <span className="line-clamp-2 min-w-0 leading-snug break-words whitespace-normal" title={name}>
          {name}
        </span>
      ) : (
        <MissingValue />
      )}
    </span>
  );
}

export function ListCell<R>({ column, row, clock = systemClock }: ListCellProps<R>) {
  if (column.kind === "product") return <ProductCell column={column} row={row} />;
  const value: unknown = row[column.key];
  if (value === null || value === undefined || value === "") return <MissingValue />;
  switch (column.kind) {
    case "money":
      return <MoneyFigure amount={typeof value === "number" ? value : null} />;
    case "code":
      return <CodeChip code={String(value)} />;
    case "status":
      return column.entity === undefined ? <span>{String(value)}</span> : <StatusBadge entity={column.entity} value={String(value)} />;
    case "instant": {
      const date = formatVnDateOf(value, clock);
      return date === null ? <MissingValue /> : <span className="whitespace-nowrap tabular-nums">{date}</span>;
    }
    case "integer":
      return <span className="tabular-nums">{typeof value === "number" ? formatCount(value) : String(value)}</span>;
    default:
      return (
        <span className="block min-w-0 truncate" title={String(value)}>
          {String(value)}
        </span>
      );
  }
}

/** Numbers line up on the right (DESIGN.md data table). */
export const isNumeric = (kind: ListColumn<unknown>["kind"]): boolean => kind === "money" || kind === "integer";
