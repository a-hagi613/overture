import { inArray } from "drizzle-orm";

import type { AppDatabase } from "../platform/db/client.ts";

import { jobs } from "../platform/db/schema.ts";
import { orderedMatches } from "../matching/match-sort.ts";
import { readStoredMatches } from "../matching/match-store.ts";

function employmentTypeOf(value: string | null) {
  if (
    value === "full_time" ||
    value === "part_time" ||
    value === "contract" ||
    value === "internship" ||
    value === "temporary" ||
    value === "unknown"
  ) {
    return value;
  }

  return "unknown";
}

function salaryPeriodOf(value: string | null) {
  return value === "year" || value === "month" || value === "hour" ? value : null;
}

/**
 * The onboarding match list over stored freehire scores (ADR 0047, ADR 0045). It reads the same stored rows the
 * Matches page uses, joins the freehire job for display, and never invents a score: an unscored row stays null so the
 * card says "Scoring…".
 * @param deps The application database and the Strong-band threshold.
 * @param userId The signed-in account.
 * @param limit The plan's pick limit, so the preview shows exactly the rows a person can pick.
 * @returns The ordered match cards and how many the person chose.
 */
export function onboardingMatchesOf(
  deps: { db: AppDatabase; strongThreshold: number },
  userId: string,
  limit: number,
) {
  const stored = orderedMatches(readStoredMatches(deps.db, userId));

  if (stored.length === 0) {
    return [];
  }

  const chosen = stored.slice(0, limit);
  const ids = chosen.map((match) => match.id);

  const rows = deps.db
    .select({
      company: jobs.company,
      employmentType: jobs.employmentType,
      id: jobs.id,
      locationRaw: jobs.locationRaw,
      salaryCurrency: jobs.salaryCurrency,
      salaryMin: jobs.salaryMin,
      salaryPeriod: jobs.salaryPeriod,
      title: jobs.title,
      workMode: jobs.workMode,
    })
    .from(jobs)
    .where(inArray(jobs.id, ids))
    .all();

  const display = new Map(rows.map((row) => [row.id, row]));

  return chosen.flatMap((match) => {
    const job = display.get(match.id);

    if (job === undefined) {
      return [];
    }

    const { score } = match;

    if (score === null) {
      return [];
    }

    return [
      {
        company: job.company,
        employmentType: employmentTypeOf(job.employmentType),
        id: match.id,
        location: job.locationRaw,
        reason: match.reasons.length === 0 ? null : match.reasons.join(" "),
        salaryCurrency: job.salaryCurrency,
        salaryMinMinor: job.salaryMin === null ? null : Math.round(job.salaryMin * 100),
        salaryPeriod: salaryPeriodOf(job.salaryPeriod),
        score,
        strong: score >= deps.strongThreshold,
        title: job.title,
        why: [...match.reasons].slice(0, 3),
        workplace: job.workMode ?? "unknown",
      },
    ];
  });
}
