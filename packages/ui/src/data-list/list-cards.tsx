/**
 * The phone form of a list (LC-12, wireframe phone order card): one compact card per row, built
 * from the same column definitions as the table so the same figures appear (M-8). The status
 * badge and the amount share the first line; the title (product thumbnail and name, two lines at
 * most) follows; then one "who" line (customer code chip and name) and one "meta" line (order code
 * chip, network and the one labelled date). Lines truncate or wrap inside the card; nothing
 * scrolls sideways.
 */
import { formatVnDateOf, systemClock } from "@cashback/core";

import { CodeChip } from "../brand/code-chip";
import { ProductThumb } from "../brand/product-thumb";
import type { CardSlot, ListColumn } from "./data-list.types";
import { ListCell } from "./list-cell";

export interface ListCardsProps<R> {
  readonly columns: readonly ListColumn<R>[];
  readonly rows: readonly R[];
  readonly rowKey: (row: R) => string;
}

const slotOf = <R,>(column: ListColumn<R>): CardSlot => column.card ?? "none";
const textOf = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : typeof value === "number" ? String(value) : null);

function CardTitle<R>({ column, row }: { column: ListColumn<R>; row: R }) {
  if (column.kind !== "product") {
    return (
      <div className="line-clamp-2 min-w-0 text-[15px] leading-snug font-semibold">
        <ListCell column={column} row={row} />
      </div>
    );
  }
  const image = column.imageKey === undefined ? null : textOf(row[column.imageKey]);
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <ProductThumb src={image} size={40} />
      <p className="line-clamp-2 min-w-0 text-[15px] leading-snug font-medium break-words">{textOf(row[column.key]) ?? "–"}</p>
    </div>
  );
}

/** The meta line's text part: values and the labelled date, joined by a middle dot. */
function metaText<R>(columns: readonly ListColumn<R>[], row: R): string {
  return columns
    .map((column) => {
      const value: unknown = row[column.key];
      if (column.kind === "instant") return `${column.cardLabel ?? column.header} ${formatVnDateOf(value, systemClock) ?? "–"}`;
      return column.cardText === undefined ? textOf(value) : column.cardText(row);
    })
    .filter((part): part is string => part !== null)
    .join(" · ");
}

function CodeChips<R>({ columns, row }: { columns: readonly ListColumn<R>[]; row: R }) {
  return (
    <>
      {columns.map((column) => {
        const code = textOf(row[column.key]);
        return code === null ? null : <CodeChip key={column.key} code={code} className="shrink-0" />;
      })}
    </>
  );
}

function ListCard<R>({ columns, row }: { columns: readonly ListColumn<R>[]; row: R }) {
  const pick = (slot: CardSlot) => columns.filter((c) => slotOf(c) === slot);
  const [status] = pick("status");
  const [amount] = pick("amount");
  const [title] = pick("title");
  const isCode = (c: ListColumn<R>): boolean => c.kind === "code";
  const who = pick("who");
  const meta = pick("meta");
  return (
    <li className="flex min-w-0 flex-col gap-2 rounded-xl border border-border bg-card p-3">
      {(status !== undefined || amount !== undefined) && (
        <div className="flex min-w-0 items-center justify-between gap-3">
          {status !== undefined ? <ListCell column={status} row={row} /> : <span />}
          {amount !== undefined && (
            <span data-card="amount" className="shrink-0 text-right">
              <span className="sr-only">{amount.header} </span>
              <ListCell column={amount} row={row} />
            </span>
          )}
        </div>
      )}
      {title !== undefined && <CardTitle column={title} row={row} />}
      {who.length > 0 && (
        <div data-card="who" className="flex min-w-0 items-center gap-2 text-sm">
          <CodeChips columns={who.filter(isCode)} row={row} />
          <span className="min-w-0 truncate">{metaText(who.filter((c) => !isCode(c)), row)}</span>
        </div>
      )}
      {meta.length > 0 && (
        <div data-card="meta" className="flex min-w-0 items-center gap-2 text-meta text-muted-foreground">
          <CodeChips columns={meta.filter(isCode)} row={row} />
          <span className="min-w-0 truncate">{metaText(meta.filter((c) => !isCode(c)), row)}</span>
        </div>
      )}
    </li>
  );
}

export function ListCards<R>({ columns, rows, rowKey }: ListCardsProps<R>) {
  return (
    <ul className="flex min-w-0 flex-col gap-2">
      {rows.map((row) => (
        <ListCard key={rowKey(row)} columns={columns} row={row} />
      ))}
    </ul>
  );
}
