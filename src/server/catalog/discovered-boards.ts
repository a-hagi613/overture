import { and, eq } from "drizzle-orm";

import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";
import { companies, companyBoards } from "../platform/db/schema.ts";

export const M1_ATS_NAMES = ["greenhouse", "lever", "ashby"] as const;

export type M1AtsName = (typeof M1_ATS_NAMES)[number];

export interface DiscoveredScraperRow {
  ats: string;
  name: string;
  slug: string;
  url: string;
}

export interface DiscoveredBoard {
  ats: M1AtsName;
  boardToken: string;
  companyName: string;
}

export interface DiscoveredBoardsStats {
  considered: number;
  unsupportedAts: number;
  withoutBoardToken: number;
  duplicateBoardToken: number;
}

export interface DiscoveredBoardsLoadReport extends DiscoveredBoardsStats {
  createdBoards: number;
  existingBoards: number;
  createdCompanies: number;
  reusedCompanies: number;
}

export function isM1Ats(ats: string): ats is M1AtsName {
  return M1_ATS_NAMES.some((candidate) => candidate === ats);
}

function lastPathSegment(value: string) {
  try {
    const { pathname } = new URL(value);
    const segments = pathname.split("/").filter((segment) => segment.length > 0);

    return segments.at(-1) ?? null;
  } catch {
    return null;
  }
}

export function boardTokenFromScraperRow(row: DiscoveredScraperRow) {
  const segment = row.url === "" ? null : lastPathSegment(row.url);

  if (segment === null) {
    return row.slug === "" ? null : row.slug;
  }

  return segment;
}

export function normalizeDiscoveredBoards(rows: DiscoveredScraperRow[]) {
  const boards: DiscoveredBoard[] = [];
  const seen = new Set<string>();

  const stats: DiscoveredBoardsStats = {
    considered: rows.length,
    unsupportedAts: 0,
    withoutBoardToken: 0,
    duplicateBoardToken: 0,
  };

  for (const row of rows) {
    if (!isM1Ats(row.ats)) {
      stats.unsupportedAts += 1;

      continue;
    }

    const boardToken = boardTokenFromScraperRow(row);

    if (boardToken === null) {
      stats.withoutBoardToken += 1;

      continue;
    }

    const key = `${row.ats}:${boardToken}`;

    if (seen.has(key)) {
      stats.duplicateBoardToken += 1;

      continue;
    }

    seen.add(key);
    boards.push({ ats: row.ats, boardToken, companyName: row.name });
  }

  return { boards, stats };
}

export function loadDiscoveredBoards(db: AppDatabase, clock: Clock, rows: DiscoveredScraperRow[]) {
  const { boards, stats } = normalizeDiscoveredBoards(rows);

  const report: DiscoveredBoardsLoadReport = {
    ...stats,
    createdBoards: 0,
    existingBoards: 0,
    createdCompanies: 0,
    reusedCompanies: 0,
  };

  db.transaction((tx) => {
    for (const board of boards) {
      const existing = tx
        .select()
        .from(companyBoards)
        .where(
          and(eq(companyBoards.ats, board.ats), eq(companyBoards.boardToken, board.boardToken)),
        )
        .get();

      if (existing !== undefined) {
        report.existingBoards += 1;

        continue;
      }

      const nameNorm = board.companyName.toLowerCase();
      const company = tx.select().from(companies).where(eq(companies.nameNorm, nameNorm)).get();
      const companyId = company?.id ?? crypto.randomUUID();

      if (company === undefined) {
        tx.insert(companies)
          .values({
            id: companyId,
            name: board.companyName,
            nameNorm,
            createdAt: clock.now(),
          })
          .run();

        report.createdCompanies += 1;
      } else {
        report.reusedCompanies += 1;
      }

      tx.insert(companyBoards)
        .values({
          id: crypto.randomUUID(),
          companyId,
          ats: board.ats,
          boardToken: board.boardToken,
          status: "active",
          source: "discovered",
          notFoundPolls: 0,
          createdAt: clock.now(),
        })
        .onConflictDoNothing()
        .run();

      report.createdBoards += 1;
    }
  });

  return report;
}
