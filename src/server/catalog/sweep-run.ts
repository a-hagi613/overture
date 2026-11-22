import { and, inArray, notInArray, sql } from "drizzle-orm";

import type { AppDatabase, CatalogDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";

import { retryWhenBusy } from "../platform/db/busy.ts";
import { companyBoards } from "../platform/db/catalog-schema.ts";
import { CATALOG_ATS_NAMES } from "./discovered-boards.ts";
import { pollBoard } from "./poll-board.ts";
import { engagedCatalogAts, SWEEP_CLAIM_MS, sweepBatchPerAts } from "./sweep-config.ts";

import type { BoardFeeds } from "./board-feed.ts";
import type { PollBoardReport } from "./poll-board.ts";
import type { SweepRunKind } from "./sweep-worker-protocol.ts";

type CatalogAts = (typeof CATALOG_ATS_NAMES)[number];

/** The app database carries the sweep settings and kill switches; the catalog database carries the boards and postings. */
export interface SweepDeps {
  db: AppDatabase;
  catalogDb: CatalogDatabase;
  clock: Clock;
}

function isCatalogAts(ats: string): ats is CatalogAts {
  return CATALOG_ATS_NAMES.some((name) => name === ats);
}

export async function pollDueBoards(deps: SweepDeps, feeds: BoardFeeds) {
  const { db, catalogDb, clock } = deps;
  const now = clock.now();
  const batches = sweepBatchPerAts(db);
  const engaged = engagedCatalogAts(db);
  const pollableAts = CATALOG_ATS_NAMES.filter((ats) => !engaged.has(ats));

  const claimed = await retryWhenBusy(
    () =>
      pollableAts.flatMap((ats) =>
        catalogDb
          .update(companyBoards)
          .set({ nextPollAt: now + SWEEP_CLAIM_MS })
          .where(
            sql`${companyBoards.id} IN (
              SELECT id FROM company_boards
              WHERE ats = ${ats}
                AND status IN ('active', 'empty')
                AND next_poll_at <= ${now}
              ORDER BY next_poll_at
              LIMIT ${batches[ats]}
            )`,
          )
          .returning()
          .all(),
      ),
    "catalog.sweep.claim",
  );

  return Promise.all(
    claimed.flatMap((board) => {
      const { ats } = board;

      if (!isCatalogAts(ats)) {
        return [];
      }

      return [
        retryWhenBusy(
          async () => pollBoard(catalogDb, clock, feeds[ats], board),
          `catalog.sweep.${ats}`,
        ),
      ];
    }),
  );
}

export async function runBackfillPass(deps: SweepDeps, feeds: BoardFeeds) {
  const { db, catalogDb, clock } = deps;
  const now = clock.now();
  const engaged = [...engagedCatalogAts(db)];

  await retryWhenBusy(
    () =>
      catalogDb
        .update(companyBoards)
        .set({ nextPollAt: now })
        .where(
          engaged.length === 0
            ? inArray(companyBoards.status, ["active", "empty"])
            : and(
                inArray(companyBoards.status, ["active", "empty"]),
                notInArray(companyBoards.ats, engaged),
              ),
        )
        .run(),
    "catalog.backfill",
  );

  return pollDueBoards(deps, feeds);
}

export function summarizeRun(kind: SweepRunKind, reports: PollBoardReport[], durationMs: number) {
  return {
    kind,
    boards: reports.length,
    polled: reports.filter((report) => report.outcome === "polled").length,
    notModified: reports.filter((report) => report.outcome === "not_modified").length,
    gone: reports.filter((report) => report.outcome === "gone").length,
    errors: reports.filter((report) => report.outcome === "error").length,
    added: reports.reduce((total, report) => total + report.added, 0),
    updated: reports.reduce((total, report) => total + report.updated, 0),
    closed: reports.reduce((total, report) => total + report.closed, 0),
    closedPostingIds: reports.flatMap((report) => report.closedPostingIds),
    durationMs: Math.round(durationMs),
    workable: null,
  };
}
