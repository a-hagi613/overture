import { and, eq } from "drizzle-orm";

import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";

import { applications } from "../platform/db/schema.ts";
import { releaseForApplication } from "../billing/ledger.ts";
import { recordApplicationEvent } from "../applications/events.ts";

/** The attempt fields the skip writes, kept narrow so a caller cannot rewrite an outcome. */
export interface SkippedAttemptMark {
  endedAt: number;
  errorCode: string;
  outcome: "identity_mismatch";
}

export interface UnsendablePostingInput {
  applicationId: string;
  attemptId: string;
  /** The short reason stored as the attempt's error code and the Application's status reason suffix. */
  errorCode: string;
  statusReason: string;
  userId: string;
}

/**
 * Leaves the board for an Application no browser may open: its approved plan's posting URL is not the
 * expected ATS page, or it is not a safe address to navigate to at all.
 *
 * The reservation is released first, so the person is never charged for an Application that was not
 * opened, and the reason stays on the Application and the attempt so admin can see exactly why it was
 * skipped. The status is only changed while it is still `sending`, so a concurrent send that already
 * moved on is never overwritten.
 * @param deps The database, clock and the attempt writer of the dispatcher that owns the row.
 * @param input The Application, attempt and the reason it is unsendable.
 */
export function skipUnsendableApplication(
  deps: {
    db: AppDatabase;
    clock: Clock;
    markAttempt: (attemptId: string, values: SkippedAttemptMark) => void;
  },
  input: UnsendablePostingInput,
) {
  const { db, clock } = deps;
  const { applicationId, attemptId, errorCode, statusReason, userId } = input;

  releaseForApplication(db, clock, {
    applicationId,
    idempotencyKey: `release:${attemptId}`,
    userId,
  });

  const at = clock.now();

  const changed = db
    .update(applications)
    .set({ stage: null, status: "skipped", statusReason, updatedAt: at })
    .where(and(eq(applications.id, applicationId), eq(applications.status, "sending")))
    .returning({ id: applications.id })
    .all();

  if (changed.length === 0) {
    return;
  }

  recordApplicationEvent(db, clock, {
    applicationId,
    attemptId,
    userId,
    kind: "status",
    fromValue: "sending",
    toValue: "skipped",
    reason: statusReason,
    source: "system",
  });

  deps.markAttempt(attemptId, { endedAt: at, errorCode, outcome: "identity_mismatch" });
}
