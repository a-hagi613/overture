import type { ReactNode } from "react";

import { cn } from "./cn.ts";
import type { TableColumn } from "./table-sort.ts";

const CARD_CLASS = "transition duration-quick ease-out hover:bg-muted/30 focus-within:bg-muted/30";

/**
 * The phone layout: one card per row, with the primary column as its heading and the rest as
 * definition rows. A table never scrolls sideways on a phone.
 *
 * @param props The columns, the rows, their keys and the primary-cell renderer.
 * @param props.columns The columns drawn as a card.
 * @param props.renderPrimary Draws the card's heading, including any row control.
 * @param props.rowKey The stable identity of one row.
 * @param props.rows The rows to draw.
 * @returns The card list, hidden from `md` up.
 */
export function TableCards<Row>({
  columns,
  renderPrimary,
  rowKey,
  rows,
}: {
  columns: readonly TableColumn<Row>[];
  renderPrimary: (row: Row, index: number) => ReactNode;
  rowKey: (row: Row) => string;
  rows: readonly Row[];
}) {
  return (
    <div className="divide-y divide-border md:hidden">
      {rows.map((row, index) => (
        <article
          className={cn("px-4 py-3", CARD_CLASS)}
          data-table-row={rowKey(row)}
          key={rowKey(row)}
        >
          {columns
            .filter((column) => column.isPrimary === true)
            .map((column) => (
              <h3 className="min-w-0 text-sm font-semibold text-foreground" key={column.key}>
                {renderPrimary(row, index)}
              </h3>
            ))}
          <dl className="mt-2 grid grid-cols-[minmax(0,7rem)_1fr] gap-x-3 gap-y-1">
            {columns.flatMap((column) =>
              column.isPrimary === true || column.hideOnCard === true
                ? []
                : [
                    <dt className="text-xs text-muted-foreground" key={`${column.key}-label`}>
                      {column.header}
                    </dt>,
                    <dd className="min-w-0 text-xs text-foreground" key={`${column.key}-value`}>
                      {column.render(row)}
                    </dd>,
                  ],
            )}
          </dl>
        </article>
      ))}
    </div>
  );
}
