import type { TableColumn } from "./table-sort.ts";
import { TableHeaderRow } from "./table-header-row.tsx";

const SKELETON_LABEL = "Loading";

/**
 * The loading state: the real header plus skeleton cells, announced as busy.
 *
 * @param props The columns, the busy label and the skeleton row count.
 * @param props.busyLabel The text a screen reader hears while rows load.
 * @param props.columns The columns whose names stay on screen.
 * @param props.rows How many skeleton rows to draw.
 * @returns The skeleton table and its phone skeleton cards.
 */
export function TableSkeleton<Row>({
  busyLabel,
  columns,
  rows,
}: {
  busyLabel: string;
  columns: readonly TableColumn<Row>[];
  rows: number;
}) {
  return (
    <div aria-busy="true" className="w-full">
      <output className="sr-only">{busyLabel}</output>
      <div className="hidden md:block">
        <table className="w-full border-collapse text-left">
          <thead className="sticky top-0 z-10 bg-card">
            <TableHeaderRow columns={columns} onSort={null} sort={null} />
          </thead>
          <tbody className="divide-y divide-border">
            {Array.from({ length: rows }, (_row, rowIndex) => (
              <tr aria-hidden="true" key={rowIndex}>
                {columns.map((column) => (
                  <td className="px-4 py-3" key={column.key}>
                    <span className="sr-only">{SKELETON_LABEL}</span>
                    <div className="h-4 w-full animate-pulse rounded bg-muted" />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="divide-y divide-border md:hidden">
        {Array.from({ length: rows }, (_card, index) => (
          <div className="space-y-2 px-4 py-3" key={index}>
            <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
            <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
          </div>
        ))}
      </div>
    </div>
  );
}
