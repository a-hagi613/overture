import { describe, expect, test } from "bun:test";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { Table } from "./table.tsx";
import type { TableColumn, TableSort, TableState } from "./table.tsx";
import { nextRowIndex, sortTableRows } from "./table-sort.ts";

interface Row {
  id: string;
  name: string;
  score: number | null;
}

const rows: Row[] = [
  { id: "row-1", name: "Backend Engineer", score: 92 },
  { id: "row-2", name: "Platform Engineer", score: null },
  { id: "row-3", name: "DevOps Engineer", score: 68 },
];

const jobColumn: TableColumn<Row> = {
  header: "Job",
  isPrimary: true,
  key: "name",
  render: (row) => row.name,
};

const scoreColumn: TableColumn<Row> = {
  align: "end",
  header: "Match score",
  key: "score",
  render: (row) => (row.score === null ? "Scoring…" : `${String(row.score)}% match`),
  sortValue: (row) => row.score,
};

const columns: TableColumn<Row>[] = [jobColumn, scoreColumn];

const retryLabel = "Retry";

interface RenderOptions {
  error?: ReactNode;
  initialSort?: TableSort;
  handleRowActivate?: (row: Row) => void;
  state?: TableState;
}

function renderTable(options: RenderOptions = {}) {
  return renderToStaticMarkup(
    <Table
      columns={columns}
      empty={{ title: "No matches yet" }}
      error={options.error}
      initialSort={options.initialSort}
      label="Matches"
      onRowActivate={options.handleRowActivate}
      rowKey={(row) => row.id}
      rows={options.state === "empty" ? [] : rows}
      state={options.state ?? "ready"}
    />,
  );
}

describe("Table", () => {
  test("is a real table with a caption, column headers and a sticky header row", () => {
    const markup = renderTable();

    expect(markup).toContain("<caption");
    expect(markup).toContain("Matches");
    expect(markup).toContain("<th");
    expect(markup).toContain('scope="col"');
    expect(markup).toContain("sticky");
    expect(markup).toContain("Match score");
  });

  test("sorts a sortable column from its header button and exposes aria-sort", () => {
    const markup = renderTable({ initialSort: { direction: "descending", key: "score" } });

    expect(markup).toContain('aria-sort="descending"');
    expect(markup.indexOf("92% match")).toBeLessThan(markup.indexOf("68% match"));
    expect(markup.indexOf("68% match")).toBeLessThan(markup.indexOf("Scoring…"));
  });

  test("renders the same rows as cards below the table for the phone", () => {
    const markup = renderTable();

    expect(markup).toContain("md:hidden");
    expect(markup).toContain('data-table-row="row-1"');
    expect(markup).toContain('data-table-row="row-2"');
    expect(markup).toContain("Backend Engineer");
  });

  test("gives an actionable row one keyboard control with a roving tab stop", () => {
    const markup = renderTable({
      handleRowActivate: () => {
        throw new Error("static markup never activates a row");
      },
    });

    expect(markup).toContain('data-table-row-button="0"');
    expect(markup).toContain('tabindex="0"');
    expect(markup).toContain('tabindex="-1"');
  });

  test("draws a labelled loading skeleton and keeps the header", () => {
    const markup = renderTable({ state: "loading" });

    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain("Loading matches");
    expect(markup).toContain("animate-pulse");
    expect(markup).not.toContain("92% match");
  });

  test("draws an explicit empty state instead of a blank table", () => {
    const markup = renderTable({ state: "empty" });

    expect(markup).toContain('data-table-state="empty"');
    expect(markup).toContain("No matches yet");
    expect(markup).not.toContain("<tbody");
  });

  test("draws an alert with the retry action when the request fails", () => {
    const markup = renderTable({
      error: <button type="button">{retryLabel}</button>,
      state: "error",
    });

    expect(markup).toContain('data-table-state="error"');
    expect(markup).toContain('role="alert"');
    expect(markup).toContain("Retry");
  });

  test("keeps an unscored row honest instead of borrowing a ranking point", () => {
    const markup = renderTable();

    expect(markup).toContain("Scoring…");
    expect(markup).not.toContain("96.4");
  });
});

describe("sortTableRows", () => {
  test("sorts numbers descending with unscored rows last", () => {
    const sort: TableSort = { direction: "descending", key: "score" };

    expect(sortTableRows(rows, columns, sort).map((row) => row.id)).toEqual([
      "row-1",
      "row-3",
      "row-2",
    ]);
  });

  test("sorts numbers ascending with unscored rows last", () => {
    const sort: TableSort = { direction: "ascending", key: "score" };

    expect(sortTableRows(rows, columns, sort).map((row) => row.id)).toEqual([
      "row-3",
      "row-1",
      "row-2",
    ]);
  });

  test("keeps the source order when the column has no sort value", () => {
    const sort: TableSort = { direction: "ascending", key: "name" };

    expect(sortTableRows(rows, columns, sort).map((row) => row.id)).toEqual([
      "row-1",
      "row-2",
      "row-3",
    ]);
  });
});

describe("nextRowIndex", () => {
  test("moves focus by row and stops at both ends", () => {
    expect(nextRowIndex(0, "ArrowDown", 3)).toBe(1);
    expect(nextRowIndex(2, "ArrowDown", 3)).toBe(2);
    expect(nextRowIndex(2, "ArrowUp", 3)).toBe(1);
    expect(nextRowIndex(0, "ArrowUp", 3)).toBe(0);
    expect(nextRowIndex(1, "Home", 3)).toBe(0);
    expect(nextRowIndex(1, "End", 3)).toBe(2);
  });

  test("leaves other keys to the control that has focus", () => {
    expect(nextRowIndex(1, "Tab", 3)).toBeNull();
    expect(nextRowIndex(1, "Enter", 3)).toBeNull();
  });
});
