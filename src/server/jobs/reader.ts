import { and, desc, eq, exists, inArray, or, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

import type { AppDatabase } from "../platform/db/client.ts";

import { jobPlaces, jobs } from "../platform/db/schema.ts";
import type { PullPreferences } from "./preferences.ts";

export type JobRow = typeof jobs.$inferSelect;

const DEFAULT_LIMIT = 200;

/**
 * The freehire-shaped read the matching path uses: open jobs whose category is one a user wants and whose canonical
 * place ids intersect the user's. A job's remote scope is a place id too, so `Remote · Canada` matches only a remote
 * job freehire lists Canada for (SPEC §6.4).
 * @param db The application database.
 * @returns The reader.
 */
export function createJobReader(db: AppDatabase) {
  function forPreferences(preferences: PullPreferences, limit = DEFAULT_LIMIT) {
    const conditions: SQL[] = [eq(jobs.status, "open")];

    const titleWords = preferences.titleWords
      .map((word) => word.trim().toLowerCase())
      .filter((word) => word !== "");

    const roleParts: SQL[] = [];

    if (preferences.categories.length > 0) {
      roleParts.push(inArray(jobs.category, [...preferences.categories]));
    }

    for (const word of titleWords) {
      roleParts.push(sql`instr(${jobs.titleNorm}, ${word}) > 0`);
    }

    const [firstRolePart, ...restRoleParts] = roleParts;

    if (firstRolePart !== undefined) {
      const rolePart =
        restRoleParts.length === 0
          ? firstRolePart
          : (or(firstRolePart, ...restRoleParts) ?? firstRolePart);

      conditions.push(rolePart);
    }

    if (preferences.placeIds.length > 0) {
      conditions.push(
        exists(
          db
            .select({ one: jobPlaces.placeId })
            .from(jobPlaces)
            .where(
              and(
                eq(jobPlaces.jobId, jobs.id),
                inArray(jobPlaces.placeId, [...preferences.placeIds]),
              ),
            ),
        ),
      );
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
