import { and, count, eq, inArray, isNull } from "drizzle-orm";

import type { CatalogDatabase } from "../platform/db/client.ts";
import { companyBoards, postings } from "../platform/db/catalog-schema.ts";
import { ASHBY_LIMITS } from "./ashby-feed.ts";
import { GREENHOUSE_LIMITS } from "./greenhouse-feed.ts";
import { LEVER_LIMITS } from "./lever-feed.ts";
import { PERSONIO_LIMITS } from "./personio-feed.ts";

import { CATALOG_ATS_NAMES } from "./discovered-boards.ts";

import type { CatalogAtsName } from "./discovered-boards.ts";

const LIMITS = {
  greenhouse: GREENHOUSE_LIMITS,
  lever: LEVER_LIMITS,
  ashby: ASHBY_LIMITS,
  personio: PERSONIO_LIMITS,
} as const;

const POLLABLE_STATUSES = ["active", "empty"] as const;

export interface BackfillAtsEstimate {
  ats: CatalogAtsName;
  boards: number;
  listingRequests: number;
  pendingDetailRequests: number;
  requests: number;
  minIntervalMs: number;
  maxConcurrent: number;
  durationMs: number;
}

export function estimateBackfill(db: CatalogDatabase) {
  const boardRows = db
    .select({ ats: companyBoards.ats, boards: count() })
    .from(companyBoards)
    .where(inArray(companyBoards.status, [...POLLABLE_STATUSES]))
    .groupBy(companyBoards.ats)
    .all();

  const pendingDetailsRow = db
    .select({ pendingDetails: count() })
    .from(postings)
    .where(
      and(
        eq(postings.ats, "greenhouse"),
        isNull(postings.closedAt),
        isNull(postings.descriptionGz),
      ),
    )
    .get();

  const pendingGreenhouseDetails = pendingDetailsRow?.pendingDetails ?? 0;
  const boardsByAts = new Map(boardRows.map((row) => [row.ats, row.boards]));

  const perAts = CATALOG_ATS_NAMES.map((ats) => {
    const boards = boardsByAts.get(ats) ?? 0;
    const pendingDetailRequests = ats === "greenhouse" ? pendingGreenhouseDetails : 0;
    const listingRequests = boards;
    const requests = listingRequests + pendingDetailRequests;
    const { minIntervalMs, maxConcurrent } = LIMITS[ats];

    return {
      ats,
      boards,
      listingRequests,
      pendingDetailRequests,
      requests,
      minIntervalMs,
      maxConcurrent,
      durationMs: requests * minIntervalMs,
    } satisfies BackfillAtsEstimate;
  });

  return {
    perAts,
    passDurationMs: Math.max(...perAts.map((estimate) => estimate.durationMs)),
  };
}
