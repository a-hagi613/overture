import { ChevronDown, ChevronUp } from "lucide-react";

import { cn } from "./cn.ts";
import type { TableColumn, TableSort } from "./table-sort.ts";

const HEADER_BUTTON_CLASS =
  "inline-flex min-h-8 items-center gap-1.5 rounded-md text-eyebrow font-semibold uppercase text-muted-foreground transition duration-quick ease-out hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground";

const HEADER_LABEL_CLASS = "text-eyebrow font-semibold uppercase text-muted-foreground";

function sortStateOf<Row>(column: TableColumn<Row>, sort: TableSort | null) {
  return column.sortValue !== undefined && sort?.key === column.key ? sort.direction : "none";
}

/**
 * The sticky table header row, with a real sort button on every sortable column.
 *
 * @param props The columns, the current sort and the sort toggle.
 * @param props.columns The columns to name.
 * @param props.onSort Toggles a column's direction, or `null` while a load is in flight.
 * @param props.sort The column and direction currently sorted, if any.
 * @returns The header row inside `thead`.
 */
export function TableHeaderRow<Row>({
  columns,
  onSort,
  sort,
}: {
  columns: readonly TableColumn<Row>[];
  onSort: ((column: TableColumn<Row>) => void) | null;
  sort: TableSort | null;
}) {
  return (
    <tr className="border-b border-border">
      {columns.map((column) => (
        <th
          aria-sort={sortStateOf(column, sort)}
          className={cn(
            "px-4 py-2",
            column.align === "end" ? "text-right" : "text-left",
            column.headerClassName,
          )}
          key={column.key}
          scope="col"
        >
          {onSort === null || column.sortValue === undefined ? (
            <span className={HEADER_LABEL_CLASS}>{column.header}</span>
          ) : (
            <button
              className={HEADER_BUTTON_CLASS}
              onClick={() => {
                onSort(column);
              }}
              type="button"
            >
              {column.header}
              {sort?.key === column.key && sort.direction === "ascending" ? (
                <ChevronUp aria-hidden="true" size={12} />
              ) : (
                <ChevronDown aria-hidden="true" size={12} />
              )}
            </button>
          )}
        </th>
      ))}
    </tr>
  );
}
