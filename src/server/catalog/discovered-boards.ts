import { and, eq } from "drizzle-orm";

import type { CatalogDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";
import { WRITE_BATCH_ROWS, yieldToEventLoop } from "../platform/db/batches.ts";
import { companies, companyBoards } from "../platform/db/catalog-schema.ts";
import { greenhouseBoardTokenFromUrl } from "./greenhouse-feed.ts";

import type { BoardRegion } from "./board-feed.ts";

export const CATALOG_ATS_NAMES = ["greenhouse", "lever", "ashby", "personio"] as const;

export type CatalogAtsName = (typeof CATALOG_ATS_NAMES)[number];

export interface DiscoveredScraperRow {
  ats: string;
  name: string;
  slug: string;
  url: string;
}

export interface DiscoveredBoard {
  ats: CatalogAtsName;
  boardToken: string;
  region: BoardRegion;
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

export function isCatalogAts(ats: string): ats is CatalogAtsName {
  return CATALOG_ATS_NAMES.some((candidate) => candidate === ats);
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

const LEVER_EU_HOSTS: ReadonlySet<string> = new Set(["jobs.eu.lever.co", "api.eu.lever.co"]);

const PERSONIO_HOST_RE = /^(?<token>[a-z0-9][a-z0-9-]*)\.jobs\.personio\.(?:de|com)$/u;

export function personioBoardTokenFromUrl(value: string) {
  return PERSONIO_HOST_RE.exec(hostOf(value) ?? "")?.groups?.token ?? null;
}

function hostOf(value: string) {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function boardRegionFromScraperRow(row: DiscoveredScraperRow) {
  const host = hostOf(row.url);

  return row.ats === "lever" && host !== null && LEVER_EU_HOSTS.has(host)
    ? ("eu" satisfies BoardRegion)
    : ("us" satisfies BoardRegion);
}

export function boardTokenFromScraperRow(row: DiscoveredScraperRow) {
  if (row.ats === "greenhouse") {
    const parsed = greenhouseBoardTokenFromUrl(row.url);

    if (parsed !== null) {
      return parsed;
    }
  }

  if (row.ats === "personio") {
    const parsed = personioBoardTokenFromUrl(row.url);

    if (parsed !== null) {
      return parsed;
    }
  }

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
    if (!isCatalogAts(row.ats)) {
      stats.unsupportedAts += 1;

      continue;
    }

    const boardToken = boardTokenFromScraperRow(row);

    if (boardToken === null) {
      stats.withoutBoardToken += 1;

      continue;
    }

    const region = boardRegionFromScraperRow(row);
    const key = `${row.ats}:${region}:${boardToken}`;

    if (seen.has(key)) {
      stats.duplicateBoardToken += 1;

      continue;
    }

    seen.add(key);
    boards.push({ ats: row.ats, boardToken, region, companyName: row.name });
  }

  return { boards, stats };
}

export async function loadDiscoveredBoards(
  db: CatalogDatabase,
  clock: Clock,
  rows: DiscoveredScraperRow[],
) {
  const { boards, stats } = normalizeDiscoveredBoards(rows);

  const report: DiscoveredBoardsLoadReport = {
    ...stats,
    createdBoards: 0,
    existingBoards: 0,
    createdCompanies: 0,
    reusedCompanies: 0,
  };

  async function loadBatch(start: number) {
    const batch = boards.slice(start, start + WRITE_BATCH_ROWS);

    db.transaction((tx) => {
      for (const board of batch) {
        const existing = tx
          .select()
          .from(companyBoards)
          .where(
            and(
              eq(companyBoards.ats, board.ats),
              eq(companyBoards.region, board.region),
              eq(companyBoards.boardToken, board.boardToken),
            ),
          )
          .get();

        if (existing !== undefined) {
          report.existingBoards += 1;

          continue;
        }

        const sameToken = tx
          .select()
          .from(companyBoards)
          .where(
            and(eq(companyBoards.ats, board.ats), eq(companyBoards.boardToken, board.boardToken)),
          )
          .all();

        const misplaced =
          sameToken.length === 1 && sameToken[0]?.source === "discovered"
            ? sameToken[0]
            : undefined;

        if (misplaced !== undefined) {
          tx.update(companyBoards)
            .set({ region: board.region })
            .where(eq(companyBoards.id, misplaced.id))
            .run();

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
            region: board.region,
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

    const next = start + batch.length;

    if (next < boards.length) {
      await yieldToEventLoop();
      await loadBatch(next);
    }
  }

  await loadBatch(0);

  return report;
}
