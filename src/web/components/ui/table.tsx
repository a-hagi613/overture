import { useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";

import { cn } from "./cn.ts";
import { PanelEmpty } from "./panel-empty.tsx";
import { TableCards } from "./table-cards.tsx";
import { TableHeaderRow } from "./table-header-row.tsx";
import { TableSkeleton } from "./table-skeleton.tsx";
import { nextRowIndex, sortTableRows } from "./table-sort.ts";
import type { TableColumn, TableSort, TableState } from "./table-sort.ts";

export type { TableColumn, TableSort, TableSortDirection, TableState } from "./table-sort.ts";

/** Everything the design-system table needs to draw a page of rows. */
export interface TableProps<Row> {
  columns: readonly TableColumn<Row>[];
  empty?: { action?: ReactNode; description?: ReactNode; title: ReactNode } | undefined;
  error?: ReactNode | undefined;
  footer?: ReactNode | undefined;
  initialSort?: TableSort | undefined;
  label: string;
  loadingLabel?: string | undefined;
  loadingRows?: number | undefined;
  onRowActivate?: ((row: Row) => void) | undefined;
  rowKey: (row: Row) => string;
  rows: readonly Row[];
  state: TableState;
}

const ROW_CLASS = "transition duration-quick ease-out hover:bg-muted/30 focus-within:bg-muted/30";

const ROW_BUTTON_CLASS =
  "flex min-h-8 w-full items-center gap-2 rounded-md text-left outline-none transition duration-quick ease-out focus-visible:ring-2 focus-visible:ring-foreground";

const CELL_CLASS = "px-4 py-3 text-sm text-foreground align-middle";

function moveRowFocus(event: KeyboardEvent<HTMLButtonElement>, index: number, count: number) {
  const root = event.currentTarget.closest("[data-table-root]");
  const next = nextRowIndex(index, event.key, count);

  if (root === null || next === null || next === index) {
    return;
  }

  const buttons = [...root.querySelectorAll<HTMLElement>("[data-table-row-button]")];

  const target = buttons.find(
    (button) =>
      button.dataset["tableRowButton"] === String(next) && button.getClientRects().length > 0,
  );

  if (target === undefined) {
    return;
  }

  event.preventDefault();
  target.focus();
}

/**
 * The design-system table: sortable headers, a sticky header, keyboard row navigation, hover and
 * focus row states, and a phone card list instead of a sideways-scrolling table. Sorting reorders
 * the rows the table is given, so a server-paged screen keeps its server order until a header is used.
 *
 * @param props The columns, rows, sort and the explicit loading, empty and error states.
 * @param props.columns The columns drawn as the header, the table cells and the card rows.
 * @param props.empty The explicit empty state's title, description and action.
 * @param props.error The retry control drawn inside the error alert.
 * @param props.footer The pager or other footer drawn under the rows.
 * @param props.initialSort The column and direction the table opens sorted by.
 * @param props.label The accessible name of the table.
 * @param props.loadingLabel The status text announced while rows load.
 * @param props.loadingRows How many skeleton rows a load draws.
 * @param props.onRowActivate Opens a row from its keyboard control, when rows are actionable.
 * @param props.rowKey The stable identity of one row.
 * @param props.rows The rows to draw.
 * @param props.state The explicit ready, loading, empty or error state.
 * @returns The table, its phone cards and the optional footer.
 */
export function Table<Row>({
  columns,
  empty,
  error,
  footer,
  initialSort,
  label,
  loadingLabel,
  loadingRows = 4,
  onRowActivate,
  rowKey,
  rows,
  state,
}: TableProps<Row>) {
  const [sort, setSort] = useState<TableSort | null>(initialSort ?? null);
  const [activeRow, setActiveRow] = useState(0);

  const ordered = sort === null ? rows : sortTableRows(rows, columns, sort);
  const busyLabel = loadingLabel ?? `Loading ${label.toLowerCase()}`;

  const toggleSort = (column: TableColumn<Row>) => {
    if (column.sortValue === undefined) {
      return;
    }

    setSort((current) =>
      current?.key === column.key
        ? {
            direction: current.direction === "ascending" ? "descending" : "ascending",
            key: column.key,
          }
        : { direction: "ascending", key: column.key },
    );
  };

  const renderPrimary = (row: Row, index: number) => {
    const content = columns.flatMap((column) =>
      column.isPrimary === true
        ? [
            <span className="min-w-0" key={column.key}>
              {column.render(row)}
            </span>,
          ]
        : [],
    );

    if (onRowActivate === undefined) {
      return content;
    }

    return (
      <button
        className={ROW_BUTTON_CLASS}
        data-table-row-button={index}
        onClick={() => {
          onRowActivate(row);
        }}
        onFocus={() => {
          setActiveRow(index);
        }}
        onKeyDown={(event) => {
          moveRowFocus(event, index, ordered.length);
        }}
        tabIndex={index === activeRow ? 0 : -1}
        type="button"
      >
        {content}
      </button>
    );
  };

  return (
    <div className="w-full" data-table-root="" data-table-state={state}>
      {state === "error" ? (
        <div className="px-4 py-5" role="alert">
          {error}
        </div>
      ) : null}

      {state === "empty" ? (
        <PanelEmpty
          action={empty?.action}
          description={empty?.description}
          title={empty?.title ?? label}
        />
      ) : null}

      {state === "loading" ? (
        <TableSkeleton busyLabel={busyLabel} columns={columns} rows={loadingRows} />
      ) : null}

      {state === "ready" ? (
        <>
          <div className="overflow-x-auto">
            <table className="hidden w-full border-collapse text-left md:table">
              <caption className="sr-only">{label}</caption>
              <thead className="sticky top-0 z-10 bg-card">
                <TableHeaderRow columns={columns} onSort={toggleSort} sort={sort} />
              </thead>
              <tbody className="divide-y divide-border">
                {ordered.map((row, index) => (
                  <tr className={ROW_CLASS} data-table-row={rowKey(row)} key={rowKey(row)}>
                    {columns.map((column) => (
                      <td
                        className={cn(
                          CELL_CLASS,
                          column.align === "end" ? "text-right" : "text-left",
                          column.cellClassName,
                        )}
                        key={column.key}
                      >
                        {column.isPrimary === true ? renderPrimary(row, index) : column.render(row)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <TableCards
            columns={columns}
            renderPrimary={renderPrimary}
            rowKey={rowKey}
            rows={ordered}
          />
        </>
      ) : null}

      {footer === undefined ? null : <div className="border-t border-border">{footer}</div>}
    </div>
  );
}
