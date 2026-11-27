import { and, desc, eq, exists, inArray, isNull, or, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

import type { AppDatabase } from "../platform/db/client.ts";

import { jobPlaces, jobs } from "../platform/db/schema.ts";
import { nonJobTitleCondition } from "./non-job.ts";
import type { PullPreferences } from "./preferences.ts";

export type JobRow = typeof jobs.$inferSelect;

const DEFAULT_LIMIT = 200;

/**
 * The freehire-shaped read the matching path uses: open jobs whose category is one a user wants or whose title holds
 * one of their title words, whose canonical place ids intersect the user's, and whose language the user reads.
 * Non-jobs (talent pools, open applications, tests) are never returned. A job's remote scope is a place id too, so
 * `Remote · Canada` matches only a remote job freehire lists Canada for (SPEC §6.4).
 * @param db The application database.
 * @returns The reader.
 */
export function createJobReader(db: AppDatabase) {
  function forPreferences(preferences: PullPreferences, limit = DEFAULT_LIMIT) {
    const conditions: SQL[] = [eq(jobs.status, "open"), nonJobTitleCondition(jobs.titleNorm)];

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

    const role = or(...roleParts);

    if (role !== undefined) {
      conditions.push(role);
    }

    if (preferences.languages !== undefined && preferences.languages.length > 0) {
      conditions.push(
        or(
          isNull(jobs.language),
          eq(jobs.language, ""),
          inArray(
            sql`lower(${jobs.language})`,
            preferences.languages.map((language) => language.toLowerCase()),
          ),
        ) ?? sql`1 = 1`,
      );
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
