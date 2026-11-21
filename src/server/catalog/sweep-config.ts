import type { AppDatabase } from "../platform/db/client.ts";

import { getSetting, isKillSwitchEnabled } from "../platform/settings/index.ts";
import { ASHBY_LIMITS } from "./ashby-feed.ts";
import { CATALOG_ATS_NAMES } from "./discovered-boards.ts";
import { GREENHOUSE_LIMITS } from "./greenhouse-feed.ts";
import { LEVER_LIMITS } from "./lever-feed.ts";
import { PERSONIO_LIMITS } from "./personio-feed.ts";

import type { CatalogAtsName } from "./discovered-boards.ts";

const DEFAULT_SWEEP_INTERVAL_MS = 60_000;
const MIN_SWEEP_INTERVAL_MS = 1000;
const DEFAULT_SWEEP_MAX_BOARDS = 20;

export const SWEEP_CLAIM_MS = 15 * 60_000;

const SWEEP_LIMITS = {
  greenhouse: GREENHOUSE_LIMITS,
  lever: LEVER_LIMITS,
  ashby: ASHBY_LIMITS,
  personio: PERSONIO_LIMITS,
} as const;

export function readSweepIntervalMs(db: AppDatabase) {
  const raw = getSetting(db, "catalog.sweep_interval_ms");
  const parsed = raw === null ? Number.NaN : Number(raw);

  return Number.isFinite(parsed) && parsed >= MIN_SWEEP_INTERVAL_MS
    ? Math.trunc(parsed)
    : DEFAULT_SWEEP_INTERVAL_MS;
}

function readSweepBatchOverride(db: AppDatabase) {
  const raw = getSetting(db, "catalog.sweep_batch");
  const parsed = raw === null ? Number.NaN : Number(raw);

  return Number.isFinite(parsed) && parsed >= 1 ? Math.trunc(parsed) : null;
}

function readSweepMaxBoards(db: AppDatabase) {
  const raw = getSetting(db, "catalog.sweep_max_boards");
  const parsed = raw === null ? Number.NaN : Number(raw);

  return Number.isFinite(parsed) && parsed >= 1 ? Math.trunc(parsed) : DEFAULT_SWEEP_MAX_BOARDS;
}

function requestRatePerSecond(ats: CatalogAtsName) {
  return 1000 / SWEEP_LIMITS[ats].minIntervalMs;
}

export function engagedCatalogAts(db: AppDatabase) {
  return new Set(CATALOG_ATS_NAMES.filter((ats) => isKillSwitchEnabled(db, "ats", ats)));
}

export function sweepBatchPerAts(db: AppDatabase) {
  const intervalMs = readSweepIntervalMs(db);
  const overrideTotal = readSweepBatchOverride(db);
  const maxBoards = readSweepMaxBoards(db);
  const engaged = engagedCatalogAts(db);

  const totalRate = CATALOG_ATS_NAMES.filter((ats) => !engaged.has(ats)).reduce(
    (sum, ats) => sum + requestRatePerSecond(ats),
    0,
  );

  const batchFor = (ats: CatalogAtsName) => {
    if (engaged.has(ats)) {
      return 0;
    }

    const planned =
      overrideTotal === null
        ? Math.trunc(intervalMs / SWEEP_LIMITS[ats].minIntervalMs)
        : Math.trunc((overrideTotal * requestRatePerSecond(ats)) / totalRate);

    return Math.max(1, Math.min(planned, maxBoards));
  };

  return {
    greenhouse: batchFor("greenhouse"),
    lever: batchFor("lever"),
    ashby: batchFor("ashby"),
    personio: batchFor("personio"),
  } satisfies Record<CatalogAtsName, number>;
}
