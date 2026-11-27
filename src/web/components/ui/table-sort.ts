import type { ReactNode } from "react";

/** The direction a sorted column is drawn in. */
export type TableSortDirection = "ascending" | "descending";

/** A sortable column and its current direction. */
export interface TableSort {
  direction: TableSortDirection;
  key: string;
}

/** One table column, shared by the desktop table and the phone card list. */
export interface TableColumn<Row> {
  align?: "start" | "end" | undefined;
  cellClassName?: string | undefined;
  header: string;
  headerClassName?: string | undefined;
  hideOnCard?: boolean | undefined;
  isPrimary?: boolean | undefined;
  key: string;
  render: (row: Row) => ReactNode;
  sortValue?: ((row: Row) => number | string | null) | undefined;
}

/** The four states a table draws, so none is an accidental blank area. */
export type TableState = "ready" | "loading" | "empty" | "error";

function valueOf<Row>(row: Row, column: TableColumn<Row>) {
  return column.sortValue === undefined ? null : column.sortValue(row);
}

const collator = new Intl.Collator("en", { numeric: true });

function compareValues(left: number | string | null, right: number | string | null) {
  if (left === right) {
    return 0;
  }

  if (left === null) {
    return 1;
  }

  if (right === null) {
    return -1;
  }

  return collator.compare(String(left), String(right));
}

/**
 * Sorts rows by one column, keeping a missing value (an unscored job, a blank date) after every
 * value in both directions, and keeping the incoming order for rows that compare equal.
 *
 * @param rows The rows to sort.
 * @param columns The table's columns.
 * @param sort The column and its direction.
 * @returns The sorted rows.
 */
export function sortTableRows<Row>(
  rows: readonly Row[],
  columns: readonly TableColumn<Row>[],
  sort: TableSort,
) {
  const column = columns.find((candidate) => candidate.key === sort.key);

  if (column?.sortValue === undefined) {
    return [...rows];
  }

  const direction = sort.direction === "ascending" ? 1 : -1;

  return rows.toSorted((left, right) => {
    const a = valueOf(left, column);
    const b = valueOf(right, column);

    if (a === null) {
      return b === null ? 0 : 1;
    }

    if (b === null) {
      return -1;
    }

    return compareValues(a, b) * direction;
  });
}

/**
 * The next row a table keyboard move lands on, clamped at both ends.
 *
 * @param index The row that has focus.
 * @param key The pressed key.
 * @param count How many rows the table holds.
 * @returns The next row index, or `null` when the key belongs to a control inside the row.
 */
export function nextRowIndex(index: number, key: string, count: number) {
  if (count === 0) {
    return null;
  }

  const last = count - 1;

  if (key === "ArrowDown") {
    return Math.min(last, index + 1);
  }

  if (key === "ArrowUp") {
    return Math.max(0, index - 1);
  }

  if (key === "Home") {
    return 0;
  }

  return key === "End" ? last : null;
}
