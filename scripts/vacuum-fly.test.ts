import { expect, test } from "bun:test";

import { compactionDecision, parseDryRunReport } from "./vacuum-fly.ts";

const printed =
  "before: file 1602.0 MB, WAL 477.0 MB, pages 410112 x 4096 B, freelist 408576 pages (1596.0 MB free)\n" +
  "dry run: nothing was written\n";

test("parseDryRunReport reads the sizes the database script prints", () => {
  expect(parseDryRunReport(printed)).toStrictEqual({
    fileMb: 1602,
    freeMb: 1596,
    freelistCount: 408_576,
    pageCount: 410_112,
    pageSizeBytes: 4096,
    walMb: 477,
  });
});

test("parseDryRunReport refuses output without a size line", () => {
  expect(() => parseDryRunReport("vacuum-app-db refused: no database at /data/app.sqlite")).toThrow(
    /no size line/u,
  );
});

test("compactionDecision skips a file below the threshold", () => {
  const sizes = parseDryRunReport(printed);

  expect(compactionDecision({ ...sizes, freeMb: 12.5 }, { force: false, thresholdMb: 50 })).toBe(
    "skip",
  );
});

test("compactionDecision compacts a file above the threshold, or when forced", () => {
  const sizes = parseDryRunReport(printed);

  expect(compactionDecision(sizes, { force: false, thresholdMb: 50 })).toBe("compact");
  expect(compactionDecision({ ...sizes, freeMb: 0 }, { force: true, thresholdMb: 50 })).toBe(
    "compact",
  );
});
