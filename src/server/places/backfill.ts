import { eq } from "drizzle-orm";
import { z } from "zod";

import type { AppDatabase } from "../platform/db/client.ts";

import { jobPlaces, jobs, targets } from "../platform/db/schema.ts";
import { jobPlaceRows } from "./job-places.ts";
import { promotePlaceValues } from "./resolve.ts";

const stringArraySchema = z.array(z.string());

function stringsOf(value: string | null) {
  if (value === null || value.trim() === "") {
    return [];
  }

  return stringArraySchema.parse(JSON.parse(value));
}

const PLACE_INSERT_CHUNK = 100;

/**
 * Fills `job_places` for every stored job that has none. The migration rebuilds the table with its new key, so the
 * rows it held are gone; the job's own freehire columns still describe its places, so this rebuilds them without a
 * pull. Idempotent: a job that already has places is skipped, and a second boot writes nothing.
 * @param db The application database, after its migrations.
 * @returns How many jobs gained place rows.
 */
export function rebuildStoredJobPlaces(db: AppDatabase) {
  const withPlaces = new Set(
    db
      .selectDistinct({ jobId: jobPlaces.jobId })
      .from(jobPlaces)
      .all()
      .map((row) => row.jobId),
  );

  let written = 0;

  const rows = db
    .select({
      cities: jobs.cities,
      countries: jobs.countries,
      id: jobs.id,
      metros: jobs.metros,
      regions: jobs.regions,
      workMode: jobs.workMode,
    })
    .from(jobs)
    .all();

  for (const job of rows) {
    if (withPlaces.has(job.id)) {
      continue;
    }

    const places = jobPlaceRows({
      cities: stringsOf(job.cities),
      countries: stringsOf(job.countries),
      metros: stringsOf(job.metros),
      regions: stringsOf(job.regions),
      work_mode: job.workMode,
    });

    if (places.length === 0) {
      continue;
    }

    for (let start = 0; start < places.length; start += PLACE_INSERT_CHUNK) {
      db.insert(jobPlaces)
        .values(
          places
            .slice(start, start + PLACE_INSERT_CHUNK)
            .map((place) => ({ jobId: job.id, kind: place.kind, placeId: place.placeId })),
        )
        .onConflictDoNothing()
        .run();
    }

    written += 1;
  }

  return written;
}

/**
 * Promotes every saved raw location to a canonical place id, once, at boot. The Drizzle migration moves the old
 * values into `unresolved_locations` because it cannot resolve a city name in SQL; this pass reads the committed geo
 * catalog, so "Toronto" becomes `city:ca:toronto` and a truly ambiguous name such as "Victoria" stays unresolved for
 * the person to pick. Idempotent: a row already holding only place ids is not written.
 * @param db The application database, after its migrations.
 * @returns How many rows changed.
 */
export function promoteStoredTargetPlaces(db: AppDatabase) {
  let changed = 0;

  for (const row of db.select().from(targets).all()) {
    const locations = stringArraySchema.parse(JSON.parse(row.locations));
    const unresolved = stringArraySchema.parse(JSON.parse(row.unresolvedLocations));
    const promoted = promotePlaceValues([...locations, ...unresolved]);
    const nextLocations = JSON.stringify(promoted.ids);
    const nextUnresolved = JSON.stringify(promoted.unresolved);

    if (nextLocations === row.locations && nextUnresolved === row.unresolvedLocations) {
      continue;
    }

    db.update(targets)
      .set({ locations: nextLocations, unresolvedLocations: nextUnresolved })
      .where(eq(targets.userId, row.userId))
      .run();

    changed += 1;
  }

  return changed;
}
