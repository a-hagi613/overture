import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";
import type { PickPreparationResult } from "./picks.ts";

import { isApplySupportedAts } from "../../shared/ats.ts";
import { jobPostingById } from "../jobs/job-posting.ts";
import { pickStatusOfApplication } from "../../shared/onboarding.ts";
import {
  applicationFor,
  createApplication,
  createClosedApplication,
} from "../matching/applications.ts";
import { enqueueApplicationPrepare } from "../pipeline/prepare-jobs.ts";
import { displayFromJobPosting } from "./freehire-job.ts";

/**
 * Prepares the durable onboarding picks against the freehire jobs a person chose (ADR 0047, ADR 0050). It creates one
 * tracked Application per pick from the job's frozen display snapshot, keeps a closed or unsendable job visible as a
 * closed Application, and queues preparation for the rest. A pick that already owns an Application is only reported,
 * so a refresh or a double return never creates a second one.
 * @param deps The application database and the clock.
 * @param userId The account that owns the picks.
 * @param picks The stored pick rows, in the order the person chose them.
 * @param excluded The normalised employer names the person asked Overture never to apply to.
 * @returns One result per pick, keyed by the freehire posting id.
 */
export function preparePickedJobs(
  deps: { db: AppDatabase; clock: Clock },
  userId: string,
  picks: readonly { postingId: string }[],
  excluded: ReadonlySet<string>,
) {
  const { db, clock } = deps;
  const results = new Map<string, PickPreparationResult & { postingId: string }>();

  for (const pick of picks) {
    const existing = applicationFor(db, userId, pick.postingId);

    if (existing !== undefined) {
      results.set(pick.postingId, {
        applicationId: existing.id,
        postingId: pick.postingId,
        reason: null,
        status: pickStatusOfApplication(existing.status, existing.statusReason ?? null),
      });

      continue;
    }

    const posting = jobPostingById({ db }, pick.postingId);
    const display = posting === undefined ? undefined : displayFromJobPosting(posting);

    const closed = (reason: "apply_unsupported" | "company_excluded" | "posting_closed") => {
      const applicationId =
        display === undefined
          ? null
          : createClosedApplication(db, clock.now(), {
              display,
              postingId: pick.postingId,
              reason,
              userId,
            });

      results.set(pick.postingId, {
        applicationId,
        postingId: pick.postingId,
        reason,
        status: reason === "apply_unsupported" ? "failed" : "closed",
      });
    };

    if (posting === undefined || !posting.open) {
      closed("posting_closed");

      continue;
    }

    if (!isApplySupportedAts(posting.ats)) {
      closed("apply_unsupported");

      continue;
    }

    if (excluded.has(posting.companyNameNorm)) {
      closed("company_excluded");

      continue;
    }

    const applicationId =
      display === undefined
        ? null
        : createApplication(
            { db },
            clock.now(),
            { origin: "pick", postingId: pick.postingId, score: null, userId },
            display,
          );

    if (applicationId !== null) {
      enqueueApplicationPrepare(db, clock, applicationId);
    }

    results.set(pick.postingId, {
      applicationId,
      postingId: pick.postingId,
      reason: applicationId === null ? "prepare_failed" : null,
      status: applicationId === null ? "failed" : "preparing",
    });
  }

  return results;
}
