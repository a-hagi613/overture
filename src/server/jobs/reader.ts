import { and, desc, eq, exists, inArray, or } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

import type { AppDatabase } from "../platform/db/client.ts";

import { jobPlaces, jobs } from "../platform/db/schema.ts";
import type { PullPreferences } from "./preferences.ts";

export type JobRow = typeof jobs.$inferSelect;

const DEFAULT_LIMIT = 200;

/**
 * The freehire-shaped read the matching path uses: open jobs whose category is one a user wants and whose places
 * intersect the user's countries or cities. Geography is OR here, exactly like freehire's own facets.
 * @param db The application database.
 * @returns The reader.
 */
export function createJobReader(db: AppDatabase) {
  function forPreferences(preferences: PullPreferences, limit = DEFAULT_LIMIT) {
    const conditions: SQL[] = [eq(jobs.status, "open")];

    if (preferences.categories.length > 0) {
      conditions.push(inArray(jobs.category, [...preferences.categories]));
    }

    const placeConditions = [
      preferences.countries.length === 0
        ? undefined
        : exists(
            db
              .select({ one: jobPlaces.id })
              .from(jobPlaces)
              .where(
                and(
                  eq(jobPlaces.jobId, jobs.id),
                  eq(jobPlaces.kind, "country"),
                  inArray(jobPlaces.value, [...preferences.countries]),
                ),
              ),
          ),
      preferences.cities.length === 0
        ? undefined
        : exists(
            db
              .select({ one: jobPlaces.id })
              .from(jobPlaces)
              .where(
                and(
                  eq(jobPlaces.jobId, jobs.id),
                  eq(jobPlaces.kind, "city"),
                  inArray(
                    jobPlaces.value,
                    preferences.cities.map((city) => city.toLowerCase()),
                  ),
                ),
              ),
          ),
    ].filter((condition): condition is SQL => condition !== undefined);

    const place = or(...placeConditions);

    if (place !== undefined) {
      conditions.push(place);
    }

    return db
      .select()
      .from(jobs)
      .where(and(...conditions))
      .orderBy(desc(jobs.postedAt), desc(jobs.createdAt))
      .limit(Math.max(1, limit))
      .all();
  }

  return { forPreferences };
}

export type JobReader = ReturnType<typeof createJobReader>;
